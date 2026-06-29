import { generateDailyPool, type DailyPoolFile } from "./dailyPool";
import type { MiningFilters } from "./mining";

/**
 * 晚间精选扫描：按照用户的精确过滤条件筛选股票
 * 
 * 过滤条件：
 * 1. 上升趋势 (channelType === "up")
 * 2. 5个交易日内刚发出B的买入信号 (buySignalAgeDays <= 5)
 * 3. B买入后预测35%+涨幅 (expectedReturnBase >= 35)
 * 4. 当前在上涨通道底部15%以内 (channelPosition <= 0.15)
 */

export interface EveningScanConfig {
  /** 是否要求上升趋势 */
  requireUptrend?: boolean;
  /** B信号最大天数（默认5个交易日） */
  maxBSignalAgeDays?: number;
  /** 最低预期收益率（默认35%） */
  minExpectedReturn?: number;
  /** 通道底部位置阈值（默认0.15即15%） */
  maxChannelPosition?: number;
  /** 最多返回股票数量（默认10只） */
  maxResults?: number;
}

export interface EveningScanResult {
  date: string;
  generatedAt: string;
  totalScanned: number;
  filteredCount: number;
  stocks: DailyPoolFile["results"];
  criteria: EveningScanConfig;
}

/**
 * 执行晚间精选扫描
 */
export async function runEveningScan(config: EveningScanConfig = {}): Promise<EveningScanResult> {
  const {
    requireUptrend = true,
    maxBSignalAgeDays = 5,
    minExpectedReturn = 35,
    maxChannelPosition = 0.15,
    maxResults = 10,
  } = config;

  // 生成每日股票池（使用默认过滤条件）
  const pool = await generateDailyPool({
    filters: {
      requireBSignal: true,
      maxBSignalAgeDays: 5, // 先粗筛5天内的B信号
      requireUptrend: false, // 不在这里限制，后面精确过滤
      minScore: 0,
    },
  });

  // 精确过滤
  const filteredStocks = pool.results.filter((stock) => {
    // 1. 上升趋势
    if (requireUptrend && stock.channelType !== "up") {
      return false;
    }

    // 2. 5个交易日内刚发出B的买入信号
    if (stock.buySignalAgeDays === undefined || stock.buySignalAgeDays > maxBSignalAgeDays) {
      return false;
    }

    // 3. B买入后预测35%+涨幅
    if (stock.expectedReturnBase < minExpectedReturn) {
      return false;
    }

    // 4. 当前在上涨通道底部15%以内
    if (stock.channelPosition > maxChannelPosition) {
      return false;
    }

    return true;
  });

  // 按复合分排序，取前N只
  const sortedStocks = filteredStocks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return {
    date: pool.meta.date,
    generatedAt: pool.meta.generatedAt,
    totalScanned: pool.results.length,
    filteredCount: filteredStocks.length,
    stocks: sortedStocks,
    criteria: {
      requireUptrend,
      maxBSignalAgeDays,
      minExpectedReturn,
      maxChannelPosition,
      maxResults,
    },
  };
}

/**
 * 生成邮件内容的HTML
 */
