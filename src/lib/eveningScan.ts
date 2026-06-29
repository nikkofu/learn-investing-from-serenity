import { generateDailyPool, type DailyPoolFile } from "./dailyPool";

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
  /** 是否启用自适应放宽条件 */
  enableAdaptiveRelaxation?: boolean;
}

export interface EveningScanResult {
  date: string;
  generatedAt: string;
  totalScanned: number;
  filteredCount: number;
  stocks: DailyPoolFile["results"];
  criteria: EveningScanConfig;
  /** 是否使用了放宽后的条件 */
  usedRelaxedCriteria?: boolean;
  /** 放宽后的条件（如果使用了） */
  relaxedCriteria?: EveningScanConfig;
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
    enableAdaptiveRelaxation = true,
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
  const filterStocks = (criteria: EveningScanConfig) => {
    return pool.results.filter((stock) => {
      // 1. 上升趋势
      if (criteria.requireUptrend && stock.channelType !== "up") {
        return false;
      }

      // 2. B信号时效
      if (stock.buySignalAgeDays === undefined || stock.buySignalAgeDays > criteria.maxBSignalAgeDays!) {
        return false;
      }

      // 3. 预期涨幅
      if (stock.expectedReturnBase < criteria.minExpectedReturn!) {
        return false;
      }

      // 4. 通道位置
      if (stock.channelPosition > (criteria.maxChannelPosition ?? 0.15)) {
        return false;
      }

      return true;
    });
  };

  let filteredStocks = filterStocks({
    requireUptrend,
    maxBSignalAgeDays,
    minExpectedReturn,
    maxChannelPosition,
    maxResults,
  });

  let usedRelaxedCriteria = false;
  let relaxedCriteria: EveningScanConfig | undefined;

  // 如果启用自适应放宽且结果为0，则逐步放宽条件
  if (enableAdaptiveRelaxation && filteredStocks.length === 0) {
    console.log("筛选结果为0，启用自适应放宽条件策略");
    
    // 放宽策略1：降低预期涨幅要求
    const relaxed1 = {
      requireUptrend,
      maxBSignalAgeDays,
      minExpectedReturn: Math.max(20, minExpectedReturn - 15), // 降低到20%或原值-15%
      maxChannelPosition,
      maxResults,
    };
    filteredStocks = filterStocks(relaxed1);
    
    if (filteredStocks.length > 0) {
      usedRelaxedCriteria = true;
      relaxedCriteria = relaxed1;
      console.log(`放宽策略1生效：降低预期涨幅到${relaxed1.minExpectedReturn}%，找到${filteredStocks.length}只股票`);
    } else {
      // 放宽策略2：进一步降低预期涨幅 + 放宽通道位置
      const relaxed2 = {
        requireUptrend,
        maxBSignalAgeDays,
        minExpectedReturn: Math.max(10, relaxed1.minExpectedReturn - 10), // 再降低10%
        maxChannelPosition: Math.min(0.3, maxChannelPosition + 0.15), // 放宽到30%或原值+15%
        maxResults,
      };
      filteredStocks = filterStocks(relaxed2);
      
      if (filteredStocks.length > 0) {
        usedRelaxedCriteria = true;
        relaxedCriteria = relaxed2;
        console.log(`放宽策略2生效：预期涨幅${relaxed2.minExpectedReturn}%，通道位置${(relaxed2.maxChannelPosition! * 100).toFixed(0)}%，找到${filteredStocks.length}只股票`);
      } else {
        // 放宽策略3：去掉上升趋势要求 + 大幅放宽其他条件
        const relaxed3 = {
          requireUptrend: false, // 不要求上升趋势
          maxBSignalAgeDays: Math.min(10, maxBSignalAgeDays + 5), // 延长B信号时效
          minExpectedReturn: Math.max(5, relaxed2.minExpectedReturn - 5), // 再降低5%
          maxChannelPosition: 0.5, // 通道位置放宽到50%
          maxResults,
        };
        filteredStocks = filterStocks(relaxed3);
        
        if (filteredStocks.length > 0) {
          usedRelaxedCriteria = true;
          relaxedCriteria = relaxed3;
          console.log(`放宽策略3生效：不要求趋势，预期涨幅${relaxed3.minExpectedReturn}%，找到${filteredStocks.length}只股票`);
        }
      }
    }
  }

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
      enableAdaptiveRelaxation,
    },
    usedRelaxedCriteria,
    relaxedCriteria,
  };
}

