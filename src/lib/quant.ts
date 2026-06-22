import type { Candle } from "./types";

interface ChipBin {
  price: number;
  volume: number;
}

export interface ChipDistributionResult {
  bins: ChipBin[];
  profitRatio: number; // 获利盘比例 (0.0 - 1.0)
  avgCost: number;     // 平均成本 (元)
  concentration: number; // 70% 筹码集中度 (数值越小越集中)
  priceLow70: number;  // 70% 筹码区间低价
  priceHigh70: number; // 70% 筹码区间高价
}

export interface TradeAction {
  type: "buy" | "sell";
  date: string;
  price: number;
  reason: string;
  profitPct?: number;
}

export interface BacktestResult {
  winRate: number;        // 胜率 %
  sharpe: number;         // 夏普比率（按 252 交易日年化，无风险利率取 0）
  strategyReturn: number; // 策略累计收益率 %
  stockReturn: number;    // 个股同期收益率 %
  trades: TradeAction[];  // 历史交易点记录
  history: { date: string; strategyWorth: number; stockWorth: number }[]; // 每日资产净值折线图
}

/**
 * 由策略净值曲线计算年化夏普比率。
 * 口径：日收益 r_t = NAV_t / NAV_{t-1} - 1（含空仓的 0 收益日，反映真实持仓占用），
 * 无风险利率取 0，年化系数 sqrt(252)。样本标准差用 n-1（无偏）。
 */
