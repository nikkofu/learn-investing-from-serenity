import type { Candle } from "./types";
import { DEFAULT_COST_MODEL, buyShares, sellProceeds } from "./costs";

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
  /**
   * 分批建仓/分批止盈的仓位比例（v6 起使用，旧策略不填即视为整仓）：
   * - buy：本次建/加仓占「满仓资金」的比例（多次买入累计封顶 1.0）；
   * - sell：本次卖出占「当前持仓股数」的比例（1.0 = 全部清仓）。
   * 不设置（undefined）时按整仓处理，v1–v5 行为完全不变。
   */
  sizePct?: number;
}

/**
 * 分批仓位的简短中文标签（用于图表 BS 标记角标 / 交易信号卡片）。
 * - 整仓（未设置 sizePct）返回 null，沿用旧策略「不显示百分比」的行为；
 * - buy：本次建/加仓占满仓资金的比例，记作「建仓 X%」；
 * - sell：本次卖出占当前持仓的比例，满仓清空记作「清仓」，否则「减仓 X%」。
 */
export function tradeSizeTag(type: "buy" | "sell", sizePct?: number): string | null {
  if (sizePct == null || !Number.isFinite(sizePct)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, sizePct)) * 100);
  if (type === "buy") return `建仓 ${pct}%`;
  return pct >= 100 ? "清仓" : `减仓 ${pct}%`;
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
 * 成交价口径：次日开盘成交（T+1 open）。
 *
 * 各策略的信号判定仍在「第 i 根收盘」确认（保持原有择时逻辑不变），但撮合统一顺延到「第 i+1 根
 * 开盘价」成交——彻底消除「当根收盘才知道信号、却假设当根能按收盘价成交」的未来函数，最贴近 A 股
 * 实盘可执行性。本函数以策略原始产出的 trades 为「信号序列」（仅取 type/sizePct/reason/date），
 * 按次日开盘重新撮合，重算成交价、profitPct、胜率、净值曲线与同期个股基准，统一全站口径。
 *
 * 仓位语义沿用 TradeAction.sizePct 约定：
 * - buy.sizePct 缺省=整仓（投入全部现金）；有值=占满仓资金（初始 10 万）的比例，按现金上限截断；
 * - sell.sizePct 缺省或 ≥1=清仓；否则按「当前持仓股数 × sizePct」减仓（均价不变，清仓才结算盈亏）。
 * 末根才出现的信号无次日开盘可成交，按「不可执行」丢弃。
 */