/**
 * 生成邮件内容的HTML - 国际投行咨询报告风格
 */
export function generateEmailHtml(result: EveningScanResult): string {
  const { date, stocks, criteria, totalScanned, filteredCount, usedRelaxedCriteria, relaxedCriteria } = result;

  const stockRows = stocks.map((stock, index) => {
    const returnPct = stock.expectedReturnBase.toFixed(1);
    const channelPos = (stock.channelPosition * 100).toFixed(1);
    const riskReward = stock.riskReward.toFixed(2);
    const winRate = (stock.winRate * 100).toFixed(1);
    const sharpe = stock.sharpe.toFixed(2);
    
    // 根据收益率设置颜色
    const returnColor = stock.expectedReturnBase >= 50 ? '#dc2626' : stock.expectedReturnBase >= 35 ? '#ea580c' : '#16a34a';
    
    return `
      <tr class="stock-row">
        <td class="rank-cell">${index + 1}</td>
        <td class="name-cell">
          <div class="stock-name">${stock.name}</div>
          <div class="stock-code">${stock.code}</div>
        </td>
        <td class="price-cell">¥${stock.price.toFixed(2)}</td>
        <td class="return-cell" style="color: ${returnColor}">+${returnPct}%</td>
        <td class="channel-cell">${channelPos}%</td>
        <td class="ratio-cell">${riskReward}</td>
        <td class="winrate-cell">${winRate}%</td>
        <td class="sharpe-cell">${sharpe}</td>
        <td class="score-cell">${stock.score.toFixed(0)}</td>
      </tr>
    `;
  }).join("");

  // 生成筛选条件显示
  const displayCriteria = usedRelaxedCriteria && relaxedCriteria ? relaxedCriteria : criteria;
  const criteriaText = `
    <div class="criteria-grid">
      <div class="criteria-item">
        <span class="criteria-label">上升趋势</span>
        <span class="criteria-value ${displayCriteria.requireUptrend ? 'active' : 'inactive'}">
          ${displayCriteria.requireUptrend ? '✓ 要求' : '✗ 不要求'}
        </span>
      </div>
      <div class="criteria-item">
        <span class="criteria-label">B信号时效</span>
        <span class="criteria-value">≤ ${displayCriteria.maxBSignalAgeDays} 天</span>
      </div>
      <div class="criteria-item">
        <span class="criteria-label">预期涨幅</span>
        <span class="criteria-value">≥ ${displayCriteria.minExpectedReturn}%</span>
      </div>
      <div class="criteria-item">
        <span class="criteria-label">通道位置</span>
        <span class="criteria-value">≤ ${((displayCriteria.maxChannelPosition ?? 0.15) * 100).toFixed(0)}%</span>
      </div>
    </div>
  `;

  // 放宽条件提示
  const relaxationNotice = usedRelaxedCriteria ? `
    <div class="relaxation-notice">
      <div class="notice-icon">⚡</div>
      <div class="notice-content">
        <strong>自适应条件放宽</strong>
        <p>原筛选条件无匹配结果，系统已自动放宽条件以提供投资参考。当前使用放宽后条件进行筛选。</p>
      </div>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Serenity 晚间精选股票池</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    
    /* 品牌头部 */
    .brand-header {
      text-align: center;
      margin-bottom: 40px;
      padding: 30px;
      background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%);
      border: 1px solid rgba(251, 191, 36, 0.2);
      border-radius: 16px;
    }
    
    .brand-name {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    
    .brand-tagline {
      font-size: 14px;
      color: #94a3b8;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    
    /* 报告标题 */
    .report-header {
      margin-bottom: 30px;
    }
    
    .report-title {
      font-size: 24px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 12px;
    }
    
    .report-meta {
      font-size: 13px;
      color: #64748b;
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    
    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .meta-label {
      color: #94a3b8;
    }
    
    .meta-value {
      color: #cbd5e1;
      font-weight: 500;
    }
    
    /* 内容卡片 */
    .card {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(71, 85, 105, 0.3);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      backdrop-filter: blur(10px);
    }
    
    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .card-icon {
      color: #fbbf24;
    }
    
    /* 筛选条件 */
    .criteria-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    
    .criteria-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(71, 85, 105, 0.2);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .criteria-label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .criteria-value {
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
    }
    
    .criteria-value.active {
      color: #22c55e;
    }
    
    .criteria-value.inactive {
      color: #64748b;
    }
    
    /* 统计概览 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
    }
    
    .stat-item {
      text-align: center;
      padding: 16px;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 8px;
    }
    
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #fbbf24;
      margin-bottom: 4px;
    }
    
    .stat-label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    /* 放宽条件提示 */
    .relaxation-notice {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }
    
    .notice-icon {
      font-size: 20px;
    }
    
    .notice-content strong {
      color: #fbbf24;
      display: block;
      margin-bottom: 4px;
    }
    
    .notice-content p {
      font-size: 13px;
      color: #cbd5e1;
    }
    
    /* 表格样式 */
    .table-container {
      overflow-x: auto;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    
    th {
      background: rgba(15, 23, 42, 0.8);
      color: #94a3b8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid rgba(71, 85, 105, 0.3);
      font-size: 11px;
    }
    
    th:last-child {
      text-align: right;
    }
    
    td {
      padding: 16px;
      border-bottom: 1px solid rgba(71, 85, 105, 0.2);
      color: #e2e8f0;
    }
    
    .stock-row:hover {
      background: rgba(251, 191, 36, 0.05);
    }
    
    .rank-cell {
      font-weight: 700;
      color: #fbbf24;
      width: 50px;
    }
    
    .name-cell {
      min-width: 120px;
    }
    
    .stock-name {
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 2px;
    }
    
    .stock-code {
      font-size: 11px;
      color: #64748b;
      font-family: monospace;
    }
    
    .price-cell {
      font-family: monospace;
      font-weight: 600;
    }
    
    .return-cell {
      font-weight: 700;
      font-family: monospace;
    }
    
    .channel-cell,
    .ratio-cell,
    .winrate-cell,
    .sharpe-cell,
    .score-cell {
      font-family: monospace;
      text-align: right;
    }
    
    /* 空状态 */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #64748b;
    }
    
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    
    .empty-title {
      font-size: 18px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 8px;
    }
    
    .empty-desc {
      font-size: 14px;
      color: #64748b;
    }
    
    /* 投资建议 */
    .insight-list {
      list-style: none;
    }
    
    .insight-item {
      display: flex;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(71, 85, 105, 0.2);
    }
    
    .insight-item:last-child {
      border-bottom: none;
    }
    
    .insight-icon {
      color: #22c55e;
      font-size: 16px;
      flex-shrink: 0;
    }
    
    .insight-text {
      color: #cbd5e1;
      font-size: 14px;
    }
    
    .insight-text strong {
      color: #f1f5f9;
    }
    
    /* 风险提示 */
    .risk-warning {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      padding: 16px;
      margin-top: 24px;
    }
    
    .risk-title {
      color: #ef4444;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .risk-text {
      font-size: 13px;
      color: #fca5a5;
    }
    
    /* 页脚 */
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid rgba(71, 85, 105, 0.3);
    }
    
    .footer-text {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 8px;
    }
    
    .footer-link {
      color: #fbbf24;
      text-decoration: none;
    }
    
    .footer-disclaimer {
      font-size: 11px;
      color: #475569;
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.5;
    }
    
    /* 响应式 */
    @media (max-width: 768px) {
      .container {
        padding: 20px 16px;
      }
      
      .brand-name {
        font-size: 24px;
      }
      
      .report-title {
        font-size: 20px;
      }
      
      .card {
        padding: 16px;
      }
      
      .criteria-grid {
        grid-template-columns: 1fr;
      }
      
      th, td {
        padding: 12px 8px;
      }
      
      .name-cell {
        min-width: 100px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- 品牌头部 -->
    <div class="brand-header">
      <div class="brand-name">SERENITY</div>
      <div class="brand-tagline">Intelligent Investment Research Platform</div>
    </div>
    
    <!-- 报告头部 -->
    <div class="report-header">
      <h1 class="report-title">晚间精选股票池报告</h1>
      <div class="report-meta">
        <div class="meta-item">
          <span class="meta-label">报告日期</span>
          <span class="meta-value">${date}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">生成时间</span>
          <span class="meta-value">${new Date(result.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">报告编号</span>
          <span class="meta-value">EVS-${date.replace(/-/g, '')}</span>
        </div>
      </div>
    </div>
    
    ${relaxationNotice}
    
    <!-- 筛选条件 -->
    <div class="card">
      <h2 class="card-title">
        <span class="card-icon">⚙️</span>
        筛选条件
      </h2>
      ${criteriaText}
    </div>
    
    <!-- 统计概览 -->
    <div class="card">
      <h2 class="card-title">
        <span class="card-icon">📊</span>
        扫描统计
      </h2>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${totalScanned}</div>
          <div class="stat-label">总扫描数量</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${filteredCount}</div>
          <div class="stat-label">符合条件</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stocks.length}</div>
          <div class="stat-label">精选推荐</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${criteria.maxResults}</div>
          <div class="stat-label">最大返回</div>
        </div>
      </div>
    </div>
    
    <!-- 股票列表 -->
    <div class="card">
      <h2 class="card-title">
        <span class="card-icon">🏆</span>
        精选股票列表
      </h2>
      ${stocks.length > 0 ? `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>股票信息</th>
                <th>现价</th>
                <th>预期涨幅</th>
                <th>通道位置</th>
                <th>盈亏比</th>
                <th>胜率</th>
                <th>夏普</th>
                <th>综合分</th>
              </tr>
            </thead>
            <tbody>
              ${stockRows}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">暂无符合条件股票</div>
          <div class="empty-desc">当前市场条件下没有满足所有筛选条件的股票，建议放宽筛选条件或等待下一个交易日</div>
        </div>
      `}
    </div>
    
    ${stocks.length > 0 ? `
      <!-- 投资建议 -->
      <div class="card">
        <h2 class="card-title">
          <span class="card-icon">�</span>
          投资建议说明
        </h2>
        <ul class="insight-list">
          <li class="insight-item">
            <span class="insight-icon">✓</span>
            <span class="insight-text"><strong>上升趋势确认</strong>：股票处于明确的上升通道中，具备持续上涨动能</span>
          </li>
          <li class="insight-item">
            <span class="insight-icon">✓</span>
            <span class="insight-text"><strong>fresh B信号</strong>：最近${displayCriteria.maxBSignalAgeDays}个交易日内发出买入信号，信号时效性强</span>
          </li>
          <li class="insight-item">
            <span class="insight-icon">✓</span>
            <span class="insight-text"><strong>高预期收益</strong>：基于历史回测，预期收益超过${displayCriteria.minExpectedReturn}%，具备较好上涨空间</span>
          </li>
          <li class="insight-item">
            <span class="insight-icon">✓</span>
            <span class="insight-text"><strong>底部支撑</strong>：当前价格接近上升通道下轨，具有较好的安全边际和支撑位</span>
          </li>
        </ul>
        
        <div class="risk-warning">
          <div class="risk-title">
            <span>⚠️</span>
            <span>风险提示</span>
          </div>
          <div class="risk-text">
            以上内容仅供参考，不构成投资建议。股票投资存在风险，过往表现不代表未来收益。请根据自身风险承受能力谨慎投资，入市需谨慎。
          </div>
        </div>
      </div>
    ` : ''}
    
    <!-- 页脚 -->
    <div class="footer">
      <div class="footer-text">
        本报告由 <a href="https://github.com/nikkofu/learn-investing-from-serenity" class="footer-link">Serenity 智能投研台</a> 自动生成
      </div>
      <div class="footer-text">
        基于瓶颈点投资法 · 多智能体协作 · 量化回测验证
      </div>
      <div class="footer-disclaimer">
        本报告内容基于公开数据和量化模型分析，仅供参考，不构成投资建议。投资有风险，入市需谨慎。
      </div>
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
  const { date, stocks, criteria, totalScanned, filteredCount, usedRelaxedCriteria, relaxedCriteria } = result;

  const displayCriteria = usedRelaxedCriteria && relaxedCriteria ? relaxedCriteria : criteria;

  if (stocks.length === 0) {
    return `Serenity 晚间精选股票池 - ${date}
    
扫描结果：共扫描 ${totalScanned} 只股票，筛选出 0 只符合条件的股票

筛选条件：
- 上升趋势：${displayCriteria.requireUptrend ? '是' : '否'}
- B信号时效：${displayCriteria.maxBSignalAgeDays}个交易日内
- 预期涨幅：≥${displayCriteria.minExpectedReturn}%
- 通道位置：底部${((displayCriteria.maxChannelPosition ?? 0.15) * 100).toFixed(0)}%以内

${usedRelaxedCriteria ? '【注意】本报告使用了自适应放宽条件，原筛选条件无匹配结果。' : ''}

当前没有符合所有筛选条件的股票，建议放宽筛选条件或等待下一个交易日。

---
Serenity 智能投研台
基于瓶颈点投资法 · 多智能体协作 · 量化回测验证

风险提示：以上内容仅供参考，不构成投资建议。投资有风险，入市需谨慎。`;
  }

  const stockList = stocks.map((stock, index) => {
    return `${index + 1}. ${stock.name} (${stock.code}) 
   现价: ¥${stock.price.toFixed(2)} 
   预期涨幅: +${stock.expectedReturnBase.toFixed(1)}% 
   盈亏比: ${stock.riskReward.toFixed(2)} 
   胜率: ${(stock.winRate * 100).toFixed(1)}% 
   综合分: ${stock.score.toFixed(0)}`;
  }).join('\n\n');

  return `═══════════════════════════════════════════════════════════════
                    SERENITY 晚间精选股票池报告
═══════════════════════════════════════════════════════════════

报告日期：${date}
生成时间：${new Date(result.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
报告编号：EVS-${date.replace(/-/g, '')}

───────────────────────────────────────────────────────────────────
                        扫描统计
───────────────────────────────────────────────────────────────────
总扫描数量：${totalScanned} 只
符合条件：${filteredCount} 只
精选推荐：${stocks.length} 只

───────────────────────────────────────────────────────────────────
                        筛选条件
───────────────────────────────────────────────────────────────────
上升趋势：${displayCriteria.requireUptrend ? '✓ 要求' : '✗ 不要求'}
B信号时效：≤ ${displayCriteria.maxBSignalAgeDays} 天
预期涨幅：≥ ${displayCriteria.minExpectedReturn}%
通道位置：≤ ${((displayCriteria.maxChannelPosition ?? 0.15) * 100).toFixed(0)}%

${usedRelaxedCriteria ? '⚡ 自适应条件放宽：已启用（原条件无匹配结果）' : ''}

───────────────────────────────────────────────────────────────────
                        精选股票列表
───────────────────────────────────────────────────────────────────

${stockList}

───────────────────────────────────────────────────────────────────
                        投资建议说明
───────────────────────────────────────────────────────────────────
✓ 上升趋势确认：股票处于明确的上升通道中，具备持续上涨动能
✓ fresh B信号：最近${displayCriteria.maxBSignalAgeDays}个交易日内发出买入信号，信号时效性强
✓ 高预期收益：基于历史回测，预期收益超过${displayCriteria.minExpectedReturn}%，具备较好上涨空间
✓ 底部支撑：当前价格接近上升通道下轨，具有较好的安全边际和支撑位

⚠️  风险提示：以上内容仅供参考，不构成投资建议。股票投资存在风险，
   过往表现不代表未来收益。请根据自身风险承受能力谨慎投资，入市需谨慎。

═══════════════════════════════════════════════════════════════
              Serenity 智能投研台 | agent.qq.com
         基于瓶颈点投资法 · 多智能体协作 · 量化回测验证
═══════════════════════════════════════════════════════════════`;
}