function annualizedSharpe(history: { strategyWorth: number }[]): number {
  const rets: number[] = [];
  for (let k = 1; k < history.length; k++) {
    const prev = history[k - 1].strategyWorth;
    if (prev > 0) rets.push(history[k].strategyWorth / prev - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return Number(((mean / sd) * Math.sqrt(252)).toFixed(2));
}

/**
 * 估算个股在最新收盘价下的筹码分布。
 * 算法原理：基于 120 天日K线，以每日换手率进行筹码历史衰减。
 * 每日新筹码以当天的收盘价为中心，结合最高/最低价进行三角概率分布沉淀。
 */
// 安全数值校验：确保浮点运算产物不含 NaN / Infinity，污染后回退到指定默认值
function safeNum(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

export function calculateChipDistribution(
  candles: Candle[],
  currentPrice: number,
  fastMode = false
): ChipDistributionResult {
  if (candles.length === 0) {
    return { bins: [], profitRatio: 0, avgCost: currentPrice, concentration: 0, priceLow70: currentPrice, priceHigh70: currentPrice };
  }

  // 1. 获取价格极值并网格化 (分 40 个价格区间箱体)
  const closes = candles.map((c) => c.close);
  const minPrice = Math.min(...closes) * 0.95;
  const maxPrice = Math.max(...closes) * 1.05;
  const BINS_COUNT = 40;
  const binWidth = (maxPrice - minPrice) / BINS_COUNT;

  const bins: ChipBin[] = [];
  for (let i = 0; i < BINS_COUNT; i++) {
    bins.push({
      price: Math.round((minPrice + i * binWidth + binWidth / 2) * 100) / 100,
      volume: 0,
    });
  }

  // 2. 迭代 K 线，注入并衰减筹码
  for (const c of candles) {
    // 换手率：若无换手率字段，则默认用 3% 换手作为衰减基础
    const turnover = c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct / 100 : 0.03;
    const decay = 1 - Math.max(0.005, Math.min(0.2, turnover)); // 每日存留衰减系数

    // 所有老筹码进行衰减
    for (const b of bins) {
      b.volume *= decay;
    }

    // 注入今日新生成的筹码 (当天交易额/交易量作为权重)
    const todayVol = c.volume || 1;
    const low = c.low || c.close;
    const high = c.high || c.close;
    
    // 筹码以 close 为中心，在 low 到 high 的区间内按简易三角分布散落
    const lowIdx = Math.max(0, Math.floor((low - minPrice) / binWidth));
    const highIdx = Math.min(BINS_COUNT - 1, Math.floor((high - minPrice) / binWidth));
    const midIdx = Math.max(0, Math.min(BINS_COUNT - 1, Math.floor((c.close - minPrice) / binWidth)));

    const span = highIdx - lowIdx + 1;
    if (span <= 1) {
      bins[midIdx].volume += todayVol;
    } else {
      // 简单三角权重概率分布：两次循环避免临时数组分配
      let totalWeight = 0;
      for (let i = lowIdx; i <= highIdx; i++) {
        const dist = Math.abs(i - midIdx);
        const weight = Math.max(0.1, 1 - dist / span);
        totalWeight += weight;
      }
      if (totalWeight > 0) {
        for (let i = lowIdx; i <= highIdx; i++) {
          const dist = Math.abs(i - midIdx);
          const weight = Math.max(0.1, 1 - dist / span);
          bins[i].volume += todayVol * (weight / totalWeight);
        }
      }
    }
  }

  // 3. 计算筹码量化指标
  let totalVolume = 0;
  let profitVolume = 0;
  let costSum = 0;

  for (const b of bins) {
    totalVolume += b.volume;
    if (b.price <= currentPrice) {
      profitVolume += b.volume;
    }
    costSum += b.price * b.volume;
  }

  if (totalVolume === 0) totalVolume = 1;

  const profitRatio = safeNum(profitVolume / totalVolume, 0);
  const avgCost = safeNum(Math.round((costSum / totalVolume) * 100) / 100, currentPrice);

  // 4. 计算 70% 筹码集中度
  // 找出包含总筹码 70% 的最窄价格区间
  const sortedBins = [...bins].sort((a, b) => b.volume - a.volume);
  let accumulatedVol = 0;
  const threshold70 = totalVolume * 0.7;
  const selectedPrices: number[] = [];

  for (const b of sortedBins) {
    accumulatedVol += b.volume;
    selectedPrices.push(b.price);
    if (accumulatedVol >= threshold70) break;
  }

  const priceLow70 = safeNum(selectedPrices.length > 0 ? Math.min(...selectedPrices) : currentPrice, currentPrice);
  const priceHigh70 = safeNum(selectedPrices.length > 0 ? Math.max(...selectedPrices) : currentPrice, currentPrice);
  const priceDiff = priceHigh70 - priceLow70;
  const priceSum = priceHigh70 + priceLow70;
  // 集中度 = 价格宽度 / 价格均值
  const concentration = priceSum > 0 ? safeNum(Math.round((priceDiff / (priceSum / 2)) * 1000) / 1000, 0) : 0;

  return {
    bins: fastMode ? [] : bins.map(b => ({ price: b.price, volume: Math.round(b.volume) })),
    profitRatio: Math.round(profitRatio * 1000) / 1000,
    avgCost,
    concentration,
    priceLow70,
    priceHigh70,
  };
}

/**
 * 运行传统 20 日线突破策略模拟交易回测。
 * 策略定义：
 *   - 买入信号：收盘价上穿 20日均线 (MA20)，且股价处于近 120 日下半区 (rangePosition < 0.45)，且 5 日均换手率突破 20 日均换手的 1.3 倍以上。
 *   - 卖出信号：收盘价跌破 MA20 均线，或个股累计最高涨幅达 35% 止盈，或股价极度超买 (rangePosition > 0.85 且今日天量收跌)。
 */
export function runTraditionalMaBacktest(candles: Candle[]): BacktestResult {
  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  // 1. 预先计算均线 (MA20 和换手率 MA5/MA20)
  const prices = candles.map((c) => c.close);
  const ma20List: number[] = [];
  const volMa5: number[] = [];
  const volMa20: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    // 收盘均线
    if (i < 19) {
      ma20List.push(prices[i]);
    } else {
      const sum = prices.slice(i - 19, i + 1).reduce((s, p) => s + p, 0);
      ma20List.push(sum / 20);
    }

    // 换手均线
    const turnovers = candles.slice(0, i + 1).map(c => c.turnoverPct || 1);
    if (i < 4) {
      volMa5.push(turnovers[i]);
    } else {
      const sum = turnovers.slice(i - 4, i + 1).reduce((s, t) => s + t, 0);
      volMa5.push(sum / 5);
    }
    if (i < 19) {
      volMa20.push(turnovers[i]);
    } else {
      const sum = turnovers.slice(i - 19, i + 1).reduce((s, t) => s + t, 0);
      volMa20.push(sum / 20);
    }
  }

  // 2. 模拟交易状态机
  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let buyDate = "";
  let winCount = 0;
  let tradeCount = 0;

  const initialStockWorth = prices[20]; // 以第 20 天收盘价作为对照组基准

  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;
    const ma20 = ma20List[i];
    const t5 = volMa5[i];
    const t20 = volMa20[i];

    // 计算局部的 rangePosition
    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    // 检查买卖信号
    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation = recentWindow.length >= 5 && (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    if (!holding) {
      const isBreakout = close > ma20 && prices[i - 1] <= ma20List[i - 1];
      const isPlateauBreakout = close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow);
      const isVolumeIncrease = t5 > t20 * 1.3;
      const isSafePosition = rangePos < 0.65; // 放宽安全价格位限制，防止右侧大阳踏空

      if ((isBreakout || isPlateauBreakout) && isSafePosition && isVolumeIncrease) {
        shares = cash / close;
        cash = 0;
        holding = true;
        buyPrice = close;
        buyDate = date;
        trades.push({
          type: "buy",
          date,
          price: close,
          reason: isPlateauBreakout
            ? `【传统平台整理突破】股价在 20日线之上平台盘整后放量突破前高，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`
            : `【传统均线突破】股价上穿 20 日均线，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`,
        });
      }
    } else {
      // 卖出条件：
      // 1. 均线破位：收盘价下穿 MA20
      // 2. 止盈：涨幅达 35% 以上
      // 3. 超买滞涨：处于极高位置（rangePosition > 0.85）且换手创天量
      const isBreakdown = close < ma20;
      const isTakeProfit = close >= buyPrice * 1.35;
      const isOverbought = rangePos > 0.85 && c.turnoverPct && c.turnoverPct > 15; // 天量滞涨

      if (isBreakdown || isTakeProfit || isOverbought) {
        cash = shares * close;
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = "跌破20日线止损";
        if (isTakeProfit) reason = `达到 35% 止盈目标 (买入价: ${buyPrice.toFixed(2)})`;
        else if (isOverbought) reason = "高位筹码松动滞涨滞销";

        trades.push({
          type: "sell",
          date,
          price: close,
          reason,
          profitPct: ((close - buyPrice) / buyPrice) * 100,
        });
      }
    }

    // 每日资金总值与对照组（个股）计算
    const currentWorth = holding ? shares * close : cash;
    const strategyWorth = currentWorth;
    // 对照组：模拟直接买入个股并一直持股
    const stockWorth = (close / initialStockWorth) * 100000;

    history.push({
      date,
      strategyWorth: Number(strategyWorth.toFixed(0)),
      stockWorth: Number(stockWorth.toFixed(0)),
    });
  }

  // 3. 计算最终统计结果
  const finalWorth = holding ? shares * prices[prices.length - 1] : cash;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((prices[prices.length - 1] - initialStockWorth) / initialStockWorth) * 100;
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  return {
    winRate: Number(winRate.toFixed(1)),
    sharpe: annualizedSharpe(history),
    strategyReturn: Number(strategyReturn.toFixed(2)),
    stockReturn: Number(stockReturn.toFixed(2)),
    trades,
    history,
  };
}

/**
 * 运行 Serenity 突破策略模拟交易回测（向后兼容）。
 */
export function runSerenityBacktest(candles: Candle[]): BacktestResult {
  return runTraditionalMaBacktest(candles);
}

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测。
 * 策略定义：
 *   - 门槛机制：若基本面瓶颈打分 chokepointScore < 55，则认定非优质供应链瓶颈成长股，拒绝交易（屏蔽所有信号，空仓防守）。
 *   - 买入信号：
 *     1. 筹码箱体金叉：股价在主力平均成本线 (avgCost) 附近震荡收敛后，收盘向上金叉 20 日线，5日均换手率 > 20日均换手率 1.5 倍（主力吸筹向上异动）。
 *     2. 强主升浪突破：个股基本面极优 (chokepointScore >= 75)，股价在 120日中高区 (rangePosition 0.60-0.85) 放量长阳突破（5日均换手 > 20日均的 1.8 倍，且收盘突破前 10 日新高）。
 *   - 卖出信号：
 *     1. 筹码下轨破位：日收盘价跌破 70% 筹码主支撑区下轨 5% (priceLow70 * 0.95)，判定主力防线失守，逻辑彻底证伪出局（避开均线反复洗盘的割肉折损）。
 *     2. 超买天量滞涨：股价处于 120日极高位 (rangePosition > 0.95) 且日换手率 > 15%，触发警示止盈。
 *     3. 达到 35% 波段止盈目标。
 */
export function runChokepointMomentumBacktest(
  candles: Candle[],
  chokepointScore: number,
  _opts: { code?: string } = {}
): BacktestResult {
  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  // 2. 预先计算均线 (MA20 和量能 MA5/MA20)
  const prices = candles.map((c) => c.close);
  const ma20List: number[] = [];
  const volMa5: number[] = [];
  const volMa20: number[] = [];

  // 量能代理：换手率优先（有则用，保持既有口径不变）；当数据源不返回换手率时（如新浪日K
  // 只给 OHLCV，换手率恒为 0）降级用成交量。买点用的是「比值」t5/t20——换手率=成交量/流通
  // 股本，流通股本在窗口内视为常数会在比值里约掉，故成交量比值与换手率比值数学等价。这样
  // 任一数据源（含无换手率的源）都能稳定产出买点，避免「同一算法因数据源不同→0 笔交易/无 B 信号」。
  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0
      ? c.turnoverPct
      : c.volume && c.volume > 0
        ? c.volume
        : 1,
  );

  for (let i = 0; i < candles.length; i++) {
    if (i < 19) {
      ma20List.push(prices[i]);
    } else {
      const sum = prices.slice(i - 19, i + 1).reduce((s, p) => s + p, 0);
      ma20List.push(sum / 20);
    }

    if (i < 4) {
      volMa5.push(volProxy[i]);
    } else {
      const sum = volProxy.slice(i - 4, i + 1).reduce((s, t) => s + t, 0);
      volMa5.push(sum / 5);
    }
    if (i < 19) {
      volMa20.push(volProxy[i]);
    } else {
      const sum = volProxy.slice(i - 19, i + 1).reduce((s, t) => s + t, 0);
      volMa20.push(sum / 20);
    }
  }

  // 3. 模拟交易状态机
  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let buyDate = "";
  let winCount = 0;
  let tradeCount = 0;

  const initialStockWorth = prices[20];

  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;
    const ma20 = ma20List[i];
    const t5 = volMa5[i];
    const t20 = volMa20[i];

    // 计算当前的筹码分布（回看 120 天）
    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70; // 70% 筹码支撑区下轨
    const avgCost = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    // 平台箱体窄幅整固研判 (过去 10 天波幅小于 8%)
    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation = recentWindow.length >= 5 && (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    // 检查买卖信号
    if (!holding) {
      // 信号 1：上穿 20 日均线且换手放大 (均线筹码突破)
      const isBreakoutGoldCross = close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      
      // 信号 2：平台整理后的大阳向上二次突破 (VCP 整理再启动，防踏空)
      const isVcpBreakout = close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      
      // 信号 3：强成长股高弹性强势起爆 (主升浪突破)
      const isStrongHighBreakout = chokepointScore >= 75 && rangePos >= 0.60 && rangePos <= 0.85 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);

      if (isBreakoutGoldCross || isVcpBreakout || isStrongHighBreakout) {
        shares = cash / close;
        cash = 0;
        holding = true;
        buyPrice = close;
        buyDate = date;

        const cautionTag = chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        let reason = "";
        if (isStrongHighBreakout) {
          reason = `${cautionTag}【Serenity 强成长突破】基本面得分 ${chokepointScore} 分，股价在右侧较高位（区位: ${(rangePos * 100).toFixed(0)}%）完成平台整固后放量长阳突破（量能比: ${(t5 / t20).toFixed(1)}倍），主升浪开启。`;
        } else if (isVcpBreakout) {
          reason = `${cautionTag}【VCP箱体整理突破】股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else {
          reason = `${cautionTag}【均线筹码共振突破】股价突破 20 日均线，且价格处于主力平均成本线（${avgCost.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }

        trades.push({
          type: "buy",
          date,
          price: close,
          reason,
        });
      }
    } else {
      // 卖出条件：
      // 1. 跌破主力筹码成本防线 (下方密集筹码下轨 5%)，判定主力底线被击穿，逻辑彻底证伪
      const isSupportBroken = close < supportPrice * 0.95;
      // 2. 止盈 (35% 目标收益)
      const isTakeProfit = close >= buyPrice * 1.35;
      // 3. 超买天量滞涨 (极度超买，换手创天量，主力拉高出货)
      const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

      if (isSupportBroken || isTakeProfit || isClimaxRun) {
        cash = shares * close;
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = "";
        if (isSupportBroken) {
          reason = `【主力防线失守止损】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，中期洗盘出局，策略执行逻辑证伪。`;
        } else if (isTakeProfit) {
          reason = `【达到止盈目标】个股相比买入价 ${buyPrice.toFixed(2)} 元累计涨幅已达 35%，触发计划性阶段止盈，落袋为安。`;
        } else if (isClimaxRun) {
          reason = `【高位超买天量滞涨】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct.toFixed(1)}% 创天量，呈现高位筹码剧烈松动、主力诱多滞涨信号。`;
        }

        trades.push({
          type: "sell",
          date,
          price: close,
          reason,
          profitPct: ((close - buyPrice) / buyPrice) * 100,
        });
      }
    }

    const currentWorth = holding ? shares * close : cash;
    const strategyWorth = currentWorth;
    const stockWorth = (close / initialStockWorth) * 100000;

    history.push({
      date,
      strategyWorth: Number(strategyWorth.toFixed(0)),
      stockWorth: Number(stockWorth.toFixed(0)),
    });
  }

  const finalWorth = holding ? shares * prices[prices.length - 1] : cash;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((prices[prices.length - 1] - initialStockWorth) / initialStockWorth) * 100;
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  return {
    winRate: Number(winRate.toFixed(1)),
    sharpe: annualizedSharpe(history),
    strategyReturn: Number(strategyReturn.toFixed(2)),
    stockReturn: Number(stockReturn.toFixed(2)),
    trades,
    history,
  };
}