export function generateEmailHtml(result: EveningScanResult): string {
  const { date, stocks, criteria, totalScanned, filteredCount } = result;

  const stockRows = stocks.map((stock, index) => {
    const returnPct = stock.expectedReturnBase.toFixed(1);
    const channelPos = (stock.channelPosition * 100).toFixed(1);
    const riskReward = stock.riskReward.toFixed(2);
    const winRate = (stock.winRate * 100).toFixed(1);
    
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; text-align: center;">${index + 1}</td>
        <td style="padding: 12px; font-weight: 600;">${stock.name}</td>
        <td style="padding: 12px; font-family: monospace;">${stock.code}</td>
        <td style="padding: 12px; text-align: right;">¥${stock.price.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; color: #16a34a;">+${returnPct}%</td>
        <td style="padding: 12px; text-align: right;">${channelPos}%</td>
        <td style="padding: 12px; text-align: right;">${riskReward}</td>
        <td style="padding: 12px; text-align: right;">${winRate}%</td>
        <td style="padding: 12px; text-align: right;">${stock.subScores.uptrend.toFixed(0)}</td>
        <td style="padding: 12px; text-align: right;">${stock.subScores.bSignal.toFixed(0)}</td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; color: #374151; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .header p { margin: 0; opacity: 0.9; }
    .section { background: white; border-radius: 8px; padding: 25px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section h2 { margin-top: 0; color: #1f2937; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
    .criteria { background: #f3f4f6; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .criteria ul { margin: 10px 0; padding-left: 20px; }
    .criteria li { margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th { background: #f9fafb; padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; }
    td { padding: 12px; }
    .highlight { background: #fef3c7; }
    .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-uptrend { background: #dcfce7; color: #166534; }
    .badge-signal { background: #dbeafe; color: #1e40af; }
    .empty-state { text-align: center; padding: 40px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📈 Serenity 晚间精选股票池</h1>
      <p>扫描日期：${date} | 扫描时间：${new Date(result.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
    </div>

    <div class="section">
      <h2>🎯 筛选条件</h2>
      <div class="criteria">
        <ul>
          <li>✅ 上升趋势：${criteria.requireUptrend ? '是' : '否'}</li>
          <li>✅ B信号时效：${criteria.maxBSignalAgeDays}个交易日内</li>
          <li>✅ 预期涨幅：≥${criteria.minExpectedReturn}%</li>
          <li>✅ 通道位置：底部${(criteria.maxChannelPosition * 100).toFixed(0)}%以内</li>
        </ul>
      </div>
      <p><strong>扫描结果：</strong>共扫描 ${totalScanned} 只股票，筛选出 <strong>${filteredCount}</strong> 只符合条件的股票</p>
    </div>

    <div class="section">
      <h2>🏆 精选股票列表</h2>
      ${stocks.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th style="text-align: center;">排名</th>
              <th>股票名称</th>
              <th>股票代码</th>
              <th style="text-align: right;">现价</th>
              <th style="text-align: right;">预期涨幅</th>
              <th style="text-align: right;">通道位置</th>
              <th style="text-align: right;">盈亏比</th>
              <th style="text-align: right;">胜率</th>
              <th style="text-align: right;">趋势分</th>
              <th style="text-align: right;">信号分</th>
            </tr>
          </thead>
          <tbody>
            ${stockRows}
          </tbody>
        </table>
      ` : `
        <div class="empty-state">
          <p>当前没有符合所有筛选条件的股票</p>
          <p>建议放宽筛选条件或等待下一个交易日</p>
        </div>
      `}
    </div>

    ${stocks.length > 0 ? `
      <div class="section">
        <h2>📊 投资建议说明</h2>
        <p>基于瓶颈点投资法，以上股票均满足以下特征：</p>
        <ul>
          <li><strong>上升趋势确认</strong>：股票处于明确的上升通道中</li>
          <li><strong> fresh B信号</strong>：最近5个交易日内发出买入信号，信号时效性强</li>
          <li><strong>高预期收益</strong>：基于历史回测，预期收益超过35%</li>
          <li><strong>底部支撑</strong>：当前价格接近上升通道下轨，具有较好的安全边际</li>
        </ul>
        <p style="color: #dc2626; font-weight: 600; margin-top: 15px;">⚠️ 风险提示：以上内容仅供参考，不构成投资建议。投资有风险，入市需谨慎。</p>
      </div>
    ` : ''}

    <div class="footer">
      <p>本邮件由 Serenity 智能投研台自动生成 | agent.qq.com</p>
      <p>如需调整筛选条件，请联系系统管理员</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 生成纯文本摘要（用于邮件预览）
 */
export function generateEmailText(result: EveningScanResult): string {
  const { date, stocks, criteria, totalScanned, filteredCount } = result;

  if (stocks.length === 0) {
    return `Serenity 晚间精选股票池 - ${date}
    
扫描结果：共扫描 ${totalScanned} 只股票，筛选出 0 只符合条件的股票

筛选条件：
- 上升趋势：${criteria.requireUptrend ? '是' : '否'}
- B信号时效：${criteria.maxBSignalAgeDays}个交易日内
- 预期涨幅：≥${criteria.minExpectedReturn}%
- 通道位置：底部${(criteria.maxChannelPosition * 100).toFixed(0)}%以内

当前没有符合所有筛选条件的股票，建议放宽筛选条件或等待下一个交易日。`;
  }

  const stockList = stocks.map((stock, index) => {
    return `${index + 1}. ${stock.name} (${stock.code}) - 现价: ¥${stock.price.toFixed(2)}, 预期涨幅: +${stock.expectedReturnBase.toFixed(1)}%, 盈亏比: ${stock.riskReward.toFixed(2)}`;
  }).join('\n');

  return `Serenity 晚间精选股票池 - ${date}

扫描结果：共扫描 ${totalScanned} 只股票，筛选出 ${filteredCount} 只符合条件的股票

筛选条件：
- 上升趋势：${criteria.requireUptrend ? '是' : '否'}
- B信号时效：${criteria.maxBSignalAgeDays}个交易日内
- 预期涨幅：≥${criteria.minExpectedReturn}%
- 通道位置：底部${(criteria.maxChannelPosition * 100).toFixed(0)}%以内

精选股票：
${stockList}

详细分析请查看邮件正文。

风险提示：以上内容仅供参考，不构成投资建议。投资有风险，入市需谨慎。`;
}