export function executeTradesNextOpen(candles: Candle[], base: BacktestResult): BacktestResult {
  const signals = base.trades;
  const n = candles.length;
  if (!signals || signals.length === 0 || n < 2) return base;

  const idxByDate = new Map<string, number>();
  for (let i = 0; i < n; i++) idxByDate.set(candles[i].date, i);

  interface Order { type: "buy" | "sell"; sizePct?: number; reason: string }
  const ordersAt = new Map<number, Order[]>();
  let firstExecIdx = Number.POSITIVE_INFINITY;
  for (const t of signals) {
    const sigIdx = idxByDate.get(t.date);
    if (sigIdx == null) continue;
    const execIdx = sigIdx + 1;
    if (execIdx >= n) continue; // 末根信号无次日开盘，不可成交
    if (!ordersAt.has(execIdx)) ordersAt.set(execIdx, []);
    ordersAt.get(execIdx)!.push({ type: t.type, sizePct: t.sizePct, reason: t.reason });
    if (execIdx < firstExecIdx) firstExecIdx = execIdx;
  }
  if (!Number.isFinite(firstExecIdx)) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const trades: TradeAction[] = [];
  const history: BacktestResult["history"] = [];
  let cash = 100000;
  let shares = 0;
  let avgCost = 0;
  let posDeployed = 0;
  let posProceeds = 0;
  let winCount = 0;
  let tradeCount = 0;
  const initialStockWorth = candles[firstExecIdx].close;

  for (let i = firstExecIdx; i < n; i++) {
    const c = candles[i];
    const fill = Number.isFinite(c.open) && c.open > 0 ? c.open : c.close;
    const orders = ordersAt.get(i);
    if (orders) {
      for (const o of orders) {
        if (o.type === "buy") {
          const spend = o.sizePct == null ? cash : Math.min(cash, Math.max(0, o.sizePct) * 100000);
          if (spend > 0) {
            const bought = buyShares(spend, fill, DEFAULT_COST_MODEL);
            if (bought > 0) {
              avgCost = shares + bought > 0 ? (avgCost * shares + fill * bought) / (shares + bought) : fill;
              shares += bought;
              cash -= spend;
              posDeployed += spend;
              trades.push({
                type: "buy",
                date: c.date,
                price: fill,
                reason: o.reason,
                ...(o.sizePct != null ? { sizePct: o.sizePct } : {}),
              });
            }
          }
        } else if (shares > 1e-9) {
          const sold = o.sizePct == null || o.sizePct >= 1 ? shares : shares * o.sizePct;
          if (sold > 1e-12) {
            const proceeds = sellProceeds(sold, fill, DEFAULT_COST_MODEL);
            cash += proceeds;
            shares -= sold;
            posProceeds += proceeds;
            trades.push({
              type: "sell",
              date: c.date,
              price: fill,
              reason: o.reason,
              profitPct: avgCost > 0 ? ((fill - avgCost) / avgCost) * 100 : 0,
              ...(o.sizePct != null ? { sizePct: o.sizePct } : {}),
            });
            if (shares <= 1e-6) {
              tradeCount++;
              if (posProceeds > posDeployed) winCount++;
              shares = 0;
              avgCost = 0;
              posDeployed = 0;
              posProceeds = 0;
            }
          }
        }
      }
    }
    // 分批/部分平仓后仍持有部分仓位时，已落袋现金也要计入净值（否则部分卖出会在权益曲线上造成虚假断崖式回撤）。
    const worth = cash + shares * c.close;
    history.push({
      date: c.date,
      strategyWorth: Number(worth.toFixed(0)),
      stockWorth: Number(((c.close / initialStockWorth) * 100000).toFixed(0)),
    });
  }

  const finalWorth = cash + shares * candles[n - 1].close;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((candles[n - 1].close - initialStockWorth) / initialStockWorth) * 100;
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
 * 目标仓位序列撮合（次日开盘）——多策略并行决策 Ensemble 专用。
 *
 * 输入 targetPos[i] = 「第 i 根收盘时」希望持有的仓位比例（0..1，占当前总权益），
 * 在「第 i+1 根开盘价」按目标再平衡（买卖差额，含双边成本模型）；即第 i 根决策、
 * 第 i+1 根开盘执行，与 executeTradesNextOpen 的无未来函数口径一致。末根目标无次日
 * 开盘不执行。为防抖动，仅当目标与现仓市值偏差 > 1% 权益时才调仓。
 *
 * 净值口径沿用 cash + shares*close（部分仓位不产生虚假断崖回撤）。一段持仓从空仓
 * 建立到重新归零记为一笔，用于胜率统计。
 */
export function executeTargetPositionNextOpen(
  candles: Candle[],
  targetPos: number[],
): BacktestResult {
  const n = candles.length;
  const EMPTY: BacktestResult = { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  if (n < 2 || targetPos.length !== n) return EMPTY;

  let firstSig = -1;
  for (let i = 0; i < n - 1; i++) {
    if ((targetPos[i] || 0) > 1e-6) { firstSig = i; break; }
  }
  if (firstSig < 0) return EMPTY;
  const startIdx = firstSig + 1;

  const trades: TradeAction[] = [];
  const history: BacktestResult["history"] = [];
  let cash = 100000;
  let shares = 0;
  let avgCost = 0;
  let posDeployed = 0;
  let posProceeds = 0;
  let winCount = 0;
  let tradeCount = 0;
  const initialStockWorth = candles[startIdx].close;
  const EPS = 1e-6;

  for (let i = startIdx; i < n; i++) {
    const c = candles[i];
    const fill = Number.isFinite(c.open) && c.open > 0 ? c.open : c.close;
    const tgt = Math.max(0, Math.min(1, targetPos[i - 1] || 0));
    const equity = cash + shares * fill;
    const curShareVal = shares * fill;
    const diff = tgt * equity - curShareVal;

    if (diff > equity * 0.01 && cash > 1) {
      const spend = Math.min(cash, diff);
      const bought = buyShares(spend, fill, DEFAULT_COST_MODEL);
      if (bought > EPS) {
        avgCost = shares + bought > 0 ? (avgCost * shares + fill * bought) / (shares + bought) : fill;
        shares += bought;
        cash -= spend;
        posDeployed += spend;
        trades.push({ type: "buy", date: c.date, price: fill, reason: `Ensemble 调仓至 ${(tgt * 100).toFixed(0)}%`, sizePct: equity > 0 ? spend / equity : undefined });
      }
    } else if (diff < -equity * 0.01 && shares > EPS) {
      const sellFrac = curShareVal > 0 ? Math.min(1, -diff / curShareVal) : 0;
      const sold = shares * sellFrac;
      if (sold > EPS) {
        const proceeds = sellProceeds(sold, fill, DEFAULT_COST_MODEL);
        cash += proceeds;
        shares -= sold;
        posProceeds += proceeds;
        trades.push({ type: "sell", date: c.date, price: fill, reason: `Ensemble 调仓至 ${(tgt * 100).toFixed(0)}%`, profitPct: avgCost > 0 ? ((fill - avgCost) / avgCost) * 100 : 0, sizePct: sellFrac });
        if (shares <= EPS) {
          tradeCount++;
          if (posProceeds > posDeployed) winCount++;
          shares = 0;
          avgCost = 0;
          posDeployed = 0;
          posProceeds = 0;
        }
      }
    }

    const worth = cash + shares * c.close;
    history.push({
      date: c.date,
      strategyWorth: Number(worth.toFixed(0)),
      stockWorth: Number(((c.close / initialStockWorth) * 100000).toFixed(0)),
    });
  }

  const finalWorth = cash + shares * candles[n - 1].close;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((candles[n - 1].close - initialStockWorth) / initialStockWorth) * 100;
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
 * 传统均线突破策略可调参数。默认值完全还原原「20日线突破」行为。
 */
export interface MaStrategyParams {
  maPeriod: number;           // 收盘均线 / 换手长均线周期（默认 20）
  takeProfitPct: number;      // 止盈涨幅 %（默认 35）
  volMultiple: number;        // 放量倍数：5日均换手 / 长均换手（默认 1.3）
  safeRangePos: number;       // 安全价格位上限 0~1（默认 0.65）
  overboughtPos: number;      // 超买价格位 0~1（默认 0.85）
  overboughtTurnover: number; // 超买天量换手 %（默认 15）
}

export const DEFAULT_MA_PARAMS: MaStrategyParams = {
  maPeriod: 20,
  takeProfitPct: 35,
  volMultiple: 1.3,
  safeRangePos: 0.65,
  overboughtPos: 0.85,
  overboughtTurnover: 15,
};

/** 将外部传入参数夹紧到安全范围，防止非法值导致回测异常。 */
export function sanitizeMaParams(p: Partial<MaStrategyParams> | undefined): MaStrategyParams {
  const d = DEFAULT_MA_PARAMS;
  const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  return {
    maPeriod: Math.max(2, Math.min(250, Math.round(num(p?.maPeriod, d.maPeriod)))),
    takeProfitPct: Math.max(1, Math.min(500, num(p?.takeProfitPct, d.takeProfitPct))),
    volMultiple: Math.max(0.5, Math.min(10, num(p?.volMultiple, d.volMultiple))),
    safeRangePos: Math.max(0.1, Math.min(1, num(p?.safeRangePos, d.safeRangePos))),
    overboughtPos: Math.max(0.1, Math.min(1, num(p?.overboughtPos, d.overboughtPos))),
    overboughtTurnover: Math.max(1, Math.min(100, num(p?.overboughtTurnover, d.overboughtTurnover))),
  };
}

/**
 * 运行传统均线突破策略回测（参数可调，默认还原 20 日线口径）。
 * 买入：收盘上穿 MA(maPeriod)，或平台整理后放量突破前高；且价格位 < safeRangePos；且 5 日均换手 > 长均换手 × volMultiple。
 * 卖出：收盘跌破 MA(maPeriod)；或较买入价涨幅达 takeProfitPct%；或价格位 > overboughtPos 且天量换手 > overboughtTurnover%。
 */
export function runTraditionalMaBacktest(
  candles: Candle[],
  params: MaStrategyParams = DEFAULT_MA_PARAMS
): BacktestResult {
  const { maPeriod, takeProfitPct, volMultiple, safeRangePos, overboughtPos, overboughtTurnover } = params;
  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < maPeriod + 5) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  // 1. 预先计算收盘均线 MA(maPeriod) 与换手率均线（短 5 日 / 长 maPeriod 日）
  const prices = candles.map((c) => c.close);
  const maList: number[] = [];
  const volMa5: number[] = [];
  const volMaLong: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    // 收盘均线
    if (i < maPeriod - 1) {
      maList.push(prices[i]);
    } else {
      const sum = prices.slice(i - (maPeriod - 1), i + 1).reduce((s, p) => s + p, 0);
      maList.push(sum / maPeriod);
    }

    // 换手均线
    const turnovers = candles.slice(0, i + 1).map(c => c.turnoverPct || 1);
    if (i < 4) {
      volMa5.push(turnovers[i]);
    } else {
      const sum = turnovers.slice(i - 4, i + 1).reduce((s, t) => s + t, 0);
      volMa5.push(sum / 5);
    }
    if (i < maPeriod - 1) {
      volMaLong.push(turnovers[i]);
    } else {
      const sum = turnovers.slice(i - (maPeriod - 1), i + 1).reduce((s, t) => s + t, 0);
      volMaLong.push(sum / maPeriod);
    }
  }

  // 2. 模拟交易状态机
  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let winCount = 0;
  let tradeCount = 0;

  const initialStockWorth = prices[maPeriod]; // 以第 maPeriod 天收盘价作为对照组基准

  for (let i = maPeriod; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;
    const ma = maList[i];
    const t5 = volMa5[i];
    const tLong = volMaLong[i];

    // 计算局部的 rangePosition
    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    // 检查买卖信号
    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation = recentWindow.length >= 5 && (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    if (!holding) {
      const isBreakout = close > ma && prices[i - 1] <= maList[i - 1];
      const isPlateauBreakout = close > ma && isPlateauConsolidation && close > Math.max(...recentWindow);
      const isVolumeIncrease = t5 > tLong * volMultiple;
      const isSafePosition = rangePos < safeRangePos; // 安全价格位限制，防止右侧大阳踏空

      if ((isBreakout || isPlateauBreakout) && isSafePosition && isVolumeIncrease) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        buyPrice = close;
        trades.push({
          type: "buy",
          date,
          price: close,
          reason: isPlateauBreakout
            ? `【平台整理突破】股价在 ${maPeriod}日线之上平台盘整后放量突破前高，5日均换手放大至 ${(t5 / tLong).toFixed(1)} 倍。`
            : `【均线突破】股价上穿 ${maPeriod} 日均线，5日均换手放大至 ${(t5 / tLong).toFixed(1)} 倍。`,
        });
      }
    } else {
      // 卖出条件：
      // 1. 均线破位：收盘价下穿 MA(maPeriod)
      // 2. 止盈：涨幅达 takeProfitPct% 以上
      // 3. 超买滞涨：价格位 > overboughtPos 且换手创天量
      const isBreakdown = close < ma;
      const isTakeProfit = close >= buyPrice * (1 + takeProfitPct / 100);
      const isOverbought = rangePos > overboughtPos && !!c.turnoverPct && c.turnoverPct > overboughtTurnover; // 天量滞涨

      if (isBreakdown || isTakeProfit || isOverbought) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = `跌破${maPeriod}日线止损`;
        if (isTakeProfit) reason = `达到 ${takeProfitPct}% 止盈目标 (买入价: ${buyPrice.toFixed(2)})`;
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
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
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
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
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

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测 v2（修复版）。
 * 相对 v1（runChokepointMomentumBacktest）的三处针对性改进：
 *   ① 趋势内可再入场：在上升趋势中（MA20 走平向上），价格回踩 MA20 附近后重新放量走强即可再次买入，
 *      不再只认「昨日≤MA20、今日>MA20」的一次性新鲜上穿——解决单边主升浪里止损出局后整段踏空的问题。
 *   ② 放开强势起爆的高位区位上限：创新高突破本就是动量的定义，故信号 3 去掉 rangePos≤0.85 上限，
 *      仅保留下限 0.60，让右侧创新高的放量长阳也能触发买点（v1 在此处把主升浪挡在门外）。
 *   ④ 跟踪止损替代固定 35% 止盈：浮盈启动后用「自持仓峰值回撤百分比」离场，让利润奔跑、不在 +35% 处截断主升浪。
 * 其余口径（跌破 70% 筹码支撑止损、量能换手率/成交量代理、整手等）与 v1 保持一致。
 */
export function runChokepointMomentumBacktestV2(
  candles: Candle[],
  chokepointScore: number,
  _opts: { code?: string } = {},
): BacktestResult {
  const TRAIL_PCT = 0.12; // 跟踪止损：自持仓期间峰值收盘价回撤超过 12% 离场
  const TRAIL_ACTIVATE = 1.08; // 浮盈 ≥ 8% 后才启用跟踪止损，避免建仓初期正常震荡被洗出

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const ma20List: number[] = [];
  const volMa5: number[] = [];
  const volMa20: number[] = [];

  // 量能代理：换手率优先，无换手率（如腾讯/新浪日K）降级用成交量（比值口径数学等价）。
  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );

  for (let i = 0; i < candles.length; i++) {
    if (i < 19) ma20List.push(prices[i]);
    else ma20List.push(prices.slice(i - 19, i + 1).reduce((s, p) => s + p, 0) / 20);

    if (i < 4) volMa5.push(volProxy[i]);
    else volMa5.push(volProxy.slice(i - 4, i + 1).reduce((s, t) => s + t, 0) / 5);

    if (i < 19) volMa20.push(volProxy[i]);
    else volMa20.push(volProxy.slice(i - 19, i + 1).reduce((s, t) => s + t, 0) / 20);
  }

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let buyDate = "";
  let peakClose = 0; // 持仓期间的峰值收盘价（用于跟踪止损）
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

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCost = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    if (!holding) {
      // 信号 1：新鲜上穿 20 日线且放量（均线筹码金叉）
      const isBreakoutGoldCross = close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      // 信号 2：平台整理后的二次放量突破（VCP）
      const isVcpBreakout =
        close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      // 信号 3（②修复）：强成长股放量创新高起爆——去掉 rangePos≤0.85 上限，仅保留下限 0.60
      const isStrongHighBreakout =
        chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      // 信号 4（①修复）：上升趋势中回踩 MA20 后重新走强 → 趋势内再入场（不需新鲜上穿）
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      if (isBreakoutGoldCross || isVcpBreakout || isStrongHighBreakout || isTrendResume) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        buyPrice = close;
        buyDate = date;
        peakClose = close;

        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        let reason = "";
        if (isStrongHighBreakout) {
          reason = `${cautionTag}【Serenity 强成长突破·v2】基本面得分 ${chokepointScore} 分，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启（已放开高位区位上限，创新高亦可入场）。`;
        } else if (isVcpBreakout) {
          reason = `${cautionTag}【VCP箱体整理突破】股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else if (isTrendResume) {
          reason = `${cautionTag}【趋势回踩再起·v2】上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场，避免单边主升浪踏空。`;
        } else {
          reason = `${cautionTag}【均线筹码共振突破】股价突破 20 日均线，且价格处于主力平均成本线（${avgCost.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }

        trades.push({ type: "buy", date, price: close, reason });
      }
    } else {
      peakClose = Math.max(peakClose, close);
      // 卖出条件：
      // 1. 跌破主力筹码成本防线（下方密集筹码下轨 5%）
      const isSupportBroken = close < supportPrice * 0.95;
      // 2（④修复）. 跟踪止损：浮盈启动后自峰值回撤超阈值离场（替代固定 35% 止盈，让利润奔跑）
      const trailingActive = peakClose >= buyPrice * TRAIL_ACTIVATE;
      const isTrailingStop = trailingActive && close <= peakClose * (1 - TRAIL_PCT);
      // 3. 超买天量滞涨
      const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

      if (isSupportBroken || isTrailingStop || isClimaxRun) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = "";
        if (isSupportBroken) {
          reason = `【主力防线失守止损】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，中期洗盘出局，策略执行逻辑证伪。`;
        } else if (isTrailingStop) {
          reason = `【跟踪止盈】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(TRAIL_PCT * 100).toFixed(0)}%（现价 ${close.toFixed(2)}），锁定波段利润离场（买入价 ${buyPrice.toFixed(2)} 元，让利润奔跑而非固定 35% 截断）。`;
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
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
      stockWorth: Number(stockWorth.toFixed(0)),
    });
  }

  void buyDate;
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
 * 运行 Serenity 瓶颈动量突破量化策略回测 v3（底部反转增强版）。
 *
 * 背景：v2 只在「右侧」入场（新鲜上穿放量、VCP 平台突破、高区位创新高、上升趋势回踩再起），
 * 且量能确认一律用「平滑后的 5 日/20 日量比 t5>1.3·t20」。这导致在「相对低位 + 单日倍量大阳
 * 反包上穿」这类经典底部启动（如 600703 在 2026-04-17：相对区位 26%、单日量能 2.93 倍、+9.98%
 * 长阳收复 MA20）完全无法识别——因为单日爆量不足以把 5 日均量比抬过 1.3。
 *
 * v3 在保留 v2 全部信号与卖出口径（跌破筹码支撑止损 / 跟踪止损 / 高位天量滞涨）的基础上，
 * 新增三类「左侧/底部反转」入场信号，全部仅用「截至当日」的数据，无未来函数：
 *   信号 5【放量反包·底部启动】：相对低位（120 日区位 ≤ 0.45）+ 单日量能既 ≥ 昨日 1.8 倍、
 *      又 ≥ 近 5 日均量 1.5 倍（捕捉平滑量比抓不到的单日爆量）+ 大阳收复（日涨幅 ≥ 5%、收在
 *      当日振幅上半部、且收复 MA20 或反包前 5 日实体），并要求出现看涨 K 线形态（大阳/阳包阴
 *      吞没/低位带量锤子线）。这是直接修复 04-17 漏买的主信号。
 *   信号 6【W 底/双底突破颈线】：近 45 日内识别两个相近的低点（高度差 ≤ 6%、间隔 ≥ 5 日），
 *      以两低点之间的高点为颈线，今日带量（量能 > 20 日均量）放量收阳突破颈线即买入。
 *   信号 7【老鸭头·二次金叉】：MA60 向上且价在其上（趋势在），近 25 日内出现过 MA5 上穿 MA10
 *      （鸭头顶）后 MA5 回落贴近 MA10（鸭嘴缩量回踩），今日 MA5 重新上穿 MA10 且放量 → 顺势买。
 *
 * 其余口径（70% 筹码支撑、量能换手率/成交量代理、整手、跟踪止损参数等）与 v2 完全一致，便于对照。
 */
export function runChokepointMomentumBacktestV3(
  candles: Candle[],
  chokepointScore: number,
  _opts: { code?: string } = {},
): BacktestResult {
  const TRAIL_PCT = 0.12;
  const TRAIL_ACTIVATE = 1.08;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const ma5List = prices.map((_, i) => ma(prices, i, 5));
  const ma10List = prices.map((_, i) => ma(prices, i, 10));
  const ma20List = prices.map((_, i) => ma(prices, i, 20));
  const ma60List = prices.map((_, i) => ma(prices, i, 60));

  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
  const volMa5 = volProxy.map((_, i) => ma(volProxy, i, 5));
  const volMa20 = volProxy.map((_, i) => ma(volProxy, i, 20));

  // —— 看涨 K 线形态（仅用当日及之前的 K，无未来函数）——
  const bodyOf = (k: Candle) => Math.abs(k.close - k.open);
  const isBullEngulf = (i: number): boolean => {
    if (i < 1) return false;
    const a = candles[i - 1], b = candles[i];
    const aYin = a.close < a.open;
    const bYang = b.close > b.open;
    return aYin && bYang && b.close >= a.open && b.open <= a.close && bodyOf(b) > bodyOf(a) * 0.8;
  };
  const isHammer = (i: number): boolean => {
    const k = candles[i];
    const range = k.high - k.low;
    if (range <= 0) return false;
    const body = bodyOf(k);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    return lowerShadow >= body * 2 && upperShadow <= body && k.close >= k.open;
  };

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let peakClose = 0;
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

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCost = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    const dayRet = prices[i - 1] > 0 ? ((close - prices[i - 1]) / prices[i - 1]) * 100 : 0;

    if (!holding) {
      // —— v2 原有四信号 ——
      const isBreakoutGoldCross = close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      const isVcpBreakout =
        close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      const isStrongHighBreakout =
        chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      // —— v3 新增三信号 ——
      // 信号 5：放量反包·底部启动（单日爆量 + 相对低位 + 大阳收复 + 看涨形态）
      const volSpike = volProxy[i] >= volProxy[i - 1] * 1.8 && volProxy[i] >= volMa5[i] * 1.5;
      const lowZone = rangePos <= 0.45;
      const bigYang = close > c.open && dayRet >= 5;
      const closeUpperHalf = c.high > c.low ? close - c.low >= 0.5 * (c.high - c.low) : true;
      const priorBody5 = Math.max(...prices.slice(Math.max(0, i - 5), i));
      const reclaim = close > ma20 || close > priorBody5;
      const bullPattern = bigYang || isBullEngulf(i) || (isHammer(i) && close > c.open);
      const isVolThrustBottom = lowZone && volSpike && closeUpperHalf && reclaim && bullPattern;

      // 信号 6：W 底/双底突破颈线（仅回看，无未来函数）
      let isDoubleBottomBreak = false;
      if (i >= 46 && rangePos <= 0.6 && close > c.open && volProxy[i] > volMa20[i]) {
        const lookback = candles.slice(i - 45, i); // [i-45, i-1]
        const lows = lookback.map((x) => x.low);
        // 近端低点（后 20 根内）
        const recentSeg = lookback.slice(-20);
        const recentLow = Math.min(...recentSeg.map((x) => x.low));
        const recentLowAbs = lows.length - 20 + recentSeg.map((x) => x.low).indexOf(recentLow);
        // 前端低点（近端低点至少 5 根之前）
        if (recentLowAbs >= 6) {
          const priorSeg = lookback.slice(0, recentLowAbs - 4);
          const priorLow = Math.min(...priorSeg.map((x) => x.low));
          const priorLowAbs = priorSeg.map((x) => x.low).indexOf(priorLow);
          const similar = priorLow > 0 && Math.abs(recentLow - priorLow) / priorLow <= 0.06;
          // 颈线 = 两低点之间的最高收盘
          const between = lookback.slice(priorLowAbs + 1, recentLowAbs);
          const neckline = between.length > 0 ? Math.max(...between.map((x) => x.close)) : Infinity;
          if (similar && close > neckline && Number.isFinite(neckline)) isDoubleBottomBreak = true;
        }
      }

      // 信号 7：老鸭头·二次金叉（趋势在 + 回踩缩量后再金叉放量）
      let isOldDuckHead = false;
      if (i >= 60) {
        const ma5 = ma5List[i], ma10 = ma10List[i], ma60 = ma60List[i];
        const upTrend = ma60 > ma60List[i - 5] && close > ma60;
        const crossUpToday = ma5 > ma10 && ma5List[i - 1] <= ma10List[i - 1];
        // 近 25 日内出现过「金叉后 MA5 回落贴近/跌破 MA10」的鸭嘴形态
        let hadBillPullback = false;
        for (let j = i - 25; j < i; j++) {
          if (j < 1) continue;
          const crossedBefore = ma5List[j] > ma10List[j] && ma5List[j - 1] <= ma10List[j - 1];
          if (crossedBefore) {
            for (let k = j + 1; k < i; k++) {
              if (ma5List[k] <= ma10List[k] * 1.01) { hadBillPullback = true; break; }
            }
          }
          if (hadBillPullback) break;
        }
        const volOk = volProxy[i] > volMa5[i] * 1.1;
        if (upTrend && crossUpToday && hadBillPullback && volOk) isOldDuckHead = true;
      }

      if (
        isBreakoutGoldCross ||
        isVcpBreakout ||
        isStrongHighBreakout ||
        isTrendResume ||
        isVolThrustBottom ||
        isDoubleBottomBreak ||
        isOldDuckHead
      ) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        buyPrice = close;
        peakClose = close;

        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        let reason = "";
        if (isVolThrustBottom) {
          reason = `${cautionTag}【放量反包·底部启动·v3】相对低位（区位 ${(rangePos * 100).toFixed(0)}%）今日单日爆量（量能 ${(volProxy[i] / volProxy[i - 1]).toFixed(1)} 倍于昨日）放量长阳（日涨 ${dayRet.toFixed(1)}%）收复 MA20/反包前高，呈底部反转启动。`;
        } else if (isDoubleBottomBreak) {
          reason = `${cautionTag}【W底/双底突破·v3】近 45 日构筑双底（两低点高度相近），今日带量收阳向上突破颈线，底部形态确认。`;
        } else if (isOldDuckHead) {
          reason = `${cautionTag}【老鸭头·二次金叉·v3】MA60 趋势向上，MA5 回踩贴近 MA10（鸭嘴缩量）后今日重新放量金叉，主升浪二次启动。`;
        } else if (isStrongHighBreakout) {
          reason = `${cautionTag}【Serenity 强成长突破·v3】基本面得分 ${chokepointScore} 分，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启。`;
        } else if (isVcpBreakout) {
          reason = `${cautionTag}【VCP箱体整理突破】股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else if (isTrendResume) {
          reason = `${cautionTag}【趋势回踩再起·v3】上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场。`;
        } else {
          reason = `${cautionTag}【均线筹码共振突破】股价突破 20 日均线，且价格处于主力平均成本线（${avgCost.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }

        trades.push({ type: "buy", date, price: close, reason });
      }
    } else {
      peakClose = Math.max(peakClose, close);
      const isSupportBroken = close < supportPrice * 0.95;
      const trailingActive = peakClose >= buyPrice * TRAIL_ACTIVATE;
      const isTrailingStop = trailingActive && close <= peakClose * (1 - TRAIL_PCT);
      const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

      if (isSupportBroken || isTrailingStop || isClimaxRun) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = "";
        if (isSupportBroken) {
          reason = `【主力防线失守止损】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，中期洗盘出局。`;
        } else if (isTrailingStop) {
          reason = `【跟踪止盈】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(TRAIL_PCT * 100).toFixed(0)}%（现价 ${close.toFixed(2)}），锁定波段利润离场。`;
        } else if (isClimaxRun) {
          reason = `【高位超买天量滞涨】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct!.toFixed(1)}% 创天量，高位筹码剧烈松动。`;
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
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
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

/** v4 可调参数（跟踪止损调优 + MA60 趋势过滤开关）。 */
export interface ChokepointV4Options {
  code?: string;
  /** 浮盈达到该倍数后才启用跟踪止损（默认 1.06，比 v3 的 1.08 更早保护）。 */
  trailActivate?: number;
  /** 建仓初期（未达大涨阈值）的宽松跟踪止损回撤比例（默认 0.15，比 v3 的 0.12 给更多波动空间，少被洗）。 */
  trailPctBase?: number;
  /** 浮盈超过大涨阈值后收紧的跟踪止损回撤比例（默认 0.09，锁定利润）。 */
  trailPctTight?: number;
  /** 峰值浮盈达到该倍数后，跟踪止损从宽松切到收紧（默认 1.20，即 +20%）。 */
  tightenGain?: number;
  /** 是否启用 MA60 趋势过滤（默认 true）。关闭后行为退回 v3 的右侧入场口径。 */
  ma60Filter?: boolean;
}

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测 v4（趋势过滤 + 跟踪止损调优版）。
 *
 * v4 在 v3「v2 全部信号 + 三类底部反转信号」之上，针对「震荡区右侧诱多」与「跟踪止损过紧/过松」
 * 两个痛点做两处增强，其余口径（筹码支撑止损、天量滞涨离场、整手、无未来函数）与 v3 完全一致：
 *
 *   1) MA60 趋势过滤（仅作用于右侧动量入场，不动底部反转）：
 *      - 右侧四类信号（均线金叉 / VCP 平台突破 / 强势起爆创新高 / 趋势回踩再起）新增「中期趋势闸门」
 *        —— 仅在「价在 MA60 之上 或 MA60 近 10 日不下行」时才允许买入，过滤在 MA60 仍向下的震荡/下行
 *        区里追突破被诱多。
 *      - 左侧/底部三类信号（放量反包底部启动 / W底突破 / 老鸭头二次金叉）**不加 MA60 闸门**：它们本就
 *        发生在 MA60 下方的底部，老鸭头自带 MA60 向上要求。这样 04-17 这类底部启动买点与 v3 完全一致、
 *        不被误杀。
 *
 *   2) 跟踪止损调优（让利润奔跑，又不让大利润回吐）：
 *      - 启动阈值由 +8% 提前到 +6%（trailActivate）；
 *      - 采用分段回撤：浮盈未到 +20% 时用宽松 15% 回撤（少被建仓初期正常震荡洗出），峰值浮盈 ≥ +20%
 *        后收紧到 9% 回撤（锁定大段利润）。
 *
 * 上述参数全部可通过 opts 调，便于做参数寻优；默认值即调优后口径。
 */
export function runChokepointMomentumBacktestV4(
  candles: Candle[],
  chokepointScore: number,
  opts: ChokepointV4Options = {},
): BacktestResult {
  const TRAIL_ACTIVATE = opts.trailActivate ?? 1.06;
  const TRAIL_PCT_BASE = opts.trailPctBase ?? 0.15;
  const TRAIL_PCT_TIGHT = opts.trailPctTight ?? 0.09;
  const TIGHTEN_GAIN = opts.tightenGain ?? 1.2;
  const MA60_FILTER = opts.ma60Filter ?? true;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const ma5List = prices.map((_, i) => ma(prices, i, 5));
  const ma10List = prices.map((_, i) => ma(prices, i, 10));
  const ma20List = prices.map((_, i) => ma(prices, i, 20));
  const ma60List = prices.map((_, i) => ma(prices, i, 60));

  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
  const volMa5 = volProxy.map((_, i) => ma(volProxy, i, 5));
  const volMa20 = volProxy.map((_, i) => ma(volProxy, i, 20));

  const bodyOf = (k: Candle) => Math.abs(k.close - k.open);
  const isBullEngulf = (i: number): boolean => {
    if (i < 1) return false;
    const a = candles[i - 1], b = candles[i];
    const aYin = a.close < a.open;
    const bYang = b.close > b.open;
    return aYin && bYang && b.close >= a.open && b.open <= a.close && bodyOf(b) > bodyOf(a) * 0.8;
  };
  const isHammer = (i: number): boolean => {
    const k = candles[i];
    const range = k.high - k.low;
    if (range <= 0) return false;
    const body = bodyOf(k);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    return lowerShadow >= body * 2 && upperShadow <= body && k.close >= k.open;
  };

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let peakClose = 0;
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

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCost = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    const dayRet = prices[i - 1] > 0 ? ((close - prices[i - 1]) / prices[i - 1]) * 100 : 0;

    if (!holding) {
      // —— ① MA60 中期趋势闸门（仅作用于右侧动量入场）——
      const ma60 = ma60List[i];
      const ma60Ref = ma60List[Math.max(0, i - 10)];
      const ma60NotFalling = ma60 >= ma60Ref;
      const aboveMa60 = close > ma60;
      const regimeOkRight = !MA60_FILTER || aboveMa60 || ma60NotFalling;

      // —— v2 原有四信号（v4 叠加趋势闸门）——
      const isBreakoutGoldCross =
        regimeOkRight && close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      const isVcpBreakout =
        regimeOkRight && close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      const isStrongHighBreakout =
        regimeOkRight && chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        regimeOkRight && close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      // —— v3 三类底部反转信号（v4 保持原样，不加 MA60 闸门）——
      const volSpike = volProxy[i] >= volProxy[i - 1] * 1.8 && volProxy[i] >= volMa5[i] * 1.5;
      const lowZone = rangePos <= 0.45;
      const bigYang = close > c.open && dayRet >= 5;
      const closeUpperHalf = c.high > c.low ? close - c.low >= 0.5 * (c.high - c.low) : true;
      const priorBody5 = Math.max(...prices.slice(Math.max(0, i - 5), i));
      const reclaim = close > ma20 || close > priorBody5;
      const bullPattern = bigYang || isBullEngulf(i) || (isHammer(i) && close > c.open);
      const isVolThrustBottom = lowZone && volSpike && closeUpperHalf && reclaim && bullPattern;

      let isDoubleBottomBreak = false;
      if (i >= 46 && rangePos <= 0.6 && close > c.open && volProxy[i] > volMa20[i]) {
        const lookback = candles.slice(i - 45, i);
        const lows = lookback.map((x) => x.low);
        const recentSeg = lookback.slice(-20);
        const recentLow = Math.min(...recentSeg.map((x) => x.low));
        const recentLowAbs = lows.length - 20 + recentSeg.map((x) => x.low).indexOf(recentLow);
        if (recentLowAbs >= 6) {
          const priorSeg = lookback.slice(0, recentLowAbs - 4);
          const priorLow = Math.min(...priorSeg.map((x) => x.low));
          const priorLowAbs = priorSeg.map((x) => x.low).indexOf(priorLow);
          const similar = priorLow > 0 && Math.abs(recentLow - priorLow) / priorLow <= 0.06;
          const between = lookback.slice(priorLowAbs + 1, recentLowAbs);
          const neckline = between.length > 0 ? Math.max(...between.map((x) => x.close)) : Infinity;
          if (similar && close > neckline && Number.isFinite(neckline)) isDoubleBottomBreak = true;
        }
      }

      let isOldDuckHead = false;
      if (i >= 60) {
        const ma5 = ma5List[i], ma10 = ma10List[i], ma60v = ma60List[i];
        const upTrend = ma60v > ma60List[i - 5] && close > ma60v;
        const crossUpToday = ma5 > ma10 && ma5List[i - 1] <= ma10List[i - 1];
        let hadBillPullback = false;
        for (let j = i - 25; j < i; j++) {
          if (j < 1) continue;
          const crossedBefore = ma5List[j] > ma10List[j] && ma5List[j - 1] <= ma10List[j - 1];
          if (crossedBefore) {
            for (let k = j + 1; k < i; k++) {
              if (ma5List[k] <= ma10List[k] * 1.01) { hadBillPullback = true; break; }
            }
          }
          if (hadBillPullback) break;
        }
        const volOk = volProxy[i] > volMa5[i] * 1.1;
        if (upTrend && crossUpToday && hadBillPullback && volOk) isOldDuckHead = true;
      }

      if (
        isBreakoutGoldCross ||
        isVcpBreakout ||
        isStrongHighBreakout ||
        isTrendResume ||
        isVolThrustBottom ||
        isDoubleBottomBreak ||
        isOldDuckHead
      ) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        buyPrice = close;
        peakClose = close;

        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        let reason = "";
        if (isVolThrustBottom) {
          reason = `${cautionTag}【放量反包·底部启动·v4】相对低位（区位 ${(rangePos * 100).toFixed(0)}%）今日单日爆量（量能 ${(volProxy[i] / volProxy[i - 1]).toFixed(1)} 倍于昨日）放量长阳（日涨 ${dayRet.toFixed(1)}%）收复 MA20/反包前高，呈底部反转启动。`;
        } else if (isDoubleBottomBreak) {
          reason = `${cautionTag}【W底/双底突破·v4】近 45 日构筑双底（两低点高度相近），今日带量收阳向上突破颈线，底部形态确认。`;
        } else if (isOldDuckHead) {
          reason = `${cautionTag}【老鸭头·二次金叉·v4】MA60 趋势向上，MA5 回踩贴近 MA10（鸭嘴缩量）后今日重新放量金叉，主升浪二次启动。`;
        } else if (isStrongHighBreakout) {
          reason = `${cautionTag}【Serenity 强成长突破·v4】基本面得分 ${chokepointScore} 分，MA60 趋势在位，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启。`;
        } else if (isVcpBreakout) {
          reason = `${cautionTag}【VCP箱体整理突破·v4】MA60 趋势在位，股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else if (isTrendResume) {
          reason = `${cautionTag}【趋势回踩再起·v4】MA60 趋势在位，上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场。`;
        } else {
          reason = `${cautionTag}【均线筹码共振突破·v4】MA60 趋势在位，股价突破 20 日均线，且价格处于主力平均成本线（${avgCost.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }

        trades.push({ type: "buy", date, price: close, reason });
      }
    } else {
      peakClose = Math.max(peakClose, close);
      const isSupportBroken = close < supportPrice * 0.95;
      // ② 分段跟踪止损：浮盈达大涨阈值后收紧回撤比例
      const trailPct = peakClose >= buyPrice * TIGHTEN_GAIN ? TRAIL_PCT_TIGHT : TRAIL_PCT_BASE;
      const trailingActive = peakClose >= buyPrice * TRAIL_ACTIVATE;
      const isTrailingStop = trailingActive && close <= peakClose * (1 - trailPct);
      const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

      if (isSupportBroken || isTrailingStop || isClimaxRun) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = "";
        if (isSupportBroken) {
          reason = `【主力防线失守止损】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，中期洗盘出局。`;
        } else if (isTrailingStop) {
          reason = `【分段跟踪止盈·v4】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(trailPct * 100).toFixed(0)}%（现价 ${close.toFixed(2)}），锁定波段利润离场。`;
        } else if (isClimaxRun) {
          reason = `【高位超买天量滞涨】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct!.toFixed(1)}% 创天量，高位筹码剧烈松动。`;
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
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
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

/**
 * Wilder ATR(period) 序列：真实波幅经 Wilder 平滑（首值取前 period 根 TR 的简单均值，
 * 此后 ATR_i = (ATR_{i-1}·(period-1) + TR_i) / period）。返回与 candles 等长的数组，
 * 预热不足处回退到当前 TR，保证无 NaN。仅用 ≤ i 数据，无未来函数。
 */
export function atrWilder(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0) return out;
  const tr = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const hl = c.high - c.low;
    if (i === 0) {
      tr[i] = hl > 0 ? hl : Math.abs(c.close) * 0.01;
    } else {
      const pc = candles[i - 1].close;
      tr[i] = Math.max(hl, Math.abs(c.high - pc), Math.abs(c.low - pc));
    }
  }
  let prev = 0;
  for (let i = 0; i < n; i++) {
    if (i < period) {
      // 预热：用累计均值，足够稳健且无未来函数
      const slice = tr.slice(0, i + 1);
      prev = slice.reduce((s, x) => s + x, 0) / slice.length;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    out[i] = safeNum(prev, tr[i]);
  }
  return out;
}

/**
 * Wilder ADX（平均趋向指数）。返回与 candles 等长的 ADX 数组（0–100）。
 *
 * ADX 是教科书级的「趋势 vs 震荡」判别器：ADX 低（如 <25）= 无明显趋势/箱体震荡，
 * ADX 高 = 强趋势。配对/网格等均值回归策略只在低 ADX 区有效——故用它做 regime 闸门。
 * 计算：+DM/-DM → Wilder 平滑的 +DI/-DI → DX=|+DI−−DI|/(+DI+−DI) → ADX=DX 的 Wilder 平滑。
 */
export function adxWilder(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  const tr = new Array<number>(n).fill(0);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const hl = c.high - c.low;
    tr[i] = Math.max(hl, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  // Wilder 平滑（RMA）。
  const rma = (arr: number[]): number[] => {
    const r = new Array<number>(n).fill(0);
    let prev = 0;
    for (let i = 1; i < n; i++) {
      if (i <= period) {
        const slice = arr.slice(1, i + 1);
        prev = slice.reduce((s, x) => s + x, 0) / slice.length;
      } else {
        prev = (prev * (period - 1) + arr[i]) / period;
      }
      r[i] = prev;
    }
    return r;
  };
  const trS = rma(tr), pS = rma(plusDM), mS = rma(minusDM);
  const dx = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const pdi = trS[i] > 0 ? (pS[i] / trS[i]) * 100 : 0;
    const mdi = trS[i] > 0 ? (mS[i] / trS[i]) * 100 : 0;
    const sum = pdi + mdi;
    dx[i] = sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0;
  }
  // ADX = DX 的 Wilder 平滑。
  let prev = 0;
  for (let i = 1; i < n; i++) {
    if (i <= 2 * period) {
      const slice = dx.slice(1, i + 1);
      prev = slice.reduce((s, x) => s + x, 0) / Math.max(1, slice.length);
    } else {
      prev = (prev * (period - 1) + dx[i]) / period;
    }
    out[i] = safeNum(prev, 0);
  }
  return out;
}

/** v5 可调参数（ATR 自适应跟踪止损：把 v4 的固定回撤百分比升级为随波动自适应的回撤距离）。 */
export interface ChokepointV5Options {
  code?: string;
  /** ATR 计算周期（默认 14）。 */
  atrPeriod?: number;
  /** 浮盈达到该倍数后才启用跟踪止损（默认 1.06，与 v4 一致）。 */
  trailActivate?: number;
  /** 建仓初期（未达大涨阈值）的 ATR 倍数：跟踪回撤% = clamp(mult×ATR%)（默认 5.0；3% ATR 票≈15%，对齐 v4 宽松档）。 */
  atrMultBase?: number;
  /** 峰值浮盈达大涨阈值后收紧的 ATR 倍数（默认 3.0；3% ATR 票≈9%，对齐 v4 收紧档）。 */
  atrMultTight?: number;
  /** 峰值浮盈达到该倍数后，回撤距离从宽松切到收紧（默认 1.20，即 +20%）。 */
  tightenGain?: number;
  /** 跟踪回撤% 下限（默认 0.07），防止低波动票止损过紧被洗。 */
  trailFloorPct?: number;
  /** 跟踪回撤% 上限（默认 0.25），防止高波动票止损过松回吐过多。 */
  trailCeilPct?: number;
  /** 是否启用 MA60 趋势过滤（默认 true，与 v4 同口径）。 */
  ma60Filter?: boolean;
}

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测 v5（ATR 自适应止损版）。
 *
 * v5 的入场口径与 v4 完全一致（七类买点 + MA60 中期趋势闸门），且沿用 v4 的跟踪止损「结构」
 * （浮盈 +6% 才启动、分段收紧、跌破筹码支撑止损、高位天量滞涨离场），唯一不同是把 v4 的
 * **固定回撤百分比（15%/9%）升级为随个股真实波动自适应的回撤距离**——国际主流量化机构的通用做法：
 *   - 跟踪回撤% = clamp(mult × ATR(14)%, 下限, 上限)，mult 随浮盈分段收紧（未到 +20% 用 5.0×、
 *     ≥ +20% 收紧到 3.0×）；对 3% ATR 的中等波动票回撤≈15%/9%，与 v4 等价；
 *   - 高波动票自动给更宽的止损（少被正常震荡扫损）、低波动票自动收紧（少回吐利润），
 *     避免 v4「一刀切百分比」在高/低波动票上同时过松或过紧；
 *   - 因仅改「止损距离」而不改启动条件，v5 的换手率与 v4 同量级，是真正可对照的 A/B。
 * 参数可调，默认即调优口径。
 */
export function runChokepointMomentumBacktestV5(
  candles: Candle[],
  chokepointScore: number,
  opts: ChokepointV5Options = {},
): BacktestResult {
  const ATR_PERIOD = opts.atrPeriod ?? 14;
  const TRAIL_ACTIVATE = opts.trailActivate ?? 1.06;
  const ATR_MULT_BASE = opts.atrMultBase ?? 5.0;
  const ATR_MULT_TIGHT = opts.atrMultTight ?? 3.0;
  const TIGHTEN_GAIN = opts.tightenGain ?? 1.2;
  const TRAIL_FLOOR = opts.trailFloorPct ?? 0.07;
  const TRAIL_CEIL = opts.trailCeilPct ?? 0.25;
  const MA60_FILTER = opts.ma60Filter ?? true;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const atr = atrWilder(candles, ATR_PERIOD);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const ma5List = prices.map((_, i) => ma(prices, i, 5));
  const ma10List = prices.map((_, i) => ma(prices, i, 10));
  const ma20List = prices.map((_, i) => ma(prices, i, 20));
  const ma60List = prices.map((_, i) => ma(prices, i, 60));

  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
  const volMa5 = volProxy.map((_, i) => ma(volProxy, i, 5));
  const volMa20 = volProxy.map((_, i) => ma(volProxy, i, 20));

  const bodyOf = (k: Candle) => Math.abs(k.close - k.open);
  const isBullEngulf = (i: number): boolean => {
    if (i < 1) return false;
    const a = candles[i - 1], b = candles[i];
    const aYin = a.close < a.open;
    const bYang = b.close > b.open;
    return aYin && bYang && b.close >= a.open && b.open <= a.close && bodyOf(b) > bodyOf(a) * 0.8;
  };
  const isHammer = (i: number): boolean => {
    const k = candles[i];
    const range = k.high - k.low;
    if (range <= 0) return false;
    const body = bodyOf(k);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    return lowerShadow >= body * 2 && upperShadow <= body && k.close >= k.open;
  };

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let peakClose = 0;
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

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCost = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    const dayRet = prices[i - 1] > 0 ? ((close - prices[i - 1]) / prices[i - 1]) * 100 : 0;

    if (!holding) {
      const ma60 = ma60List[i];
      const ma60Ref = ma60List[Math.max(0, i - 10)];
      const ma60NotFalling = ma60 >= ma60Ref;
      const aboveMa60 = close > ma60;
      const regimeOkRight = !MA60_FILTER || aboveMa60 || ma60NotFalling;

      const isBreakoutGoldCross =
        regimeOkRight && close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      const isVcpBreakout =
        regimeOkRight && close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      const isStrongHighBreakout =
        regimeOkRight && chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        regimeOkRight && close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      const volSpike = volProxy[i] >= volProxy[i - 1] * 1.8 && volProxy[i] >= volMa5[i] * 1.5;
      const lowZone = rangePos <= 0.45;
      const bigYang = close > c.open && dayRet >= 5;
      const closeUpperHalf = c.high > c.low ? close - c.low >= 0.5 * (c.high - c.low) : true;
      const priorBody5 = Math.max(...prices.slice(Math.max(0, i - 5), i));
      const reclaim = close > ma20 || close > priorBody5;
      const bullPattern = bigYang || isBullEngulf(i) || (isHammer(i) && close > c.open);
      const isVolThrustBottom = lowZone && volSpike && closeUpperHalf && reclaim && bullPattern;

      let isDoubleBottomBreak = false;
      if (i >= 46 && rangePos <= 0.6 && close > c.open && volProxy[i] > volMa20[i]) {
        const lookback = candles.slice(i - 45, i);
        const lows = lookback.map((x) => x.low);
        const recentSeg = lookback.slice(-20);
        const recentLow = Math.min(...recentSeg.map((x) => x.low));
        const recentLowAbs = lows.length - 20 + recentSeg.map((x) => x.low).indexOf(recentLow);
        if (recentLowAbs >= 6) {
          const priorSeg = lookback.slice(0, recentLowAbs - 4);
          const priorLow = Math.min(...priorSeg.map((x) => x.low));
          const priorLowAbs = priorSeg.map((x) => x.low).indexOf(priorLow);
          const similar = priorLow > 0 && Math.abs(recentLow - priorLow) / priorLow <= 0.06;
          const between = lookback.slice(priorLowAbs + 1, recentLowAbs);
          const neckline = between.length > 0 ? Math.max(...between.map((x) => x.close)) : Infinity;
          if (similar && close > neckline && Number.isFinite(neckline)) isDoubleBottomBreak = true;
        }
      }

      let isOldDuckHead = false;
      if (i >= 60) {
        const ma5 = ma5List[i], ma10 = ma10List[i], ma60v = ma60List[i];
        const upTrend = ma60v > ma60List[i - 5] && close > ma60v;
        const crossUpToday = ma5 > ma10 && ma5List[i - 1] <= ma10List[i - 1];
        let hadBillPullback = false;
        for (let j = i - 25; j < i; j++) {
          if (j < 1) continue;
          const crossedBefore = ma5List[j] > ma10List[j] && ma5List[j - 1] <= ma10List[j - 1];
          if (crossedBefore) {
            for (let k = j + 1; k < i; k++) {
              if (ma5List[k] <= ma10List[k] * 1.01) { hadBillPullback = true; break; }
            }
          }
          if (hadBillPullback) break;
        }
        const volOk = volProxy[i] > volMa5[i] * 1.1;
        if (upTrend && crossUpToday && hadBillPullback && volOk) isOldDuckHead = true;
      }

      if (
        isBreakoutGoldCross ||
        isVcpBreakout ||
        isStrongHighBreakout ||
        isTrendResume ||
        isVolThrustBottom ||
        isDoubleBottomBreak ||
        isOldDuckHead
      ) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        buyPrice = close;
        peakClose = close;

        const atrPct = close > 0 ? (atr[i] / close) * 100 : 0;
        const baseTrailPct = Math.min(TRAIL_CEIL, Math.max(TRAIL_FLOOR, (ATR_MULT_BASE * atr[i]) / Math.max(close, 1e-9)));
        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        const atrTag = `（入场 ATR ${atrPct.toFixed(1)}%，自适应跟踪回撤约 ${(baseTrailPct * 100).toFixed(0)}%）`;
        let reason = "";
        if (isVolThrustBottom) {
          reason = `${cautionTag}【放量反包·底部启动·v5】相对低位（区位 ${(rangePos * 100).toFixed(0)}%）今日单日爆量（量能 ${(volProxy[i] / volProxy[i - 1]).toFixed(1)} 倍于昨日）放量长阳（日涨 ${dayRet.toFixed(1)}%）收复 MA20/反包前高，呈底部反转启动。${atrTag}`;
        } else if (isDoubleBottomBreak) {
          reason = `${cautionTag}【W底/双底突破·v5】近 45 日构筑双底（两低点高度相近），今日带量收阳向上突破颈线，底部形态确认。${atrTag}`;
        } else if (isOldDuckHead) {
          reason = `${cautionTag}【老鸭头·二次金叉·v5】MA60 趋势向上，MA5 回踩贴近 MA10（鸭嘴缩量）后今日重新放量金叉，主升浪二次启动。${atrTag}`;
        } else if (isStrongHighBreakout) {
          reason = `${cautionTag}【Serenity 强成长突破·v5】基本面得分 ${chokepointScore} 分，MA60 趋势在位，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启。${atrTag}`;
        } else if (isVcpBreakout) {
          reason = `${cautionTag}【VCP箱体整理突破·v5】MA60 趋势在位，股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。${atrTag}`;
        } else if (isTrendResume) {
          reason = `${cautionTag}【趋势回踩再起·v5】MA60 趋势在位，上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场。${atrTag}`;
        } else {
          reason = `${cautionTag}【均线筹码共振突破·v5】MA60 趋势在位，股价突破 20 日均线，且价格处于主力平均成本线（${avgCost.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。${atrTag}`;
        }

        trades.push({ type: "buy", date, price: close, reason });
      }
    } else {
      peakClose = Math.max(peakClose, close);
      const isSupportBroken = close < supportPrice * 0.95;
      // ATR 自适应跟踪止损：沿用 v4 结构（+6% 启动、分段收紧），仅把回撤% 换成随波动自适应。
      const atrMult = peakClose >= buyPrice * TIGHTEN_GAIN ? ATR_MULT_TIGHT : ATR_MULT_BASE;
      const trailPct = Math.min(TRAIL_CEIL, Math.max(TRAIL_FLOOR, (atrMult * atr[i]) / Math.max(close, 1e-9)));
      const trailingActive = peakClose >= buyPrice * TRAIL_ACTIVATE;
      const isAtrStop = trailingActive && close <= peakClose * (1 - trailPct);
      const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

      if (isSupportBroken || isAtrStop || isClimaxRun) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        const profit = close - buyPrice;
        if (profit > 0) winCount++;

        let reason = "";
        if (isAtrStop) {
          reason = `【ATR 自适应跟踪止盈·v5】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(trailPct * 100).toFixed(0)}%（随 ${atrMult.toFixed(1)}×ATR 自适应，现价 ${close.toFixed(2)}），按真实波动锁定波段利润离场。`;
        } else if (isSupportBroken) {
          reason = `【主力防线失守止损】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，中期洗盘出局。`;
        } else if (isClimaxRun) {
          reason = `【高位超买天量滞涨】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct!.toFixed(1)}% 创天量，高位筹码剧烈松动。`;
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
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
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

export interface ChokepointV6Options {
  code?: string;
  /** ATR 计算周期（默认 14）。 */
  atrPeriod?: number;
  /** 初始建仓占满仓资金比例（默认 1.0，整仓建仓——金字塔加仓经真实数据 A/B 证伪反而拖累收益，默认关闭）。 */
  initialFrac?: number;
  /** 每次金字塔加仓占满仓资金比例（默认 0.25，仅在显式开启加仓时生效）。 */
  addFrac?: number;
  /** 最多加仓次数（默认 0，关闭金字塔加仓；经 15 只池实测加仓抬高均价、震荡市被洗，净收益反降）。 */
  maxAdds?: number;
  /** 加仓触发：较上次买入价需再上涨的幅度 = max(5%, addAtrMult×ATR%)（默认 1.0×ATR%）。 */
  addAtrMult?: number;
  /** 分批止盈触发：浮盈（相对加权成本）达该倍数时止盈一部分（默认 1.25，即 +25%——实测最优）。 */
  scaleOutGain?: number;
  /** 分批止盈卖出占当前持仓比例（默认 0.25，卖 1/4 锁利、留 3/4 奔跑——实测最优）。 */
  scaleOutFrac?: number;
  /** 浮盈达该倍数后才启用跟踪止损（默认 1.06）。 */
  trailActivate?: number;
  /** 未分批止盈前的 ATR 跟踪倍数（默认 5.0，与 v5 宽松档一致）。 */
  atrMultBase?: number;
  /** 分批止盈后「底仓 runner」的 ATR 跟踪倍数（默认 6.0，比 v5 收紧档 3.0× 宽得多，让利润奔跑、吃到趋势尾段——实测最优）。 */
  atrMultRunner?: number;
  /** 跟踪回撤% 下限（默认 0.07）。 */
  trailFloorPct?: number;
  /** 跟踪回撤% 上限（默认 0.30，给 runner 更大容忍）。 */
  trailCeilPct?: number;
  /** 是否启用 MA60 趋势过滤（默认 true，与 v4/v5 同口径）。 */
  ma60Filter?: boolean;
}

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测 v6（整仓建仓 + 分批止盈 / 留宽 runner 奔跑）。
 *
 * v6 的入场「信号」与 v4/v5 完全一致（七类买点 + MA60 中期趋势闸门），区别只在「仓位管理」。
 * 设计动机源自用户的真实疑问：「策略只赚 +5%，个股同期却涨 +66%」——趋势跟随带止损，在单边大牛股上
 * 会被洗出/踏空、回吐利润。本版借鉴国际趋势跟随机构（海龟交易法等）的「分批」做法逐一用真实数据 A/B 验证：
 *   1. 分批止盈（逐步卖出 / 留 runner，✅ 实测有效）：浮盈达 +25% 先止盈约 1/4 落袋锁利，剩余 3/4「底仓
 *      runner」改用更宽的 ATR 跟踪止损（默认 6.0×ATR%，远宽于 v5 收紧档 3.0×）继续奔跑 → 既锁住一部分利润
 *      平滑曲线，又让大头吃到趋势尾段。15 只池实测：平均每股收益、正收益股数、对买入持有的捕获率、组合复利
 *      净值全面优于 v5（捕获率从 81%→109%，组合净值乘积 10.4→26.6）。
 *   2. 金字塔加仓（逐步买入 / 分批建仓，❌ 实测证伪、默认关闭）：信号出现先建底仓、趋势确认逐档加仓的做法，
 *      在本策略上抬高平均成本、且在震荡票上加的仓屡被止损打掉，净收益与捕获率反而大幅下降（捕获率掉到 ~31-48%）。
 *      代码保留该能力（initialFrac/maxAdds/addFrac 可调），但默认 initialFrac=1.0、maxAdds=0 即整仓建仓、不加仓。
 *   3. 风控出局（跌破筹码支撑止损、高位天量滞涨）触发时清掉全部剩余仓位，不补仓不马丁格尔。
 * 诚实提醒：分批止盈在极端单边里仍会少赚（卖飞的那 1/4），且无法既「砍亏损」又「满吃每一只赢家」——这是
 * 趋势跟随的固有权衡；v6 的增益来自更宽的 runner 让赢家奔跑 + 分批止盈提升一致性，而非加仓。参数可调，默认即实测最优口径。
 */
export function runChokepointMomentumBacktestV6(
  candles: Candle[],
  chokepointScore: number,
  opts: ChokepointV6Options = {},
): BacktestResult {
  const ATR_PERIOD = opts.atrPeriod ?? 14;
  const INITIAL_FRAC = opts.initialFrac ?? 1.0;
  const ADD_FRAC = opts.addFrac ?? 0.25;
  const MAX_ADDS = opts.maxAdds ?? 0;
  const ADD_ATR_MULT = opts.addAtrMult ?? 1.0;
  const SCALE_OUT_GAIN = opts.scaleOutGain ?? 1.25;
  const SCALE_OUT_FRAC = opts.scaleOutFrac ?? 0.25;
  const TRAIL_ACTIVATE = opts.trailActivate ?? 1.06;
  const ATR_MULT_BASE = opts.atrMultBase ?? 5.0;
  const ATR_MULT_RUNNER = opts.atrMultRunner ?? 6.0;
  const TRAIL_FLOOR = opts.trailFloorPct ?? 0.07;
  const TRAIL_CEIL = opts.trailCeilPct ?? 0.3;
  const MA60_FILTER = opts.ma60Filter ?? true;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const atr = atrWilder(candles, ATR_PERIOD);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const ma5List = prices.map((_, i) => ma(prices, i, 5));
  const ma10List = prices.map((_, i) => ma(prices, i, 10));
  const ma20List = prices.map((_, i) => ma(prices, i, 20));
  const ma60List = prices.map((_, i) => ma(prices, i, 60));

  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
  const volMa5 = volProxy.map((_, i) => ma(volProxy, i, 5));
  const volMa20 = volProxy.map((_, i) => ma(volProxy, i, 20));

  const bodyOf = (k: Candle) => Math.abs(k.close - k.open);
  const isBullEngulf = (i: number): boolean => {
    if (i < 1) return false;
    const a = candles[i - 1], b = candles[i];
    const aYin = a.close < a.open;
    const bYang = b.close > b.open;
    return aYin && bYang && b.close >= a.open && b.open <= a.close && bodyOf(b) > bodyOf(a) * 0.8;
  };
  const isHammer = (i: number): boolean => {
    const k = candles[i];
    const range = k.high - k.low;
    if (range <= 0) return false;
    const body = bodyOf(k);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    return lowerShadow >= body * 2 && upperShadow <= body && k.close >= k.open;
  };

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let avgCost = 0;
  let peakClose = 0;
  let deployedFrac = 0;
  let addsDone = 0;
  let lastBuyPrice = 0;
  let hasScaledOut = false;
  let posDeployedCash = 0;
  let posProceedsCash = 0;
  let winCount = 0;
  let tradeCount = 0;

  const initialStockWorth = prices[20];

  const buyFrac = (f: number, px: number, date: string, reason: string): void => {
    const room = Math.max(0, 1 - deployedFrac);
    const useFrac = Math.min(f, room);
    if (useFrac <= 1e-9) return;
    const spend = Math.min(cash, useFrac * 100000);
    if (spend <= 0) return;
    const sharesBought = buyShares(spend, px, DEFAULT_COST_MODEL);
    const newShares = shares + sharesBought;
    avgCost = newShares > 0 ? (avgCost * shares + px * sharesBought) / newShares : px;
    shares = newShares;
    cash -= spend;
    deployedFrac += useFrac;
    posDeployedCash += spend;
    lastBuyPrice = px;
    trades.push({ type: "buy", date, price: px, reason, sizePct: Number(useFrac.toFixed(4)) });
  };

  const sellFrac = (sf: number, px: number, date: string, reason: string): void => {
    const sharesSold = sf >= 1 ? shares : shares * sf;
    if (sharesSold <= 1e-12) return;
    const proceeds = sellProceeds(sharesSold, px, DEFAULT_COST_MODEL);
    cash += proceeds;
    shares -= sharesSold;
    posProceedsCash += proceeds;
    trades.push({
      type: "sell",
      date,
      price: px,
      reason,
      profitPct: avgCost > 0 ? ((px - avgCost) / avgCost) * 100 : 0,
      sizePct: sf >= 1 ? 1 : Number(sf.toFixed(4)),
    });
    if (shares <= 1e-6) {
      tradeCount++;
      if (posProceedsCash > posDeployedCash) winCount++;
      shares = 0;
      holding = false;
      deployedFrac = 0;
      addsDone = 0;
      hasScaledOut = false;
      avgCost = 0;
      peakClose = 0;
      lastBuyPrice = 0;
      posDeployedCash = 0;
      posProceedsCash = 0;
    }
  };

  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;
    const ma20 = ma20List[i];
    const t5 = volMa5[i];
    const t20 = volMa20[i];

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCostChip = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    const dayRet = prices[i - 1] > 0 ? ((close - prices[i - 1]) / prices[i - 1]) * 100 : 0;

    if (!holding) {
      const ma60 = ma60List[i];
      const ma60Ref = ma60List[Math.max(0, i - 10)];
      const ma60NotFalling = ma60 >= ma60Ref;
      const aboveMa60 = close > ma60;
      const regimeOkRight = !MA60_FILTER || aboveMa60 || ma60NotFalling;

      const isBreakoutGoldCross =
        regimeOkRight && close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      const isVcpBreakout =
        regimeOkRight && close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      const isStrongHighBreakout =
        regimeOkRight && chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        regimeOkRight && close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      const volSpike = volProxy[i] >= volProxy[i - 1] * 1.8 && volProxy[i] >= volMa5[i] * 1.5;
      const lowZone = rangePos <= 0.45;
      const bigYang = close > c.open && dayRet >= 5;
      const closeUpperHalf = c.high > c.low ? close - c.low >= 0.5 * (c.high - c.low) : true;
      const priorBody5 = Math.max(...prices.slice(Math.max(0, i - 5), i));
      const reclaim = close > ma20 || close > priorBody5;
      const bullPattern = bigYang || isBullEngulf(i) || (isHammer(i) && close > c.open);
      const isVolThrustBottom = lowZone && volSpike && closeUpperHalf && reclaim && bullPattern;

      let isDoubleBottomBreak = false;
      if (i >= 46 && rangePos <= 0.6 && close > c.open && volProxy[i] > volMa20[i]) {
        const lookback = candles.slice(i - 45, i);
        const lows = lookback.map((x) => x.low);
        const recentSeg = lookback.slice(-20);
        const recentLow = Math.min(...recentSeg.map((x) => x.low));
        const recentLowAbs = lows.length - 20 + recentSeg.map((x) => x.low).indexOf(recentLow);
        if (recentLowAbs >= 6) {
          const priorSeg = lookback.slice(0, recentLowAbs - 4);
          const priorLow = Math.min(...priorSeg.map((x) => x.low));
          const priorLowAbs = priorSeg.map((x) => x.low).indexOf(priorLow);
          const similar = priorLow > 0 && Math.abs(recentLow - priorLow) / priorLow <= 0.06;
          const between = lookback.slice(priorLowAbs + 1, recentLowAbs);
          const neckline = between.length > 0 ? Math.max(...between.map((x) => x.close)) : Infinity;
          if (similar && close > neckline && Number.isFinite(neckline)) isDoubleBottomBreak = true;
        }
      }

      let isOldDuckHead = false;
      if (i >= 60) {
        const ma5 = ma5List[i], ma10 = ma10List[i], ma60v = ma60List[i];
        const upTrend = ma60v > ma60List[i - 5] && close > ma60v;
        const crossUpToday = ma5 > ma10 && ma5List[i - 1] <= ma10List[i - 1];
        let hadBillPullback = false;
        for (let j = i - 25; j < i; j++) {
          if (j < 1) continue;
          const crossedBefore = ma5List[j] > ma10List[j] && ma5List[j - 1] <= ma10List[j - 1];
          if (crossedBefore) {
            for (let k = j + 1; k < i; k++) {
              if (ma5List[k] <= ma10List[k] * 1.01) { hadBillPullback = true; break; }
            }
          }
          if (hadBillPullback) break;
        }
        const volOk = volProxy[i] > volMa5[i] * 1.1;
        if (upTrend && crossUpToday && hadBillPullback && volOk) isOldDuckHead = true;
      }

      if (
        isBreakoutGoldCross ||
        isVcpBreakout ||
        isStrongHighBreakout ||
        isTrendResume ||
        isVolThrustBottom ||
        isDoubleBottomBreak ||
        isOldDuckHead
      ) {
        holding = true;
        peakClose = close;
        const atrPct = close > 0 ? (atr[i] / close) * 100 : 0;
        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        const pyramidOn = MAX_ADDS > 0 && INITIAL_FRAC < 1;
        const initTag = pyramidOn
          ? `（v6 分批建仓：先建底仓 ${(INITIAL_FRAC * 100).toFixed(0)}%，趋势确认再金字塔加仓；入场 ATR ${atrPct.toFixed(1)}%）`
          : `（v6 整仓建仓，浮盈 +${((SCALE_OUT_GAIN - 1) * 100).toFixed(0)}% 起分批止盈、底仓挂 ${ATR_MULT_RUNNER.toFixed(1)}×ATR 宽止损让利润奔跑；入场 ATR ${atrPct.toFixed(1)}%）`;
        let signal = "";
        if (isVolThrustBottom) {
          signal = `【放量反包·底部启动·v6】相对低位（区位 ${(rangePos * 100).toFixed(0)}%）今日单日爆量（量能 ${(volProxy[i] / volProxy[i - 1]).toFixed(1)} 倍于昨日）放量长阳收复 MA20/反包前高，呈底部反转启动。`;
        } else if (isDoubleBottomBreak) {
          signal = `【W底/双底突破·v6】近 45 日构筑双底（两低点高度相近），今日带量收阳向上突破颈线，底部形态确认。`;
        } else if (isOldDuckHead) {
          signal = `【老鸭头·二次金叉·v6】MA60 趋势向上，MA5 回踩贴近 MA10（鸭嘴缩量）后今日重新放量金叉，主升浪二次启动。`;
        } else if (isStrongHighBreakout) {
          signal = `【Serenity 强成长突破·v6】基本面得分 ${chokepointScore} 分，MA60 趋势在位，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启。`;
        } else if (isVcpBreakout) {
          signal = `【VCP箱体整理突破·v6】MA60 趋势在位，股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else if (isTrendResume) {
          signal = `【趋势回踩再起·v6】MA60 趋势在位，上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场。`;
        } else {
          signal = `【均线筹码共振突破·v6】MA60 趋势在位，股价突破 20 日均线，且价格处于主力平均成本线（${avgCostChip.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }
        buyFrac(INITIAL_FRAC, close, date, `${cautionTag}${signal}${initTag}`);
      }
    } else {
      peakClose = Math.max(peakClose, close);

      // 1) 金字塔加仓（逐步买入）：趋势确认 + 创新高 + 较上次买入价再上涨足够幅度。
      if (deployedFrac < 1 - 1e-9 && addsDone < MAX_ADDS) {
        const ma60 = ma60List[i];
        const ma60Ref = ma60List[Math.max(0, i - 10)];
        const ma60NotFalling = ma60 >= ma60Ref;
        const atrPctNow = close > 0 ? atr[i] / close : 0;
        const gapNeeded = Math.max(0.05, ADD_ATR_MULT * atrPctNow);
        const trendIntact = close > ma20 && ma60NotFalling;
        const brokeHigher = lastBuyPrice > 0 && close >= lastBuyPrice * (1 + gapNeeded) && close >= peakClose;
        if (trendIntact && brokeHigher) {
          addsDone++;
          const addReason = `【金字塔加仓·v6】趋势确认（价在 MA20 上、MA60 不下行），较上次买入价 ${lastBuyPrice.toFixed(2)} 元上涨超 ${(gapNeeded * 100).toFixed(1)}%（现价 ${close.toFixed(2)}），第 ${addsDone} 次顺势加仓 ${(ADD_FRAC * 100).toFixed(0)}%，仓位向满仓推进、让趋势带动盈利。`;
          buyFrac(ADD_FRAC, close, date, addReason);
        }
      }

      // 2) 分批止盈 / 风控出局（买卖不同一根 K 触发：若本根已加仓则跳过卖出判断）。
      if (holding) {
        const justAdded = trades.length > 0 && trades[trades.length - 1].type === "buy" && trades[trades.length - 1].date === date;
        if (!justAdded) {
          const isSupportBroken = close < supportPrice * 0.95;
          const gainFromAvg = avgCost > 0 ? close / avgCost : 1;
          const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

          if (!hasScaledOut && gainFromAvg >= SCALE_OUT_GAIN && !isSupportBroken && !isClimaxRun) {
            hasScaledOut = true;
            const reason = `【分批止盈·v6】浮盈达 +${((gainFromAvg - 1) * 100).toFixed(0)}%（加权成本 ${avgCost.toFixed(2)} 元），先止盈约 ${(SCALE_OUT_FRAC * 100).toFixed(0)}% 落袋锁利，剩余底仓改挂更宽的 ${ATR_MULT_RUNNER.toFixed(1)}×ATR 跟踪止损继续奔跑，吃趋势尾段。`;
            sellFrac(SCALE_OUT_FRAC, close, date, reason);
          } else {
            const atrMult = hasScaledOut ? ATR_MULT_RUNNER : ATR_MULT_BASE;
            const trailPct = Math.min(TRAIL_CEIL, Math.max(TRAIL_FLOOR, (atrMult * atr[i]) / Math.max(close, 1e-9)));
            const trailingActive = peakClose >= avgCost * TRAIL_ACTIVATE;
            const isAtrStop = trailingActive && close <= peakClose * (1 - trailPct);
            if (isSupportBroken || isAtrStop || isClimaxRun) {
              let reason = "";
              if (isAtrStop) {
                const runnerTag = hasScaledOut ? "（已分批止盈、底仓 runner 宽止损）" : "";
                reason = `【ATR 自适应跟踪止盈·v6】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(trailPct * 100).toFixed(0)}%（随 ${atrMult.toFixed(1)}×ATR 自适应，现价 ${close.toFixed(2)}）${runnerTag}，清掉剩余仓位锁定波段利润。`;
              } else if (isSupportBroken) {
                reason = `【主力防线失守止损】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，清掉全部仓位中期洗盘出局。`;
              } else {
                reason = `【高位超买天量滞涨】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct!.toFixed(1)}% 创天量，高位筹码剧烈松动，清仓离场。`;
              }
              sellFrac(1, close, date, reason);
            }
          }
        }
      }
    }

    const currentWorth = cash + shares * close;
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
      stockWorth: Number(stockWorth.toFixed(0)),
    });
  }

  const lastPrice = prices[prices.length - 1];
  const finalWorth = cash + shares * lastPrice;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((lastPrice - initialStockWorth) / initialStockWorth) * 100;
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

export interface ChokepointV7Options extends ChokepointV6Options {
  /** ADX 计算周期（默认 14）。 */
  adxPeriod?: number;
  /** 判定箱体震荡的 ADX 上限（默认 22，ADX 低于此且 MA60 走平即视为箱体）。 */
  rangeAdxMax?: number;
  /** 箱体高抛触发的区间位置下限（默认 0.82，价升至区间上沿才高抛）。 */
  rangeExitPos?: number;
  /** 前移止盈触发倍数（默认 1.08，即浮盈 +8% 先减一档）。 */
  earlyScaleGain?: number;
  /** 前移止盈卖出占当前持仓比例（默认 0.34，约 1/3）。 */
  earlyScaleFrac?: number;
  /** 结构+时间止损：跟踪止损未激活且持仓超过该根数后跌破 MA20 即清仓（默认 15）。 */
  structStopBars?: number;
}

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测 v7（regime 自适应出场）。
 *
 * v7 的入场「信号」与 v4/v5/v6 完全一致（七类买点 + MA60 中期趋势闸门），保证与历史版本可对照；
 * 升级集中在「出场」，针对 v6 在箱体震荡票上「只买不卖、坐电梯回吐」的痛点：
 *   1. regime 判定：用 ADX(14) + MA60 斜率判断当前是「趋势」还是「箱体」。
 *   2. 箱体高抛（核心修复）：确认箱体（ADX < 22 且 MA60 走平）时，价格升至区间上沿（rangePos ≥ 0.82）
 *      且当根滞涨/收阴即均值回归清仓——让策略在箱体里终于有卖点，而非干等不触发的趋势止盈。
 *   3. 前移止盈阶梯：浮盈 +8% 先减约 1/3 落袋（箱体反弹也能兑现），保留 v6 的 +25% 再减 + 6×ATR runner。
 *   4. 结构+时间止损：买入后迟迟未站上成本 +6%（跟踪止损未激活）、持仓超 15 根又跌破 MA20，判定突破失败，
 *      砍掉死钱避免在死区来回磨损。
 * 趋势行情下 ADX 走高 → 不判为箱体，箱体高抛不触发，仍由 v6 的分批止盈 + 宽 runner 吃趋势尾段，
 * 因此 v7 是「趋势照旧奔跑、箱体主动高抛」的自适应版。其余风控（筹码支撑止损、天量滞涨）与 v6 一致。
 */
export function runChokepointMomentumBacktestV7(
  candles: Candle[],
  chokepointScore: number,
  opts: ChokepointV7Options = {},
): BacktestResult {
  const ATR_PERIOD = opts.atrPeriod ?? 14;
  const INITIAL_FRAC = opts.initialFrac ?? 1.0;
  const ADD_FRAC = opts.addFrac ?? 0.25;
  const MAX_ADDS = opts.maxAdds ?? 0;
  const ADD_ATR_MULT = opts.addAtrMult ?? 1.0;
  const SCALE_OUT_GAIN = opts.scaleOutGain ?? 1.25;
  const SCALE_OUT_FRAC = opts.scaleOutFrac ?? 0.25;
  const TRAIL_ACTIVATE = opts.trailActivate ?? 1.06;
  const ATR_MULT_BASE = opts.atrMultBase ?? 5.0;
  const ATR_MULT_RUNNER = opts.atrMultRunner ?? 6.0;
  const TRAIL_FLOOR = opts.trailFloorPct ?? 0.07;
  const TRAIL_CEIL = opts.trailCeilPct ?? 0.3;
  const MA60_FILTER = opts.ma60Filter ?? true;
  const ADX_PERIOD = opts.adxPeriod ?? 14;
  const RANGE_ADX_MAX = opts.rangeAdxMax ?? 22;
  const RANGE_EXIT_POS = opts.rangeExitPos ?? 0.82;
  const EARLY_SCALE_GAIN = opts.earlyScaleGain ?? 1.08;
  const EARLY_SCALE_FRAC = opts.earlyScaleFrac ?? 0.34;
  const STRUCT_STOP_BARS = opts.structStopBars ?? 15;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const atr = atrWilder(candles, ATR_PERIOD);
  const adx = adxWilder(candles, ADX_PERIOD);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const ma5List = prices.map((_, i) => ma(prices, i, 5));
  const ma10List = prices.map((_, i) => ma(prices, i, 10));
  const ma20List = prices.map((_, i) => ma(prices, i, 20));
  const ma60List = prices.map((_, i) => ma(prices, i, 60));

  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
  const volMa5 = volProxy.map((_, i) => ma(volProxy, i, 5));
  const volMa20 = volProxy.map((_, i) => ma(volProxy, i, 20));

  const bodyOf = (k: Candle) => Math.abs(k.close - k.open);
  const isBullEngulf = (i: number): boolean => {
    if (i < 1) return false;
    const a = candles[i - 1], b = candles[i];
    const aYin = a.close < a.open;
    const bYang = b.close > b.open;
    return aYin && bYang && b.close >= a.open && b.open <= a.close && bodyOf(b) > bodyOf(a) * 0.8;
  };
  const isHammer = (i: number): boolean => {
    const k = candles[i];
    const range = k.high - k.low;
    if (range <= 0) return false;
    const body = bodyOf(k);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    return lowerShadow >= body * 2 && upperShadow <= body && k.close >= k.open;
  };

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let avgCost = 0;
  let peakClose = 0;
  let deployedFrac = 0;
  let addsDone = 0;
  let lastBuyPrice = 0;
  let hasScaledOut = false;
  let earlyScaled = false;
  let entryIndex = -1;
  let posDeployedCash = 0;
  let posProceedsCash = 0;
  let winCount = 0;
  let tradeCount = 0;

  const initialStockWorth = prices[20];

  const buyFrac = (f: number, px: number, date: string, reason: string): void => {
    const room = Math.max(0, 1 - deployedFrac);
    const useFrac = Math.min(f, room);
    if (useFrac <= 1e-9) return;
    const spend = Math.min(cash, useFrac * 100000);
    if (spend <= 0) return;
    const sharesBought = buyShares(spend, px, DEFAULT_COST_MODEL);
    const newShares = shares + sharesBought;
    avgCost = newShares > 0 ? (avgCost * shares + px * sharesBought) / newShares : px;
    shares = newShares;
    cash -= spend;
    deployedFrac += useFrac;
    posDeployedCash += spend;
    lastBuyPrice = px;
    trades.push({ type: "buy", date, price: px, reason, sizePct: Number(useFrac.toFixed(4)) });
  };

  const sellFrac = (sf: number, px: number, date: string, reason: string): void => {
    const sharesSold = sf >= 1 ? shares : shares * sf;
    if (sharesSold <= 1e-12) return;
    const proceeds = sellProceeds(sharesSold, px, DEFAULT_COST_MODEL);
    cash += proceeds;
    shares -= sharesSold;
    posProceedsCash += proceeds;
    trades.push({
      type: "sell",
      date,
      price: px,
      reason,
      profitPct: avgCost > 0 ? ((px - avgCost) / avgCost) * 100 : 0,
      sizePct: sf >= 1 ? 1 : Number(sf.toFixed(4)),
    });
    if (shares <= 1e-6) {
      tradeCount++;
      if (posProceedsCash > posDeployedCash) winCount++;
      shares = 0;
      holding = false;
      deployedFrac = 0;
      addsDone = 0;
      hasScaledOut = false;
      earlyScaled = false;
      entryIndex = -1;
      avgCost = 0;
      peakClose = 0;
      lastBuyPrice = 0;
      posDeployedCash = 0;
      posProceedsCash = 0;
    }
  };

  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;
    const ma20 = ma20List[i];
    const t5 = volMa5[i];
    const t20 = volMa20[i];

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCostChip = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    const dayRet = prices[i - 1] > 0 ? ((close - prices[i - 1]) / prices[i - 1]) * 100 : 0;

    if (!holding) {
      const ma60 = ma60List[i];
      const ma60Ref = ma60List[Math.max(0, i - 10)];
      const ma60NotFalling = ma60 >= ma60Ref;
      const aboveMa60 = close > ma60;
      const regimeOkRight = !MA60_FILTER || aboveMa60 || ma60NotFalling;

      const isBreakoutGoldCross =
        regimeOkRight && close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      const isVcpBreakout =
        regimeOkRight && close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      const isStrongHighBreakout =
        regimeOkRight && chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        regimeOkRight && close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      const volSpike = volProxy[i] >= volProxy[i - 1] * 1.8 && volProxy[i] >= volMa5[i] * 1.5;
      const lowZone = rangePos <= 0.45;
      const bigYang = close > c.open && dayRet >= 5;
      const closeUpperHalf = c.high > c.low ? close - c.low >= 0.5 * (c.high - c.low) : true;
      const priorBody5 = Math.max(...prices.slice(Math.max(0, i - 5), i));
      const reclaim = close > ma20 || close > priorBody5;
      const bullPattern = bigYang || isBullEngulf(i) || (isHammer(i) && close > c.open);
      const isVolThrustBottom = lowZone && volSpike && closeUpperHalf && reclaim && bullPattern;

      let isDoubleBottomBreak = false;
      if (i >= 46 && rangePos <= 0.6 && close > c.open && volProxy[i] > volMa20[i]) {
        const lookback = candles.slice(i - 45, i);
        const lows = lookback.map((x) => x.low);
        const recentSeg = lookback.slice(-20);
        const recentLow = Math.min(...recentSeg.map((x) => x.low));
        const recentLowAbs = lows.length - 20 + recentSeg.map((x) => x.low).indexOf(recentLow);
        if (recentLowAbs >= 6) {
          const priorSeg = lookback.slice(0, recentLowAbs - 4);
          const priorLow = Math.min(...priorSeg.map((x) => x.low));
          const priorLowAbs = priorSeg.map((x) => x.low).indexOf(priorLow);
          const similar = priorLow > 0 && Math.abs(recentLow - priorLow) / priorLow <= 0.06;
          const between = lookback.slice(priorLowAbs + 1, recentLowAbs);
          const neckline = between.length > 0 ? Math.max(...between.map((x) => x.close)) : Infinity;
          if (similar && close > neckline && Number.isFinite(neckline)) isDoubleBottomBreak = true;
        }
      }

      let isOldDuckHead = false;
      if (i >= 60) {
        const ma5 = ma5List[i], ma10 = ma10List[i], ma60v = ma60List[i];
        const upTrend = ma60v > ma60List[i - 5] && close > ma60v;
        const crossUpToday = ma5 > ma10 && ma5List[i - 1] <= ma10List[i - 1];
        let hadBillPullback = false;
        for (let j = i - 25; j < i; j++) {
          if (j < 1) continue;
          const crossedBefore = ma5List[j] > ma10List[j] && ma5List[j - 1] <= ma10List[j - 1];
          if (crossedBefore) {
            for (let k = j + 1; k < i; k++) {
              if (ma5List[k] <= ma10List[k] * 1.01) { hadBillPullback = true; break; }
            }
          }
          if (hadBillPullback) break;
        }
        const volOk = volProxy[i] > volMa5[i] * 1.1;
        if (upTrend && crossUpToday && hadBillPullback && volOk) isOldDuckHead = true;
      }

      if (
        isBreakoutGoldCross ||
        isVcpBreakout ||
        isStrongHighBreakout ||
        isTrendResume ||
        isVolThrustBottom ||
        isDoubleBottomBreak ||
        isOldDuckHead
      ) {
        holding = true;
        peakClose = close;
        entryIndex = i;
        earlyScaled = false;
        const atrPct = close > 0 ? (atr[i] / close) * 100 : 0;
        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        const pyramidOn = MAX_ADDS > 0 && INITIAL_FRAC < 1;
        const initTag = pyramidOn
          ? `（v7 分批建仓：先建底仓 ${(INITIAL_FRAC * 100).toFixed(0)}%，趋势确认再金字塔加仓；入场 ATR ${atrPct.toFixed(1)}%）`
          : `（v7 整仓建仓，浮盈 +${((EARLY_SCALE_GAIN - 1) * 100).toFixed(0)}% 先减 ${(EARLY_SCALE_FRAC * 100).toFixed(0)}%、+${((SCALE_OUT_GAIN - 1) * 100).toFixed(0)}% 再减、底仓挂 ${ATR_MULT_RUNNER.toFixed(1)}×ATR 宽止损奔跑；箱体高抛、突破失败结构止损；入场 ATR ${atrPct.toFixed(1)}%）`;
        let signal = "";
        if (isVolThrustBottom) {
          signal = `【放量反包·底部启动·v7】相对低位（区位 ${(rangePos * 100).toFixed(0)}%）今日单日爆量（量能 ${(volProxy[i] / volProxy[i - 1]).toFixed(1)} 倍于昨日）放量长阳收复 MA20/反包前高，呈底部反转启动。`;
        } else if (isDoubleBottomBreak) {
          signal = `【W底/双底突破·v7】近 45 日构筑双底（两低点高度相近），今日带量收阳向上突破颈线，底部形态确认。`;
        } else if (isOldDuckHead) {
          signal = `【老鸭头·二次金叉·v7】MA60 趋势向上，MA5 回踩贴近 MA10（鸭嘴缩量）后今日重新放量金叉，主升浪二次启动。`;
        } else if (isStrongHighBreakout) {
          signal = `【Serenity 强成长突破·v7】基本面得分 ${chokepointScore} 分，MA60 趋势在位，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启。`;
        } else if (isVcpBreakout) {
          signal = `【VCP箱体整理突破·v7】MA60 趋势在位，股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else if (isTrendResume) {
          signal = `【趋势回踩再起·v7】MA60 趋势在位，上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场。`;
        } else {
          signal = `【均线筹码共振突破·v7】MA60 趋势在位，股价突破 20 日均线，且价格处于主力平均成本线（${avgCostChip.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }
        buyFrac(INITIAL_FRAC, close, date, `${cautionTag}${signal}${initTag}`);
      }
    } else {
      peakClose = Math.max(peakClose, close);

      // 1) 金字塔加仓（逐步买入）：趋势确认 + 创新高 + 较上次买入价再上涨足够幅度。
      if (deployedFrac < 1 - 1e-9 && addsDone < MAX_ADDS) {
        const ma60 = ma60List[i];
        const ma60Ref = ma60List[Math.max(0, i - 10)];
        const ma60NotFalling = ma60 >= ma60Ref;
        const atrPctNow = close > 0 ? atr[i] / close : 0;
        const gapNeeded = Math.max(0.05, ADD_ATR_MULT * atrPctNow);
        const trendIntact = close > ma20 && ma60NotFalling;
        const brokeHigher = lastBuyPrice > 0 && close >= lastBuyPrice * (1 + gapNeeded) && close >= peakClose;
        if (trendIntact && brokeHigher) {
          addsDone++;
          const addReason = `【金字塔加仓·v7】趋势确认（价在 MA20 上、MA60 不下行），较上次买入价 ${lastBuyPrice.toFixed(2)} 元上涨超 ${(gapNeeded * 100).toFixed(1)}%（现价 ${close.toFixed(2)}），第 ${addsDone} 次顺势加仓 ${(ADD_FRAC * 100).toFixed(0)}%，仓位向满仓推进、让趋势带动盈利。`;
          buyFrac(ADD_FRAC, close, date, addReason);
        }
      }

      // 2) 分批止盈 / 风控出局（买卖不同一根 K 触发：若本根已加仓则跳过卖出判断）。
      if (holding) {
        const justAdded = trades.length > 0 && trades[trades.length - 1].type === "buy" && trades[trades.length - 1].date === date;
        if (!justAdded) {
          const isSupportBroken = close < supportPrice * 0.95;
          const gainFromAvg = avgCost > 0 ? close / avgCost : 1;
          const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

          // regime 判定：ADX 低 + MA60 走平 → 箱体震荡；否则视为趋势行情
          const adxNow = adx[i];
          const ma60Now = ma60List[i];
          const ma60Slope10 = ma60Now - ma60List[Math.max(0, i - 10)];
          const ma60Flat = Math.abs(ma60Slope10) / Math.max(close, 1e-9) < 0.03;
          const isRanging = adxNow < RANGE_ADX_MAX && ma60Flat;

          // 跟踪止损（与 v6 同口径：分批止盈后底仓 runner 用更宽倍数）
          const atrMult = hasScaledOut ? ATR_MULT_RUNNER : ATR_MULT_BASE;
          const trailPct = Math.min(TRAIL_CEIL, Math.max(TRAIL_FLOOR, (atrMult * atr[i]) / Math.max(close, 1e-9)));
          const trailingActive = peakClose >= avgCost * TRAIL_ACTIVATE;
          const isAtrStop = trailingActive && close <= peakClose * (1 - trailPct);

          // 箱体高抛（v7 核心修复）：确认箱体 + 价到区间上沿 + 当根滞涨/收阴 → 均值回归清仓
          const stalling = close < c.open || close < prices[i - 1];
          const isRangeTopExit = isRanging && rangePos >= RANGE_EXIT_POS && stalling && gainFromAvg > 1.0;

          // 结构 + 时间止损（v7）：买入后迟迟未站上成本 +6%（跟踪未激活）、持仓超 N 根又跌破 MA20 → 砍掉死钱
          const barsHeld = entryIndex >= 0 ? i - entryIndex : 0;
          const isStructStop = !trailingActive && barsHeld >= STRUCT_STOP_BARS && close < ma20;

          if (isSupportBroken || isClimaxRun || isAtrStop || isRangeTopExit || isStructStop) {
            // 全部清仓：风控止损 / 跟踪止盈 / 箱体高抛 / 结构止损（优先级高于分批止盈）
            let reason = "";
            if (isSupportBroken) {
              reason = `【主力防线失守止损·v7】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，清掉全部仓位中期洗盘出局。`;
            } else if (isClimaxRun) {
              reason = `【高位超买天量滞涨·v7】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct!.toFixed(1)}% 创天量，高位筹码剧烈松动，清仓离场。`;
            } else if (isAtrStop) {
              const runnerTag = hasScaledOut ? "（已分批止盈、底仓 runner 宽止损）" : "";
              reason = `【ATR 自适应跟踪止盈·v7】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(trailPct * 100).toFixed(0)}%（随 ${atrMult.toFixed(1)}×ATR 自适应，现价 ${close.toFixed(2)}）${runnerTag}，清掉剩余仓位锁定波段利润。`;
            } else if (isRangeTopExit) {
              reason = `【箱体高抛·v7】判定为箱体震荡（ADX ${adxNow.toFixed(0)} < ${RANGE_ADX_MAX}、MA60 走平），股价升至区间 ${(rangePos * 100).toFixed(0)}% 上沿且当根滞涨/收阴（浮盈 +${((gainFromAvg - 1) * 100).toFixed(0)}%），均值回归高抛清仓，避免在箱体里坐电梯回吐。`;
            } else {
              reason = `【结构+时间止损·v7】买入后持仓 ${barsHeld} 根 K 仍未站稳成本 +${((TRAIL_ACTIVATE - 1) * 100).toFixed(0)}%（跟踪止损未激活）且收盘跌破 MA20（${ma20.toFixed(2)}元），判定突破失败，砍掉死钱避免来回磨损。`;
            }
            sellFrac(1, close, date, reason);
          } else if (!earlyScaled && gainFromAvg >= EARLY_SCALE_GAIN) {
            earlyScaled = true;
            const reason = `【前移止盈·v7】浮盈达 +${((gainFromAvg - 1) * 100).toFixed(0)}%（加权成本 ${avgCost.toFixed(2)} 元），先减约 ${(EARLY_SCALE_FRAC * 100).toFixed(0)}% 落袋——箱体反弹到中上沿也能兑现一档，剩余仓位继续按阶梯 / 跟踪管理。`;
            sellFrac(EARLY_SCALE_FRAC, close, date, reason);
          } else if (!hasScaledOut && gainFromAvg >= SCALE_OUT_GAIN) {
            hasScaledOut = true;
            const reason = `【分批止盈·v7】浮盈达 +${((gainFromAvg - 1) * 100).toFixed(0)}%（加权成本 ${avgCost.toFixed(2)} 元），再止盈约 ${(SCALE_OUT_FRAC * 100).toFixed(0)}% 落袋锁利，剩余底仓改挂更宽的 ${ATR_MULT_RUNNER.toFixed(1)}×ATR 跟踪止损继续奔跑，吃趋势尾段。`;
            sellFrac(SCALE_OUT_FRAC, close, date, reason);
          }
        }
      }
    }

    const currentWorth = cash + shares * close;
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
      stockWorth: Number(stockWorth.toFixed(0)),
    });
  }

  const lastPrice = prices[prices.length - 1];
  const finalWorth = cash + shares * lastPrice;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((lastPrice - initialStockWorth) / initialStockWorth) * 100;
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

export interface ChokepointV8Options extends ChokepointV7Options {
  /** ADX 计算周期（默认 14）。 */
  adxPeriod?: number;
  /** 判定箱体震荡的 ADX 上限（默认 22，ADX 低于此且 MA60 走平即视为箱体）。 */
  rangeAdxMax?: number;
  /** 箱体高抛触发的区间位置下限（默认 0.82，价升至区间上沿才高抛）。 */
  rangeExitPos?: number;
  /** 前移止盈触发倍数（默认 1.08，即浮盈 +8% 先减一档）。 */
  earlyScaleGain?: number;
  /** 前移止盈卖出占当前持仓比例（默认 0.34，约 1/3）。 */
  earlyScaleFrac?: number;
  /** 结构+时间止损：跟踪止损未激活且持仓超过该根数后跌破 MA20 即清仓（默认 15）。 */
  structStopBars?: number;
  /** 新高阶梯减仓激活的浮盈门槛（默认 1.15，即峰值≥成本×1.15 后才启动「观察期后逢新高减仓」，对应最优停止的观察阶段）。 */
  newHighActivateGain?: number;
  /** 新高阶梯步长（默认 0.10，即较上一档减仓价再创 +10% 新高才减下一档）。 */
  newHighStep?: number;
  /** 每个新高档减仓占当前持仓比例（默认 0.2，约 1/5）。 */
  newHighFrac?: number;
}

/**
 * 运行 Serenity 瓶颈动量突破量化策略回测 v8（regime 自适应出场 + 新高阶梯减仓）。
 *
 * v8 在 v7 之上，用「最优停止 / 秘书问题」思路重做主出场：放弃 v7 固定 +25% 目标位的「猜顶」分批止盈，
 * 改为「先用观察期建立基准高（峰值 ≥ 成本 +15%），之后价格每创约 +10% 新高就减约 1/5 仓位」——
 * 不预测最高点，逐级把升势利润落袋，剩余底仓仍随 6×ATR 宽跟踪奔跑、回撤触线再清。
 * 其余（七类买点 + MA60 闸门、箱体高抛、+8% 前移止盈、结构+时间止损、筹码支撑 / 天量滞涨）与 v7 一致。
 *
 * v7 的入场「信号」与 v4/v5/v6 完全一致（七类买点 + MA60 中期趋势闸门），保证与历史版本可对照；
 * 升级集中在「出场」，针对 v6 在箱体震荡票上「只买不卖、坐电梯回吐」的痛点：
 *   1. regime 判定：用 ADX(14) + MA60 斜率判断当前是「趋势」还是「箱体」。
 *   2. 箱体高抛（核心修复）：确认箱体（ADX < 22 且 MA60 走平）时，价格升至区间上沿（rangePos ≥ 0.82）
 *      且当根滞涨/收阴即均值回归清仓——让策略在箱体里终于有卖点，而非干等不触发的趋势止盈。
 *   3. 前移止盈阶梯：浮盈 +8% 先减约 1/3 落袋（箱体反弹也能兑现），保留 v6 的 +25% 再减 + 6×ATR runner。
 *   4. 结构+时间止损：买入后迟迟未站上成本 +6%（跟踪止损未激活）、持仓超 15 根又跌破 MA20，判定突破失败，
 *      砍掉死钱避免在死区来回磨损。
 * 趋势行情下 ADX 走高 → 不判为箱体，箱体高抛不触发，仍由 v6 的分批止盈 + 宽 runner 吃趋势尾段，
 * 因此 v7 是「趋势照旧奔跑、箱体主动高抛」的自适应版。其余风控（筹码支撑止损、天量滞涨）与 v6 一致。
 */
export function runChokepointMomentumBacktestV8(
  candles: Candle[],
  chokepointScore: number,
  opts: ChokepointV8Options = {},
): BacktestResult {
  const ATR_PERIOD = opts.atrPeriod ?? 14;
  const INITIAL_FRAC = opts.initialFrac ?? 1.0;
  const ADD_FRAC = opts.addFrac ?? 0.25;
  const MAX_ADDS = opts.maxAdds ?? 0;
  const ADD_ATR_MULT = opts.addAtrMult ?? 1.0;
  // v8 放弃 v6/v7 固定 +25% 目标位分批止盈，改用高水位新高阶梯减仓（见 NH_* 常量），故此处不再读取 scaleOut*。
  const TRAIL_ACTIVATE = opts.trailActivate ?? 1.06;
  const ATR_MULT_BASE = opts.atrMultBase ?? 5.0;
  const ATR_MULT_RUNNER = opts.atrMultRunner ?? 6.0;
  const TRAIL_FLOOR = opts.trailFloorPct ?? 0.07;
  const TRAIL_CEIL = opts.trailCeilPct ?? 0.3;
  const MA60_FILTER = opts.ma60Filter ?? true;
  const ADX_PERIOD = opts.adxPeriod ?? 14;
  const RANGE_ADX_MAX = opts.rangeAdxMax ?? 22;
  const RANGE_EXIT_POS = opts.rangeExitPos ?? 0.82;
  const EARLY_SCALE_GAIN = opts.earlyScaleGain ?? 1.08;
  const EARLY_SCALE_FRAC = opts.earlyScaleFrac ?? 0.34;
  const STRUCT_STOP_BARS = opts.structStopBars ?? 15;
  const NH_ACTIVATE_GAIN = opts.newHighActivateGain ?? 1.15;
  const NH_STEP = opts.newHighStep ?? 0.10;
  const NH_FRAC = opts.newHighFrac ?? 0.2;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 25) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const atr = atrWilder(candles, ATR_PERIOD);
  const adx = adxWilder(candles, ADX_PERIOD);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const ma5List = prices.map((_, i) => ma(prices, i, 5));
  const ma10List = prices.map((_, i) => ma(prices, i, 10));
  const ma20List = prices.map((_, i) => ma(prices, i, 20));
  const ma60List = prices.map((_, i) => ma(prices, i, 60));

  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
  const volMa5 = volProxy.map((_, i) => ma(volProxy, i, 5));
  const volMa20 = volProxy.map((_, i) => ma(volProxy, i, 20));

  const bodyOf = (k: Candle) => Math.abs(k.close - k.open);
  const isBullEngulf = (i: number): boolean => {
    if (i < 1) return false;
    const a = candles[i - 1], b = candles[i];
    const aYin = a.close < a.open;
    const bYang = b.close > b.open;
    return aYin && bYang && b.close >= a.open && b.open <= a.close && bodyOf(b) > bodyOf(a) * 0.8;
  };
  const isHammer = (i: number): boolean => {
    const k = candles[i];
    const range = k.high - k.low;
    if (range <= 0) return false;
    const body = bodyOf(k);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    return lowerShadow >= body * 2 && upperShadow <= body && k.close >= k.open;
  };

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let avgCost = 0;
  let peakClose = 0;
  let deployedFrac = 0;
  let addsDone = 0;
  let lastBuyPrice = 0;
  let hasScaledOut = false;
  let earlyScaled = false;
  let lastLadderPrice = 0;
  let entryIndex = -1;
  let posDeployedCash = 0;
  let posProceedsCash = 0;
  let winCount = 0;
  let tradeCount = 0;

  const initialStockWorth = prices[20];

  const buyFrac = (f: number, px: number, date: string, reason: string): void => {
    const room = Math.max(0, 1 - deployedFrac);
    const useFrac = Math.min(f, room);
    if (useFrac <= 1e-9) return;
    const spend = Math.min(cash, useFrac * 100000);
    if (spend <= 0) return;
    const sharesBought = buyShares(spend, px, DEFAULT_COST_MODEL);
    const newShares = shares + sharesBought;
    avgCost = newShares > 0 ? (avgCost * shares + px * sharesBought) / newShares : px;
    shares = newShares;
    cash -= spend;
    deployedFrac += useFrac;
    posDeployedCash += spend;
    lastBuyPrice = px;
    trades.push({ type: "buy", date, price: px, reason, sizePct: Number(useFrac.toFixed(4)) });
  };

  const sellFrac = (sf: number, px: number, date: string, reason: string): void => {
    const sharesSold = sf >= 1 ? shares : shares * sf;
    if (sharesSold <= 1e-12) return;
    const proceeds = sellProceeds(sharesSold, px, DEFAULT_COST_MODEL);
    cash += proceeds;
    shares -= sharesSold;
    posProceedsCash += proceeds;
    trades.push({
      type: "sell",
      date,
      price: px,
      reason,
      profitPct: avgCost > 0 ? ((px - avgCost) / avgCost) * 100 : 0,
      sizePct: sf >= 1 ? 1 : Number(sf.toFixed(4)),
    });
    if (shares <= 1e-6) {
      tradeCount++;
      if (posProceedsCash > posDeployedCash) winCount++;
      shares = 0;
      holding = false;
      deployedFrac = 0;
      addsDone = 0;
      hasScaledOut = false;
      earlyScaled = false;
      lastLadderPrice = 0;
      entryIndex = -1;
      avgCost = 0;
      peakClose = 0;
      lastBuyPrice = 0;
      posDeployedCash = 0;
      posProceedsCash = 0;
    }
  };

  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;
    const ma20 = ma20List[i];
    const t5 = volMa5[i];
    const t20 = volMa20[i];

    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chipDist = calculateChipDistribution(subHistory, close, true);
    const supportPrice = chipDist.priceLow70;
    const avgCostChip = chipDist.avgCost;

    const prevWindow = prices.slice(Math.max(0, i - 120), i + 1);
    const minWin = Math.min(...prevWindow);
    const maxWin = Math.max(...prevWindow);
    const rangePos = maxWin > minWin ? (close - minWin) / (maxWin - minWin) : 0.5;

    const recentWindow = prices.slice(Math.max(0, i - 10), i);
    const isPlateauConsolidation =
      recentWindow.length >= 5 &&
      (Math.max(...recentWindow) - Math.min(...recentWindow)) / Math.min(...recentWindow) < 0.08;

    const dayRet = prices[i - 1] > 0 ? ((close - prices[i - 1]) / prices[i - 1]) * 100 : 0;

    if (!holding) {
      const ma60 = ma60List[i];
      const ma60Ref = ma60List[Math.max(0, i - 10)];
      const ma60NotFalling = ma60 >= ma60Ref;
      const aboveMa60 = close > ma60;
      const regimeOkRight = !MA60_FILTER || aboveMa60 || ma60NotFalling;

      const isBreakoutGoldCross =
        regimeOkRight && close > ma20 && prices[i - 1] <= ma20List[i - 1] && t5 > t20 * 1.3;
      const isVcpBreakout =
        regimeOkRight && close > ma20 && isPlateauConsolidation && close > Math.max(...recentWindow) && t5 > t20 * 1.3;
      const isStrongHighBreakout =
        regimeOkRight && chokepointScore >= 75 && rangePos >= 0.6 && t5 > t20 * 1.6 && close > Math.max(...recentWindow);
      const ma20Rising = i >= 25 && ma20List[i] > ma20List[i - 5];
      const recentLows = candles.slice(Math.max(0, i - 5), i + 1).map((x) => x.low);
      const pulledBackToMa = recentLows.length > 0 && Math.min(...recentLows) <= ma20 * 1.03;
      const isTrendResume =
        regimeOkRight && close > ma20 && ma20Rising && pulledBackToMa && close > prices[i - 1] && t5 > t20 * 1.1;

      const volSpike = volProxy[i] >= volProxy[i - 1] * 1.8 && volProxy[i] >= volMa5[i] * 1.5;
      const lowZone = rangePos <= 0.45;
      const bigYang = close > c.open && dayRet >= 5;
      const closeUpperHalf = c.high > c.low ? close - c.low >= 0.5 * (c.high - c.low) : true;
      const priorBody5 = Math.max(...prices.slice(Math.max(0, i - 5), i));
      const reclaim = close > ma20 || close > priorBody5;
      const bullPattern = bigYang || isBullEngulf(i) || (isHammer(i) && close > c.open);
      const isVolThrustBottom = lowZone && volSpike && closeUpperHalf && reclaim && bullPattern;

      let isDoubleBottomBreak = false;
      if (i >= 46 && rangePos <= 0.6 && close > c.open && volProxy[i] > volMa20[i]) {
        const lookback = candles.slice(i - 45, i);
        const lows = lookback.map((x) => x.low);
        const recentSeg = lookback.slice(-20);
        const recentLow = Math.min(...recentSeg.map((x) => x.low));
        const recentLowAbs = lows.length - 20 + recentSeg.map((x) => x.low).indexOf(recentLow);
        if (recentLowAbs >= 6) {
          const priorSeg = lookback.slice(0, recentLowAbs - 4);
          const priorLow = Math.min(...priorSeg.map((x) => x.low));
          const priorLowAbs = priorSeg.map((x) => x.low).indexOf(priorLow);
          const similar = priorLow > 0 && Math.abs(recentLow - priorLow) / priorLow <= 0.06;
          const between = lookback.slice(priorLowAbs + 1, recentLowAbs);
          const neckline = between.length > 0 ? Math.max(...between.map((x) => x.close)) : Infinity;
          if (similar && close > neckline && Number.isFinite(neckline)) isDoubleBottomBreak = true;
        }
      }

      let isOldDuckHead = false;
      if (i >= 60) {
        const ma5 = ma5List[i], ma10 = ma10List[i], ma60v = ma60List[i];
        const upTrend = ma60v > ma60List[i - 5] && close > ma60v;
        const crossUpToday = ma5 > ma10 && ma5List[i - 1] <= ma10List[i - 1];
        let hadBillPullback = false;
        for (let j = i - 25; j < i; j++) {
          if (j < 1) continue;
          const crossedBefore = ma5List[j] > ma10List[j] && ma5List[j - 1] <= ma10List[j - 1];
          if (crossedBefore) {
            for (let k = j + 1; k < i; k++) {
              if (ma5List[k] <= ma10List[k] * 1.01) { hadBillPullback = true; break; }
            }
          }
          if (hadBillPullback) break;
        }
        const volOk = volProxy[i] > volMa5[i] * 1.1;
        if (upTrend && crossUpToday && hadBillPullback && volOk) isOldDuckHead = true;
      }

      if (
        isBreakoutGoldCross ||
        isVcpBreakout ||
        isStrongHighBreakout ||
        isTrendResume ||
        isVolThrustBottom ||
        isDoubleBottomBreak ||
        isOldDuckHead
      ) {
        holding = true;
        peakClose = close;
        entryIndex = i;
        earlyScaled = false;
        lastLadderPrice = 0;
        const atrPct = close > 0 ? (atr[i] / close) * 100 : 0;
        const cautionTag =
          chokepointScore < 55 ? "【评分偏低警示】该股基本面综合打分偏低，此处突破交易建议控制仓位偏轻。 " : "";
        const pyramidOn = MAX_ADDS > 0 && INITIAL_FRAC < 1;
        const initTag = pyramidOn
          ? `（v8 分批建仓：先建底仓 ${(INITIAL_FRAC * 100).toFixed(0)}%，趋势确认再金字塔加仓；入场 ATR ${atrPct.toFixed(1)}%）`
          : `（v8 整仓建仓，浮盈 +${((EARLY_SCALE_GAIN - 1) * 100).toFixed(0)}% 先减 ${(EARLY_SCALE_FRAC * 100).toFixed(0)}%；峰值站上 +${((NH_ACTIVATE_GAIN - 1) * 100).toFixed(0)}% 后每创 +${(NH_STEP * 100).toFixed(0)}% 新高减约 ${(NH_FRAC * 100).toFixed(0)}%（高水位阶梯·不猜顶）；底仓挂 ${ATR_MULT_RUNNER.toFixed(1)}×ATR 宽止损奔跑；箱体高抛、突破失败结构止损；入场 ATR ${atrPct.toFixed(1)}%）`;
        let signal = "";
        if (isVolThrustBottom) {
          signal = `【放量反包·底部启动·v8】相对低位（区位 ${(rangePos * 100).toFixed(0)}%）今日单日爆量（量能 ${(volProxy[i] / volProxy[i - 1]).toFixed(1)} 倍于昨日）放量长阳收复 MA20/反包前高，呈底部反转启动。`;
        } else if (isDoubleBottomBreak) {
          signal = `【W底/双底突破·v8】近 45 日构筑双底（两低点高度相近），今日带量收阳向上突破颈线，底部形态确认。`;
        } else if (isOldDuckHead) {
          signal = `【老鸭头·二次金叉·v8】MA60 趋势向上，MA5 回踩贴近 MA10（鸭嘴缩量）后今日重新放量金叉，主升浪二次启动。`;
        } else if (isStrongHighBreakout) {
          signal = `【Serenity 强成长突破·v8】基本面得分 ${chokepointScore} 分，MA60 趋势在位，股价在 ${(rangePos * 100).toFixed(0)}% 区位放量长阳突破前高（量能比 ${(t5 / t20).toFixed(1)}倍），主升浪开启。`;
        } else if (isVcpBreakout) {
          signal = `【VCP箱体整理突破·v8】MA60 趋势在位，股价在 20日线之上窄幅收缩盘整后，今日放量突破整理平台上轨，二次动量加速起飞。`;
        } else if (isTrendResume) {
          signal = `【趋势回踩再起·v8】MA60 趋势在位，上升趋势中股价回踩 20 日均线附近后重新放量走强（量能比 ${(t5 / t20).toFixed(1)}倍），顺势再入场。`;
        } else {
          signal = `【均线筹码共振突破·v8】MA60 趋势在位，股价突破 20 日均线，且价格处于主力平均成本线（${avgCostChip.toFixed(2)}元）附近，5日均换手放大至 ${(t5 / t20).toFixed(1)} 倍。`;
        }
        buyFrac(INITIAL_FRAC, close, date, `${cautionTag}${signal}${initTag}`);
      }
    } else {
      peakClose = Math.max(peakClose, close);

      // 1) 金字塔加仓（逐步买入）：趋势确认 + 创新高 + 较上次买入价再上涨足够幅度。
      if (deployedFrac < 1 - 1e-9 && addsDone < MAX_ADDS) {
        const ma60 = ma60List[i];
        const ma60Ref = ma60List[Math.max(0, i - 10)];
        const ma60NotFalling = ma60 >= ma60Ref;
        const atrPctNow = close > 0 ? atr[i] / close : 0;
        const gapNeeded = Math.max(0.05, ADD_ATR_MULT * atrPctNow);
        const trendIntact = close > ma20 && ma60NotFalling;
        const brokeHigher = lastBuyPrice > 0 && close >= lastBuyPrice * (1 + gapNeeded) && close >= peakClose;
        if (trendIntact && brokeHigher) {
          addsDone++;
          const addReason = `【金字塔加仓·v8】趋势确认（价在 MA20 上、MA60 不下行），较上次买入价 ${lastBuyPrice.toFixed(2)} 元上涨超 ${(gapNeeded * 100).toFixed(1)}%（现价 ${close.toFixed(2)}），第 ${addsDone} 次顺势加仓 ${(ADD_FRAC * 100).toFixed(0)}%，仓位向满仓推进、让趋势带动盈利。`;
          buyFrac(ADD_FRAC, close, date, addReason);
        }
      }

      // 2) 分批止盈 / 风控出局（买卖不同一根 K 触发：若本根已加仓则跳过卖出判断）。
      if (holding) {
        const justAdded = trades.length > 0 && trades[trades.length - 1].type === "buy" && trades[trades.length - 1].date === date;
        if (!justAdded) {
          const isSupportBroken = close < supportPrice * 0.95;
          const gainFromAvg = avgCost > 0 ? close / avgCost : 1;
          const isClimaxRun = rangePos > 0.95 && c.turnoverPct && c.turnoverPct > 15;

          // regime 判定：ADX 低 + MA60 走平 → 箱体震荡；否则视为趋势行情
          const adxNow = adx[i];
          const ma60Now = ma60List[i];
          const ma60Slope10 = ma60Now - ma60List[Math.max(0, i - 10)];
          const ma60Flat = Math.abs(ma60Slope10) / Math.max(close, 1e-9) < 0.03;
          const isRanging = adxNow < RANGE_ADX_MAX && ma60Flat;

          // 跟踪止损（与 v6 同口径：分批止盈后底仓 runner 用更宽倍数）
          const atrMult = hasScaledOut ? ATR_MULT_RUNNER : ATR_MULT_BASE;
          const trailPct = Math.min(TRAIL_CEIL, Math.max(TRAIL_FLOOR, (atrMult * atr[i]) / Math.max(close, 1e-9)));
          const trailingActive = peakClose >= avgCost * TRAIL_ACTIVATE;
          const isAtrStop = trailingActive && close <= peakClose * (1 - trailPct);

          // 箱体高抛（v7 核心修复）：确认箱体 + 价到区间上沿 + 当根滞涨/收阴 → 均值回归清仓
          const stalling = close < c.open || close < prices[i - 1];
          const isRangeTopExit = isRanging && rangePos >= RANGE_EXIT_POS && stalling && gainFromAvg > 1.0;

          // 结构 + 时间止损（v7）：买入后迟迟未站上成本 +6%（跟踪未激活）、持仓超 N 根又跌破 MA20 → 砍掉死钱
          const barsHeld = entryIndex >= 0 ? i - entryIndex : 0;
          const isStructStop = !trailingActive && barsHeld >= STRUCT_STOP_BARS && close < ma20;

          if (isSupportBroken || isClimaxRun || isAtrStop || isRangeTopExit || isStructStop) {
            // 全部清仓：风控止损 / 跟踪止盈 / 箱体高抛 / 结构止损（优先级高于分批止盈）
            let reason = "";
            if (isSupportBroken) {
              reason = `【主力防线失守止损·v8】日线收盘价 ${close.toFixed(2)} 元跌破主力 70% 筹码密集支撑区下轨（${supportPrice.toFixed(2)}元）的 5% 以上，清掉全部仓位中期洗盘出局。`;
            } else if (isClimaxRun) {
              reason = `【高位超买天量滞涨·v8】120日价格区间位置高达 ${(rangePos * 100).toFixed(0)}%，日换手率高达 ${c.turnoverPct!.toFixed(1)}% 创天量，高位筹码剧烈松动，清仓离场。`;
            } else if (isAtrStop) {
              const runnerTag = hasScaledOut ? "（已分批止盈、底仓 runner 宽止损）" : "";
              reason = `【ATR 自适应跟踪止盈·v8】持仓峰值 ${peakClose.toFixed(2)} 元后回撤超 ${(trailPct * 100).toFixed(0)}%（随 ${atrMult.toFixed(1)}×ATR 自适应，现价 ${close.toFixed(2)}）${runnerTag}，清掉剩余仓位锁定波段利润。`;
            } else if (isRangeTopExit) {
              reason = `【箱体高抛·v8】判定为箱体震荡（ADX ${adxNow.toFixed(0)} < ${RANGE_ADX_MAX}、MA60 走平），股价升至区间 ${(rangePos * 100).toFixed(0)}% 上沿且当根滞涨/收阴（浮盈 +${((gainFromAvg - 1) * 100).toFixed(0)}%），均值回归高抛清仓，避免在箱体里坐电梯回吐。`;
            } else {
              reason = `【结构+时间止损·v8】买入后持仓 ${barsHeld} 根 K 仍未站稳成本 +${((TRAIL_ACTIVATE - 1) * 100).toFixed(0)}%（跟踪止损未激活）且收盘跌破 MA20（${ma20.toFixed(2)}元），判定突破失败，砍掉死钱避免来回磨损。`;
            }
            sellFrac(1, close, date, reason);
          } else if (!earlyScaled && gainFromAvg >= EARLY_SCALE_GAIN) {
            earlyScaled = true;
            const reason = `【前移止盈·v8】浮盈达 +${((gainFromAvg - 1) * 100).toFixed(0)}%（加权成本 ${avgCost.toFixed(2)} 元），先减约 ${(EARLY_SCALE_FRAC * 100).toFixed(0)}% 落袋——箱体反弹到中上沿也能兑现一档，剩余仓位继续按阶梯 / 跟踪管理。`;
            sellFrac(EARLY_SCALE_FRAC, close, date, reason);
          } else if (
            peakClose >= avgCost * NH_ACTIVATE_GAIN &&
            close >= peakClose &&
            close >= (lastLadderPrice > 0 ? lastLadderPrice * (1 + NH_STEP) : avgCost * NH_ACTIVATE_GAIN) &&
            shares > 1e-6
          ) {
            // 新高阶梯减仓（v8 核心，最优停止 / 秘书问题思路）：不预测顶部，价格每创一档新高就逐级减仓落袋。
            if (!hasScaledOut) hasScaledOut = true; // 首次阶梯减仓后底仓改挂更宽 runner
            lastLadderPrice = close;
            const reason = `【新高阶梯减仓·v8】最优停止/秘书问题思路：不预测最高点，峰值 ${peakClose.toFixed(2)} 元每创约 +${(NH_STEP * 100).toFixed(0)}% 新高（现价 ${close.toFixed(2)}、浮盈 +${((gainFromAvg - 1) * 100).toFixed(0)}%）即减约 ${(NH_FRAC * 100).toFixed(0)}% 落袋，逐级兑现升势利润；剩余底仓继续随 ${ATR_MULT_RUNNER.toFixed(1)}×ATR 跟踪奔跑，回撤触线再清。`;
            sellFrac(NH_FRAC, close, date, reason);
          }
        }
      }
    }

    const currentWorth = cash + shares * close;
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
      stockWorth: Number(stockWorth.toFixed(0)),
    });
  }

  const lastPrice = prices[prices.length - 1];
  const finalWorth = cash + shares * lastPrice;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((lastPrice - initialStockWorth) / initialStockWorth) * 100;
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

/** 网格/均值回归（regime 门控）可调参数。 */
export interface GridMeanReversionOptions {
  code?: string;
  /** 布林带周期（默认 20）。 */
  bbPeriod?: number;
  /** 布林带宽度倍数（默认 2.0，即 MA ± 2σ 为上下沿）。 */
  bbK?: number;
  /** MA60 近 20 日斜率绝对值上限（默认 0.05，越小越"走平"才算箱体）。 */
  flatSlopeMax?: number;
  /** 破箱止损：收盘价跌破下沿的比例（默认 0.03，即跌破下沿 3% 强制出局）。 */
  breakMargin?: number;
  /** ADX 趋势强度上限（默认 25）：仅当 ADX < 该值（无明显趋势/箱体震荡）才允许开仓。 */
  adxMax?: number;
}

/**
 * regime 门控的网格 / 均值回归策略（震荡区专用模块）。
 *
 * 设计哲学（与 Serenity 动量内核互补、而非替代）：网格/均值回归只在**确认的箱体震荡**里有效，
 * 在单边趋势里会"卖飞 + 越补越套"。故本策略用 regime 闸门把它**严格限制在箱体区**，并强制带**破箱止损**：
 *   - **regime 闸门（箱体确认）**：MA60 近 20 日走平（|斜率| < flatSlopeMax）+ 布林带宽适中（非极度收缩/扩张）
 *     + 近 40 日价格被上下沿包住 → 判定为箱体震荡，才允许开仓；
 *   - **低买**：箱体内价格触及/跌破布林下沿且当日企稳（收盘 ≥ 昨收）→ 低吸买入；
 *   - **高卖（网格止盈）**：价格回升到布林上沿 → 高抛止盈（吃一格箱体波段）；
 *   - **破箱止损**：收盘跌破开仓时下沿的 breakMargin 以上 → 趋势向下突破，立即止损（避免马丁格尔式套牢）；
 *   - **趋势离场**：箱体被向上突破（站上上沿且 MA60 转为上行）→ 交回趋势策略，平仓离场。
 * 单仓位、无未来函数；与「建议忠实回测」的涨跌停撮合 + 手续费兼容。
 */
export function runGridMeanReversionBacktest(
  candles: Candle[],
  opts: GridMeanReversionOptions = {},
): BacktestResult {
  const BB_PERIOD = opts.bbPeriod ?? 20;
  const BB_K = opts.bbK ?? 2.0;
  const FLAT_SLOPE_MAX = opts.flatSlopeMax ?? 0.05;
  const BREAK_MARGIN = opts.breakMargin ?? 0.03;
  const ADX_MAX = opts.adxMax ?? 25;

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];

  if (candles.length < 65) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }

  const prices = candles.map((c) => c.close);
  const ma = (arr: number[], idx: number, w: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = arr.slice(start, idx + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  };
  const stdAt = (idx: number, w: number, mean: number): number => {
    const start = Math.max(0, idx - w + 1);
    const slice = prices.slice(start, idx + 1);
    const v = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length;
    return Math.sqrt(v);
  };
  const ma60List = prices.map((_, i) => ma(prices, i, 60));
  const adxList = adxWilder(candles, 14);

  let cash = 100000;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;
  let entryLower = 0;
  let winCount = 0;
  let tradeCount = 0;

  const START = 60;
  const initialStockWorth = prices[START];

  for (let i = START; i < candles.length; i++) {
    const c = candles[i];
    const close = c.close;
    const date = c.date;

    const mid = ma(prices, i, BB_PERIOD);
    const sd = stdAt(i, BB_PERIOD, mid);
    const upper = mid + BB_K * sd;
    const lower = mid - BB_K * sd;
    const bandwidth = mid > 0 ? (upper - lower) / mid : 0;

    const ma60 = ma60List[i];
    const ma60Ref = ma60List[Math.max(0, i - 20)];
    const ma60Slope = ma60Ref > 0 ? (ma60 - ma60Ref) / ma60Ref : 0;
    const win40 = prices.slice(Math.max(0, i - 40), i + 1);
    const lo40 = Math.min(...win40);
    const hi40 = Math.max(...win40);
    const contained = lo40 > 0 && (hi40 - lo40) / lo40 < 0.35;
    const lowAdx = adxList[i] < ADX_MAX;
    const isBoxRegime =
      Math.abs(ma60Slope) < FLAT_SLOPE_MAX && bandwidth >= 0.04 && bandwidth <= 0.3 && contained && lowAdx;

    if (!holding) {
      const touchLower = close <= lower * 1.01;
      const stabilized = close >= prices[i - 1];
      if (isBoxRegime && touchLower && stabilized) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        buyPrice = close;
        entryLower = lower;
        trades.push({
          type: "buy",
          date,
          price: close,
          reason: `【箱体低吸·网格均值回归】MA60 近 20 日走平（斜率 ${(ma60Slope * 100).toFixed(1)}%）+ ADX ${adxList[i].toFixed(0)}<${ADX_MAX}（无明显趋势）判定为箱体震荡，价格触及布林下沿（${lower.toFixed(2)} 元）后当日企稳，低吸博弈回归中轨/上沿。破箱止损位 ${(entryLower * (1 - BREAK_MARGIN)).toFixed(2)} 元。`,
        });
      }
    } else {
      const breakBox = close < entryLower * (1 - BREAK_MARGIN);
      const reachUpper = close >= upper;
      const trendBreakout = close > upper && ma60Slope > FLAT_SLOPE_MAX;
      if (breakBox || reachUpper || trendBreakout) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        if (close - buyPrice > 0) winCount++;
        let reason = "";
        if (breakBox) {
          reason = `【破箱止损·网格均值回归】收盘价 ${close.toFixed(2)} 元跌破开仓箱体下沿（${entryLower.toFixed(2)} 元）的 ${(BREAK_MARGIN * 100).toFixed(0)}% 以上，箱体被向下突破，立即止损离场（不补仓、不马丁格尔）。`;
        } else if (trendBreakout) {
          reason = `【趋势突破离场·网格均值回归】价格站上布林上沿且 MA60 转为上行（斜率 ${(ma60Slope * 100).toFixed(1)}%），箱体被向上突破，均值回归失效，交回趋势策略并平仓。`;
        } else {
          reason = `【箱体高抛止盈·网格均值回归】价格回升至布林上沿（${upper.toFixed(2)} 元），吃满一格箱体波段，高抛止盈。`;
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
    const stockWorth = (close / initialStockWorth) * 100000;
    history.push({
      date,
      strategyWorth: Number(currentWorth.toFixed(0)),
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