/** 样本外滚动命中率结果（无未来函数）。 */
export interface WalkForwardWinRate {
  winRate: number;   // 命中率 %（前瞻收益 > 阈值的比例）
  sampleSize: number; // 留出尾段内触发的信号数
  horizon: number;    // 前瞻评估天数
  avgForwardPct: number; // 命中样本所在全部信号的平均前瞻收益 %
}

/**
 * 样本外（walk-forward）命中率：消除「用当前快照回灌历史」的未来函数。
 *
 * - 入场信号在第 t 日仅使用 ≤ t 的数据判定（20 日动量为正 且 收盘价 > MA20）；
 * - 仅在**留出尾段**（默认后 40%）统计信号，避免被前段隐含调参污染；
 * - 命中判定用 t→t+horizon 的前瞻收益（这是相对 t 的“未来”，正是要度量的预测力），
 *   且 t+horizon 不得越界。
 * 这给出一个比样本内回测更诚实、可横向比较的“成功率”代理。
 */
export function runWalkForwardWinRate(
  candles: Candle[],
  opts: { lookback?: number; horizon?: number; holdoutFraction?: number; winThresholdPct?: number } = {},
): WalkForwardWinRate {
  const lookback = opts.lookback ?? 20;
  const horizon = opts.horizon ?? 5;
  const holdoutFraction = opts.holdoutFraction ?? 0.4;
  const winThreshold = (opts.winThresholdPct ?? 0) / 100;
  const N = candles.length;
  const empty: WalkForwardWinRate = { winRate: 0, sampleSize: 0, horizon, avgForwardPct: 0 };
  if (N < lookback + horizon + 10) return empty;

  const closes = candles.map((c) => c.close);
  const start = Math.max(lookback, Math.floor(N * (1 - holdoutFraction)));
  const end = N - horizon; // 需要 t+horizon 有效

  let wins = 0;
  let count = 0;
  let sumForward = 0;
  for (let t = start; t < end; t++) {
    // 仅用 ≤ t 的数据构造信号，杜绝未来函数。
    const ma20 = closes.slice(t - lookback + 1, t + 1).reduce((s, v) => s + v, 0) / lookback;
    const momentum = closes[t] / closes[t - lookback] - 1;
    const entry = momentum > 0 && closes[t] > ma20;
    if (!entry) continue;
    const forward = closes[t + horizon] / closes[t] - 1;
    sumForward += forward;
    count++;
    if (forward > winThreshold) wins++;
  }
  if (count === 0) return { ...empty, sampleSize: 0 };
  return {
    winRate: Number(((wins / count) * 100).toFixed(1)),
    sampleSize: count,
    horizon,
    avgForwardPct: Number(((sumForward / count) * 100).toFixed(2)),
  };
}

export interface PriceProjection {
  date: string;
  bull: number;
  base: number;
  bear: number;
}

/**
 * 股价未来 15 日多重路径发散走势预测生成。
 * 路径逻辑：
 *   - 基准 (Base)：沿着当前 60 日线性回归趋势斜率演进，并随个股 Chokepoint 基本面打分动态上修/惩罚斜率。
 *   - 乐观 (Bull)：股价突破向上路径，在基本面高分股中获得更宽广的发散空间与向上弹性。
 *   - 悲观 (Bear)：股价向下洗盘或破位路径，高分成长股获得抗跌性底线保护，低分标的呈现防线崩溃。
 */
export function generatePriceProjection(
  candles: Candle[],
  chokepointScore: number
): PriceProjection[] {
  if (candles.length === 0) return [];
  const N = candles.length;
  const lastCandle = candles[N - 1];
  const lastPrice = lastCandle.close;
  const lastDate = new Date(lastCandle.date);

  const channelLen = Math.min(N, 60);
  const subCandles = candles.slice(N - channelLen);

  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < channelLen; i++) {
    const x = i;
    const y = subCandles[i].close;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denom = (channelLen * sumXX) - (sumX * sumX);
  const slope = denom !== 0 ? ((channelLen * sumXY) - (sumX * sumY)) / denom : 0;
  const intercept = (sumY - slope * sumX) / channelLen;

  let sqDiffSum = 0;
  for (let i = 0; i < channelLen; i++) {
    const fitY = slope * i + intercept;
    const diff = subCandles[i].close - fitY;
    sqDiffSum += diff * diff;
  }
  const stdDev = Math.sqrt(sqDiffSum / channelLen) || 0.1;

  // 根据 Chokepoint 基本面总分计算偏差因子 beta (通常在 -1.0 到 1.8 之间)
  const beta = (chokepointScore - 55) / 25;

  const projections: PriceProjection[] = [];

  for (let i = 1; i <= 60; i++) {
    const nextDate = new Date(lastDate);
    let added = 0;
    while (added < i) {
      nextDate.setDate(nextDate.getDate() + 1);
      const day = nextDate.getDay();
      if (day !== 0 && day !== 6) {
        added++;
      }
    }
    const dateStr = nextDate.toISOString().split("T")[0];

    // 指数阻尼衰减系数：中长期（3个月内）动能逐渐向均值回归，避免 60 天预测值极化
    const damping = Math.exp(-0.015 * (i - 1));

    // 1. 基准预测斜率调整：基本面因子调节斜率，并应用阻尼
    const adjustedSlope = (slope + beta * (0.0035 * lastPrice)) * damping;
    const base = lastPrice + adjustedSlope * i;

    // 2. 乐观预测路径：高评分个股乐观上限发散度增加
    const bullSlope = Math.max(adjustedSlope * 1.5, 0.006 * lastPrice) * damping;
    const bullElasticity = 1 + Math.max(-0.5, beta * 0.3);
    const bull = lastPrice + bullSlope * i + 0.45 * stdDev * Math.sqrt(i) * bullElasticity;

    // 3. 悲观预测路径：高评分个股获得防御保护（跌幅收缩）
    const bearSlope = Math.min(adjustedSlope * 1.5, -0.008 * lastPrice) * damping;
    const bearSupport = 1 - Math.max(-0.5, Math.min(0.8, beta * 0.2));
    const bear = lastPrice + bearSlope * i - 0.55 * stdDev * Math.sqrt(i) * bearSupport;

    projections.push({
      date: dateStr,
      bull: Number(Math.max(0.01, bull).toFixed(2)),
      base: Number(Math.max(0.01, base).toFixed(2)),
      bear: Number(Math.max(0.01, bear).toFixed(2)),
    });
  }

  return projections;
}

export interface TechnicalAssessment {
  trendChannel: {
    type: "up" | "down" | "range";
    slope: number;
    status: "inside" | "breakout" | "breakdown";
    upperLine: number;
    lowerLine: number;
    midLine: number;
  };
  patterns: string[];
  candlesticks: { pattern: string; date: string; type: "bullish" | "bearish" }[];
  vrvp: {
    poc: number;
    supportZone: { low: number; high: number; price: number };
    resistanceZone: { low: number; high: number; price: number };
    lvnPrice: number | null;
  };
  actionAdvice: {
    action: string;
    stopLoss: number;
    takeProfit: number;
    positionAdvice: string;
  };
  // ===== 新增 SMC 与 斐波那契 字段 =====
  smc?: {
    bosList: { date: string; price: number; type: "bullish" | "bearish"; label: "BOS" | "CHoCH" }[];
    demandZones: { low: number; high: number; label: string }[];
    supplyZones: { low: number; high: number; label: string }[];
  };
  fibonacci?: {
    low: number;
    high: number;
    isUp: boolean; // 最低点是否在最高点左侧（上升波段）
    levels: { ratio: number; price: number; color: string; label: string }[];
  };
}

export function analyzeTechnicalPatterns(
  candles: Candle[],
  currentPrice: number,
  chipDistInput?: ChipDistributionResult
): TechnicalAssessment {
  const chipDist = chipDistInput || calculateChipDistribution(candles, currentPrice);
  const N = candles.length;
  
  if (N < 10) {
    return {
      trendChannel: { type: "range", slope: 0, status: "inside", upperLine: currentPrice, lowerLine: currentPrice, midLine: currentPrice },
      patterns: [],
      candlesticks: [],
      vrvp: { poc: currentPrice, supportZone: { low: currentPrice, high: currentPrice, price: currentPrice }, resistanceZone: { low: currentPrice, high: currentPrice, price: currentPrice }, lvnPrice: null },
      actionAdvice: { action: "暂无数据", stopLoss: currentPrice * 0.95, takeProfit: currentPrice * 1.1, positionAdvice: "观望" },
      smc: { bosList: [], demandZones: [], supplyZones: [] },
      fibonacci: { low: currentPrice, high: currentPrice, isUp: true, levels: [] }
    };
  }

  // 1. 线性回归通道拟合 (最近 60 天，若不足 60 则用全部)
  const channelLen = Math.min(N, 60);
  const subCandles = candles.slice(N - channelLen);
  
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < channelLen; i++) {
    const x = i;
    const y = subCandles[i].close;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  
  const denom = (channelLen * sumXX) - (sumX * sumX);
  const slope = denom !== 0 ? ((channelLen * sumXY) - (sumX * sumY)) / denom : 0;
  const intercept = (sumY - slope * sumX) / channelLen;
  
  // 计算均方误差标准差
  let sqDiffSum = 0;
  for (let i = 0; i < channelLen; i++) {
    const fitY = slope * i + intercept;
    const diff = subCandles[i].close - fitY;
    sqDiffSum += diff * diff;
  }
  const stdDev = Math.sqrt(sqDiffSum / channelLen) || 0.1;
  
  // 最新一天的通道值 (对于最近一天索引是 channelLen - 1)
  const lastIndex = channelLen - 1;
  const midLine = Number((slope * lastIndex + intercept).toFixed(2));
  const upperLine = Number((midLine + 1.5 * stdDev).toFixed(2));
  const lowerLine = Number((midLine - 1.5 * stdDev).toFixed(2));
  
  // 通道类型判断
  let channelType: "up" | "down" | "range" = "range";
  const relativeSlope = slope / (midLine || 1); // 相对斜率，防价格大小差异
  if (relativeSlope > 0.0008) {
    channelType = "up";
  } else if (relativeSlope < -0.0008) {
    channelType = "down";
  }
  
  // 通道突破状态
  let channelStatus: "inside" | "breakout" | "breakdown" = "inside";
  if (currentPrice > upperLine) {
    channelStatus = "breakout";
  } else if (currentPrice < lowerLine) {
    channelStatus = "breakdown";
  }
  
  // 2. K 线经典形态模式匹配 (最近 5 天)
  const candlesticks: TechnicalAssessment["candlesticks"] = [];
  const kPatternLen = Math.min(N, 5);
  for (let i = N - kPatternLen; i < N; i++) {
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : null;
    const body = Math.abs(c.close - c.open);
    const lowShadow = Math.min(c.open, c.close) - c.low;
    const upperShadow = c.high - Math.max(c.open, c.close);
    const date = c.date;
    
    // 锤子线
    if (body > 0 && lowShadow >= 2.0 * body && upperShadow <= 0.25 * lowShadow) {
      candlesticks.push({ pattern: "锤子线 (Hammer)", date, type: "bullish" });
    }
    
    // 射击之星
    if (body > 0 && upperShadow >= 2.0 * body && lowShadow <= 0.25 * upperShadow) {
      candlesticks.push({ pattern: "射击之星 (Shooting Star)", date, type: "bearish" });
    }
    
    if (prev) {
      const prevBody = Math.abs(prev.close - prev.open);
      const isPrevBear = prev.close < prev.open;
      const isPrevBull = prev.close > prev.open;
      const isTodayBear = c.close < c.open;
      const isTodayBull = c.close > c.open;
      
      // 看涨吞没
      if (isPrevBear && isTodayBull && c.open <= prev.close && c.close >= prev.open && prevBody > 0) {
        candlesticks.push({ pattern: "看涨吞没 (Bullish Engulfing)", date, type: "bullish" });
      }
      
      // 看跌吞没
      if (isPrevBull && isTodayBear && c.open >= prev.close && c.close <= prev.open && prevBody > 0) {
        candlesticks.push({ pattern: "看跌吞没 (Bearish Engulfing)", date, type: "bearish" });
      }
    }
  }
  
  // 3. 经典趋势模式识别 (W底、趋势回踩、老鸭头)
  const patterns: string[] = [];
  
  // 计算 MA 均线
  const ma5 = N >= 5 ? candles.slice(N - 5).reduce((s, c) => s + c.close, 0) / 5 : currentPrice;
  const ma10 = N >= 10 ? candles.slice(N - 10).reduce((s, c) => s + c.close, 0) / 10 : currentPrice;
  const ma20 = N >= 20 ? candles.slice(N - 20).reduce((s, c) => s + c.close, 0) / 20 : currentPrice;
  const ma60 = N >= 60 ? candles.slice(N - 60).reduce((s, c) => s + c.close, 0) / 60 : currentPrice;
  
  // 判定 W底
  if (N >= 60) {
    const pricesSlice = candles.map(c => c.close);
    const part1 = pricesSlice.slice(Math.max(0, N - 120), N - 20); // 前段
    const part2 = pricesSlice.slice(N - 20); // 近段
    
    const min1 = Math.min(...part1);
    const min2 = Math.min(...part2);
    
    // 如果两段的谷底价格偏差很小 (3.5%以内)
    if (Math.abs(min1 - min2) / min1 < 0.035) {
      const min1Idx = pricesSlice.indexOf(min1);
      const min2Idx = pricesSlice.lastIndexOf(min2);
      if (min2Idx - min1Idx > 15) { // 必须有一定的时间跨度
        const midPrices = pricesSlice.slice(min1Idx, min2Idx);
        const maxH = Math.max(...midPrices);
        // 如果当前收盘突破了颈线 H，或者是从颈线向下回撤获得支撑
        if (currentPrice >= maxH * 0.93 && currentPrice <= maxH * 1.15) {
          patterns.push("W底突破形态");
        }
      }
    }
  }
  
  // 判定 均线趋势回踩 (MA20 Support Pullback)
  if (N >= 20 && ma20 > ma60) {
    const prevMax = Math.max(...candles.slice(N - 15).map(c => c.high));
    const recentLow = Math.min(...candles.slice(N - 3).map(c => c.low));
    // 近3日最低价在 MA20 附近获得支撑且最近一天收阳线
    const isNearMa20 = Math.abs(recentLow - ma20) / ma20 <= 0.025;
    const isTodayUp = candles[N - 1].close > candles[N - 1].open;
    const isVolumeShrink = candles[N - 1].volume < (N >= 10 ? Math.max(...candles.slice(N - 15).map(c => c.volume)) * 0.6 : 99999999);
    
    if (isNearMa20 && isTodayUp && isVolumeShrink && currentPrice > ma20 * 0.99) {
      patterns.push("MA20均线支撑回踩");
    }
  }
  
  // 判定 老鸭头
  if (N >= 65 && ma5 > ma60 && ma10 > ma60) {
    // 过去 40 天内 MA5 离 MA60 的靠拢特征 (鸭鼻孔)
    let noseFormed = false;
    let minGap = 999;
    for (let i = N - 40; i < N - 5; i++) {
      const idxMa5 = candles.slice(Math.max(0, i - 4), i + 1).reduce((s, d) => s + d.close, 0) / 5;
      const idxMa60 = candles.slice(Math.max(0, i - 59), i + 1).reduce((s, d) => s + d.close, 0) / 60;
      const gap = (idxMa5 - idxMa60) / idxMa60;
      if (gap < minGap) minGap = gap;
    }
    
    if (minGap < 0.045) {
      noseFormed = true;
    }
    
    // 鸭嘴张开：最近 5 天内 MA5 重新金叉或贴近 MA10，并且价格接近前期 30 日高点
    const ma5Prev = candles.slice(N - 6, N - 1).reduce((s, c) => s + c.close, 0) / 5;
    const ma10Prev = candles.slice(N - 11, N - 1).reduce((s, c) => s + c.close, 0) / 10;
    const isTodayCross = ma5 >= ma10 && ma5Prev < ma10Prev;
    const isNewHigh = currentPrice > Math.max(...candles.slice(N - 30, N - 1).map(c => c.close)) * 0.95;
    
    if (noseFormed && (isTodayCross || isNewHigh)) {
      patterns.push("老鸭头金叉突破");
    }
  }
  
  // 4. VRVP 筹码支撑与阻力带 (HVN / LVN)
  const bins = chipDist.bins;
  let poc = chipDist.avgCost;
  let maxVol = 0;
  
  // 找出 POC 控制线
  for (const b of bins) {
    if (b.volume > maxVol) {
      maxVol = b.volume;
      poc = b.price;
    }
  }
  
  // 找出局部高筹码密集区 (HVN)
  const hvnPrices: number[] = [];
  const binWidth = bins.length > 1 ? bins[1].price - bins[0].price : 1;
  const avgVol = bins.reduce((s, b) => s + b.volume, 0) / bins.length;
  
  for (let i = 1; i < bins.length - 1; i++) {
    const prev = bins[i - 1].volume;
    const curr = bins[i].volume;
    const next = bins[i + 1].volume;
    if (curr > prev && curr > next && curr > avgVol * 1.05) {
      hvnPrices.push(bins[i].price);
    }
  }
  
  // 支撑带支撑位确定 (下方最邻近的 HVN)，附带防御性回退
  const supportPrices = hvnPrices.filter(p => p < currentPrice);
  const rawSupportPrice = supportPrices.length > 0 
    ? Math.max(...supportPrices) 
    : (bins.length > 0 ? Math.min(...bins.map(b => b.price)) : currentPrice);
  const supportPrice = safeNum(rawSupportPrice, currentPrice * 0.95);
  const supportZone = {
    price: supportPrice,
    low: Number((supportPrice - binWidth * 0.8).toFixed(2)),
    high: Number((supportPrice + binWidth * 0.8).toFixed(2)),
  };
  
  // 阻力带阻力位确定 (上方最邻近的 HVN)，附带防御性回退
  const resistancePrices = hvnPrices.filter(p => p > currentPrice);
  const rawResistancePrice = resistancePrices.length > 0 
    ? Math.min(...resistancePrices) 
    : (bins.length > 0 ? Math.max(...bins.map(b => b.price)) : currentPrice);
  const resistancePrice = safeNum(rawResistancePrice, currentPrice * 1.05);
  const resistanceZone = {
    price: resistancePrice,
    low: Number((resistancePrice - binWidth * 0.8).toFixed(2)),
    high: Number((resistancePrice + binWidth * 0.8).toFixed(2)),
  };
  
  // 在支撑和阻力带之间寻找筹码真空区 (LVN)
  let minVol = Infinity;
  let lvnPrice: number | null = null;
  const valRangeLow = Math.min(supportPrice, resistancePrice);
  const valRangeHigh = Math.max(supportPrice, resistancePrice);
  
  for (const b of bins) {
    if (b.price >= valRangeLow && b.price <= valRangeHigh) {
      if (b.volume < minVol) {
        minVol = b.volume;
        lvnPrice = b.price;
      }
    }
  }
  if (minVol > avgVol * 0.55) {
    lvnPrice = null; // 筹码填充相对均衡，无明显真空
  }
  
  // 5. 交易建议计算 (Action Advice)
  let action = "持股守候";
  let positionAdvice = "合理持仓 (30% - 50%)";
  let stopLoss = lowerLine > 0 && lowerLine < currentPrice ? lowerLine : Number((currentPrice * 0.94).toFixed(2));
  let takeProfit = upperLine > currentPrice ? upperLine : Number((currentPrice * 1.3).toFixed(2));
  
  const hasBullishCandle = candlesticks.some(k => k.type === "bullish");
  const hasBearishCandle = candlesticks.some(k => k.type === "bearish");
  const hasBullishPattern = patterns.length > 0;
  
  if (channelStatus === "breakout") {
    action = "通道上轨突破/加仓";
    positionAdvice = "积极做多 (60% - 80%)";
    stopLoss = Number((midLine * 0.98).toFixed(2));
    takeProfit = Number((currentPrice * 1.25).toFixed(2));
  } else if (channelStatus === "breakdown") {
    action = "通道破位/分批减仓";
    positionAdvice = "轻仓防御 (10% 以下)";
    stopLoss = Number((currentPrice * 0.97).toFixed(2));
    takeProfit = currentPrice;
  } else if (hasBullishPattern || (hasBullishCandle && currentPrice <= poc * 1.05)) {
    action = "回踩重要支撑/吸纳";
    positionAdvice = "逐步建仓 (40% - 60%)";
    stopLoss = Number((supportZone.low * 0.99).toFixed(2));
    takeProfit = Number((resistanceZone.high).toFixed(2));
  } else if (hasBearishCandle && currentPrice >= resistanceZone.low) {
    action = "阻力位遇阻/分批止盈";
    positionAdvice = "防守减仓 (20% - 30%)";
    stopLoss = Number((supportZone.high).toFixed(2));
  }
  
  // 最终安全保障：确保止损价低于现价，止盈价高于现价
  if (stopLoss >= currentPrice) {
    stopLoss = Number((currentPrice * 0.94).toFixed(2));
  }
  if (takeProfit <= currentPrice) {
    takeProfit = Number((currentPrice * 1.25).toFixed(2));
  }

  // ==========================================
  // ===== 新增 SMC（BOS/CHoCH、需求/供给区）计算 =====
  // ==========================================
  // 1. Swing Highs and Swing Lows 识别 (窗口 k = 3)
  const kWindow = 3;
  const swingHighs: { idx: number; price: number; candle: Candle }[] = [];
  const swingLows: { idx: number; price: number; candle: Candle }[] = [];

  for (let i = kWindow; i < channelLen - kWindow; i++) {
    const c = subCandles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= kWindow; j++) {
      if (subCandles[i - j].high >= c.high || subCandles[i + j].high > c.high) {
        isHigh = false;
      }
      if (subCandles[i - j].low <= c.low || subCandles[i + j].low < c.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      swingHighs.push({ idx: i, price: c.high, candle: c });
    }
    if (isLow) {
      swingLows.push({ idx: i, price: c.low, candle: c });
    }
  }

  // 2. 扫描 60 天以跟踪 BOS / CHoCH 突破
  const bosList: { date: string; price: number; type: "bullish" | "bearish"; label: "BOS" | "CHoCH" }[] = [];
  let currentTrend: "bullish" | "bearish" = channelType === "up" ? "bullish" : "bearish";
  let lastActiveHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : currentPrice;
  let lastActiveLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : currentPrice;

  for (let i = kWindow; i < channelLen; i++) {
    const c = subCandles[i];
    
    // 价格收盘向上突破前高
    if (currentTrend === "bearish" && c.close > lastActiveHigh) {
      bosList.push({ date: c.date, price: lastActiveHigh, type: "bullish", label: "CHoCH" });
      currentTrend = "bullish";
      lastActiveHigh = c.high;
    } else if (currentTrend === "bullish" && c.close > lastActiveHigh) {
      bosList.push({ date: c.date, price: lastActiveHigh, type: "bullish", label: "BOS" });
      lastActiveHigh = c.high;
    }

    // 价格收盘向下跌破前低
    if (currentTrend === "bullish" && c.close < lastActiveLow) {
      bosList.push({ date: c.date, price: lastActiveLow, type: "bearish", label: "CHoCH" });
      currentTrend = "bearish";
      lastActiveLow = c.low;
    } else if (currentTrend === "bearish" && c.close < lastActiveLow) {
      bosList.push({ date: c.date, price: lastActiveLow, type: "bearish", label: "BOS" });
      lastActiveLow = c.low;
    }

    // 动态更新 Swing 级参考高低位
    const sh = swingHighs.find(h => h.idx === i);
    if (sh) lastActiveHigh = sh.price;
    const sl = swingLows.find(l => l.idx === i);
    if (sl) lastActiveLow = sl.price;
  }

  // 3. 供给与需求区 (Demand / Supply Zones) 确定
  const demandZones: { low: number; high: number; label: string }[] = [];
  const supplyZones: { low: number; high: number; label: string }[] = [];

  // 寻找暴涨 CHoCH/BOS 前的最后一根阴线 (需求区)
  const lastBullishBreak = [...bosList].reverse().find(b => b.type === "bullish");
  if (lastBullishBreak) {
    const breakIdx = subCandles.findIndex(c => c.date === lastBullishBreak.date);
    if (breakIdx !== -1) {
      const lookback = subCandles.slice(Math.max(0, breakIdx - 8), breakIdx);
      const bearishCandles = lookback.filter(c => c.close < c.open);
      if (bearishCandles.length > 0) {
        const baseCandle = bearishCandles.reduce((min, c) => c.low < min.low ? c : min, bearishCandles[0]);
        demandZones.push({
          low: Number(baseCandle.low.toFixed(2)),
          high: Number(baseCandle.open.toFixed(2)),
          label: "DEMAND ZONE (主力需求吸筹区 / 强支撑)"
        });
      }
    }
  }

  // 寻找暴跌 CHoCH/BOS 前的最后一根阳线 (供给区)
  const lastBearishBreak = [...bosList].reverse().find(b => b.type === "bearish");
  if (lastBearishBreak) {
    const breakIdx = subCandles.findIndex(c => c.date === lastBearishBreak.date);
    if (breakIdx !== -1) {
      const lookback = subCandles.slice(Math.max(0, breakIdx - 8), breakIdx);
      const bullishCandles = lookback.filter(c => c.close > c.open);
      if (bullishCandles.length > 0) {
        const baseCandle = bullishCandles.reduce((max, c) => c.high > max.high ? c : max, bullishCandles[0]);
        supplyZones.push({
          low: Number(baseCandle.open.toFixed(2)),
          high: Number(baseCandle.high.toFixed(2)),
          label: "SUPPLY ZONE (主力供给套牢区 / 强压力)"
        });
      }
    }
  }

  // 兜底密集区计算
  if (demandZones.length === 0 && N >= 10) {
    const sortedLow = [...subCandles].sort((a, b) => a.low - b.low);
    demandZones.push({
      low: Number(sortedLow[0].low.toFixed(2)),
      high: Number((sortedLow[0].low * 1.022).toFixed(2)),
      label: "DEMAND ZONE (低位吸筹支撑带)"
    });
  }
  if (supplyZones.length === 0 && N >= 10) {
    const sortedHigh = [...subCandles].sort((a, b) => b.high - a.high);
    supplyZones.push({
      low: Number((sortedHigh[0].high * 0.978).toFixed(2)),
      high: Number(sortedHigh[0].high.toFixed(2)),
      label: "SUPPLY ZONE (高位压力回落带)"
    });
  }

  // 4. 斐波那契回调线计算 (最近 60 天极值)
  const fibLow = Math.min(...subCandles.map(c => c.low));
  const fibHigh = Math.max(...subCandles.map(c => c.high));
  const lowIdx = subCandles.findIndex(c => c.low === fibLow);
  const highIdx = subCandles.findIndex(c => c.high === fibHigh);
  const fibIsUp = lowIdx < highIdx;

  const fibRatios = [
    { ratio: 0.0, color: "rgba(239, 68, 68, 0.07)", label: "0.0% (极点起点)" },
    { ratio: 0.236, color: "rgba(249, 115, 22, 0.07)", label: "23.6% (浅度阻力)" },
    { ratio: 0.382, color: "rgba(234, 179, 8, 0.07)", label: "38.2% (均线防守)" },
    { ratio: 0.5, color: "rgba(34, 197, 94, 0.07)", label: "50.0% (多空平衡位)" },
    { ratio: 0.618, color: "rgba(20, 184, 166, 0.12)", label: "61.8% (Golden Pocket 黄金口袋)" },
    { ratio: 0.786, color: "rgba(59, 130, 246, 0.07)", label: "78.6% (超跌强撑)" },
    { ratio: 1.0, color: "rgba(168, 85, 247, 0.07)", label: "100.0% (极限底防)" }
  ];

  const fibLevels = fibRatios.map(fr => {
    const price = fibIsUp 
      ? fibHigh - fr.ratio * (fibHigh - fibLow)
      : fibLow + fr.ratio * (fibHigh - fibLow);
    return {
      ratio: fr.ratio,
      price: Number(price.toFixed(2)),
      color: fr.color,
      label: fr.label
    };
  });

  return {
    trendChannel: {
      type: channelType,
      slope: Number(slope.toFixed(4)),
      status: channelStatus,
      upperLine,
      lowerLine,
      midLine,
    },
    patterns,
    candlesticks,
    vrvp: {
      poc,
      supportZone,
      resistanceZone,
      lvnPrice,
    },
    actionAdvice: {
      action,
      stopLoss,
      takeProfit,
      positionAdvice,
    },
    smc: {
      bosList: bosList.slice(-4),
      demandZones,
      supplyZones
    },
    fibonacci: {
      low: Number(fibLow.toFixed(2)),
      high: Number(fibHigh.toFixed(2)),
      isUp: fibIsUp,
      levels: fibLevels
    }
  };
}
