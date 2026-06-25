import type { Candle } from "./types";
import { getKlinesBatch, HISTORY_LIMIT } from "./sources";
import { calculateChipDistribution } from "./quant";
import { priceLimitFraction } from "./portfolioBacktest";
import { getStrategy, strategyCount, type Strategy } from "./strategies";
import {
  tradeRiskMetrics,
  meanCI,
  winRateCI,
  probabilisticSharpe,
  deflatedSharpe,
  bonferroniAlpha,
  volTargetedStats,
  type RiskMetrics,
  type VolTargetResult,
  type CI,
} from "./stats";

/**
 * 「建议忠实回测」框架。
 *
 * 目的：诚实回答「照策略建议的买卖点操作，历史上是否有较大胜率」。
 *
 * 关键点（直击此前回测的可信度短板）：
 * - **多股票池**：在一个代码池上逐只独立模拟单仓位交易，把所有完成交易**汇总**统计，
 *   而不是只看一只票的几笔——样本量足够才有统计意义。
 * - **无未来函数 / 样本外**：买卖信号在第 t 日只用 ≤t 的数据判定（均线突破/放量/筹码支撑），
 *   且策略**无逐股拟合参数**，故整段历史天然属样本外口径；不再像瓶颈点回测那样把
 *   「当前快照分数」一刀切回灌历史。
 * - **撮合真实性**：复用 A 股涨跌停约束（涨停买不进、跌停卖不出顺延）+ 双边手续费。
 * - **对比基准**：与「同持有期买入持有」（匹配 horizon 的随机入场基线）和「全程买入持有」
 *   对比，衡量择时是否真的带来超额。
 * - **显著性**：胜率对 50% 做单比例 z 检验，给出 z / 近似 p 值与诚实结论。
 *
 * 注意：信号是模型买卖建议（瓶颈点动量突破 + 筹码止损/止盈）的**确定性编码**，
 * 而非逐日重跑 LLM（历史财报快照成本过高）；它度量的是该建议规则的可执行命中率，
 * 是比 LLM 自报或样本内回测更接近真实成功率的代理。
 */

const LIMIT_SLACK = 0.003;
const FEE_DEFAULT_BPS = 30;

export interface RecommendationSeries {
  code: string;
  name: string;
  candles: Candle[]; // 日期升序
}

export interface RecommendationBacktestConfig {
  /** 单边手续费（基点 bps，1bp=0.01%），默认 30。 */
  feeBps?: number;
  /** 止盈目标涨幅，默认 0.35（+35%）。仅作用于内置「均线放量」简化口径（strategyId 为空时）。 */
  takeProfitPct?: number;
  /** 预热 K 线根数（仅用于指标、不计交易），默认 30。 */
  warmupBars?: number;
  /** 匹配基线的持有期（交易日），默认取策略平均持有期。 */
  matchedHorizon?: number;
  /**
   * 要忠实回测的已登记策略 id（如 chokepoint-momentum-v4 / v3 / v2 / v1 / traditional-ma）。
   * 留空（""）时退回内置「均线放量突破 + 固定止盈」简化口径（保留作历史对照）。
   * 指定策略时，按该策略在每只票上产生的买卖点，叠加涨跌停撮合与双边手续费成交，做多股票池显著性对照。
   */
  strategyId?: string;
  /**
   * 池内回测无逐股基本面分，故给策略一个中性的瓶颈点综合分（默认 60）。
   * 低于 75 时不会触发依赖高基本面分的「强势起爆」信号；这是诚实的保守口径。
   */
  poolChokepointScore?: number;
  /**
   * "试验次数"：用于 Deflated Sharpe 与 Bonferroni 多重检验校正。
   * 默认取已登记策略数量（因为项目本就提供这么多策略供 A/B 反复比较）。
   * 比较的策略越多，达到显著所需的门槛越高——这是抵御"撞出假显著"的关键。
   */
  numTrials?: number;
  /**
   * 波动率目标仓位的目标 ATR%（默认 3）。每笔按 1/ATR 反比调仓，使各笔风险近似相等；
   * 不改买卖点，仅度量"低波动多下、高波动少下"对风险调整后收益的改善。
   */
  volTargetPct?: number;
}

export interface ClosedTrade {
  code: string;
  name: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  /** 净收益率 %（含双边手续费）。 */
  returnPct: number;
  holdDays: number;
  exitReason: string;
  /** 入场时 ATR(14) 占价百分比（波动率目标仓位用）。 */
  atrPctAtEntry: number;
}

export interface SymbolTradeStats {
  code: string;
  name: string;
  trades: number;
  wins: number;
  winRatePct: number;
  avgReturnPct: number;
  buyHoldPct: number; // 该票测试窗口内全程买入持有收益 %
}

/** 单个时间折的统计（Purged + Embargo K-Fold 用）。 */
export interface CVFold {
  index: number;       // 1 起的折号（按时间从早到晚）
  startDate: string;
  endDate: string;
  trades: number;
  winRatePct: number;
  avgReturnPct: number;
}

/**
 * Purged + Embargo K-Fold 时间分折交叉验证（López de Prado）。
 *
 * 把所有完成交易按「买入日」切成 K 个连续时间折，逐折独立统计胜率/每笔均值，
 * 用「各折是否都站得住」回答稳健性——而非只看一次全样本汇总（易被某一段行情主导）。
 * - **Purge（净化）**：丢弃持仓窗口跨越折边界的交易（其收益在下一折才兑现，会造成标签泄漏）；
 * - **Embargo（隔离带）**：再丢弃每折起始 embargo 天内开仓的交易（与上一折尾部高度相关，避免序列相关泄漏）。
 */
export interface CrossValidation {
  folds: number;             // 请求的 K
  usedFolds: number;         // 净化/隔离后仍有交易的折数
  embargoDays: number;       // 隔离带天数
  purgedTrades: number;      // 被 purge+embargo 丢弃的交易数
  foldStats: CVFold[];
  meanWinRatePct: number;    // 各折胜率均值
  stdWinRatePct: number;     // 各折胜率标准差（离散度，越小越稳健）
  worstFoldWinRatePct: number;
  worstFoldAvgReturnPct: number;
  positiveFolds: number;     // 每笔均值 > 0 的折数
  /** 是否跨时间稳健：≥3 折有数据 且 正期望折占多数（≥60%）。 */
  holdsOutOfSample: boolean;
}

export interface RecommendationBacktestStats {
  symbols: number;
  totalTrades: number;
  wins: number;
  winRatePct: number;
  /** 每笔净收益均值（期望值，含手续费）。 */
  avgReturnPct: number;
  medianReturnPct: number;
  /** 盈亏比：总盈利 / |总亏损|。 */
  profitFactor: number;
  avgHoldDays: number;
  /** 匹配持有期的「随机入场买入持有」基线（同 horizon）。 */
  matchedHorizon: number;
  matchedBaselineWinRatePct: number;
  matchedBaselineAvgReturnPct: number;
  /** 全程买入持有（跨标的平均）。 */
  buyHoldAvgReturnPct: number;
  /** 择时超额：策略每笔均值 − 匹配基线均值。 */
  edgePct: number;
  /** 胜率对 50% 的单比例 z 值与近似双尾 p 值。 */
  zVsCoin: number;
  pVsCoin: number;
  /** 风险调整指标（Sharpe / Sortino / Calmar / 最大回撤 / CAGR，来自逐笔近似净值曲线）。 */
  risk: RiskMetrics;
  /** 估算的每年交易笔数（用于年化）。 */
  tradesPerYear: number;
  /** 每笔均值（%）的 bootstrap 95% 置信区间。 */
  avgReturnCI: CI;
  /** 胜率（%）的 bootstrap 95% 置信区间。 */
  winRateCI: CI;
  /** Probabilistic Sharpe Ratio：真实 Sharpe > 0 的概率。 */
  psr: number;
  /** Deflated Sharpe Ratio：在多重检验下真实 Sharpe 超过"运气门槛"的概率。 */
  dsr: number;
  /** DSR 用到的运气门槛 Sharpe。 */
  dsrExpectedMaxSharpe: number;
  /** 多重检验的试验次数。 */
  numTrials: number;
  /** Bonferroni 校正后的显著性阈值（alpha/试验次数）。 */
  bonferroniAlpha: number;
  /** 胜率在 Bonferroni 校正后是否仍显著。 */
  significantAfterCorrection: boolean;
  /** 入场时平均 ATR%（波动率水平参考）。 */
  avgAtrPctAtEntry: number;
  /** 波动率目标仓位（按 1/ATR 调仓）后的对照指标。 */
  volTargeted: VolTargetResult;
  /** Purged + Embargo K-Fold 时间分折交叉验证（样本外稳健性）。 */
  crossValidation: CrossValidation;
  verdict: string;
}

export interface RecommendationBacktestResult {
  config: Required<RecommendationBacktestConfig>;
  /** 实际使用的策略元信息（strategyId 命中时填充，便于前端展示「跑的是哪个策略」）。 */
  strategy?: { id: string; name: string; version: string };
  perSymbol: SymbolTradeStats[];
  trades: ClosedTrade[];
  stats: RecommendationBacktestStats;
}

// ── 统计工具 ────────────────────────────────────────────────────────────────
/** 标准正态 CDF（Abramowitz-Stegun 7.1.26 erf 近似）。 */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 + 0.5 * y : 0.5 - 0.5 * y;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** ATR(period) 序列（Wilder 真实波幅的简单滑动平均），未满窗口处用已有均值。 */
function atrSeries(candles: Candle[], period = 14): number[] {
  const N = candles.length;
  const tr: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const c = candles[i];
    if (i === 0) {
      tr[i] = c.high - c.low;
    } else {
      const prevClose = candles[i - 1].close;
      tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    }
  }
  const atr: number[] = new Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    sum += tr[i];
    if (i < period) {
      atr[i] = sum / (i + 1);
    } else {
      sum -= tr[i - period];
      atr[i] = sum / period;
    }
  }
  return atr;
}

/** 入场时 ATR% = ATR(14) / 价格 × 100。 */
function atrPctAt(atr: number[], prices: number[], i: number): number {
  if (i < 0 || i >= atr.length || prices[i] <= 0) return 0;
  return Number(((atr[i] / prices[i]) * 100).toFixed(3));
}

// ── 单只交易模拟（信号因果、含撮合约束）──────────────────────────────────────
function simulateSymbol(
  s: RecommendationSeries,
  cfg: Required<RecommendationBacktestConfig>,
): ClosedTrade[] {
  const candles = s.candles;
  const N = candles.length;
  if (N < cfg.warmupBars + 5) return [];
  const fee = cfg.feeBps / 10_000;
  const limitFrac = priceLimitFraction(s.code, s.name);
  const prices = candles.map((c) => c.close);
  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );

  const ma20: number[] = [];
  const vMa5: number[] = [];
  const vMa20: number[] = [];
  for (let i = 0; i < N; i++) {
    ma20.push(i < 19 ? prices[i] : prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20);
    vMa5.push(i < 4 ? volProxy[i] : volProxy.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5);
    vMa20.push(i < 19 ? volProxy[i] : volProxy.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20);
  }
  const atr = atrSeries(candles, 14);

  const dayReturn = (i: number): number | null => {
    if (i < 1 || prices[i - 1] <= 0) return null;
    return prices[i] / prices[i - 1] - 1;
  };
  const atLimitUp = (i: number) => {
    const r = dayReturn(i);
    return r !== null && r >= limitFrac - LIMIT_SLACK;
  };
  const atLimitDown = (i: number) => {
    const r = dayReturn(i);
    return r !== null && r <= -(limitFrac - LIMIT_SLACK);
  };

  const out: ClosedTrade[] = [];
  let holding = false;
  let buyPrice = 0;
  let buyDate = "";
  let buyIdx = 0;

  const startIdx = Math.max(20, cfg.warmupBars);
  for (let i = startIdx; i < N; i++) {
    const close = prices[i];
    const recent = prices.slice(Math.max(0, i - 10), i);
    const plateau =
      recent.length >= 5 && (Math.max(...recent) - Math.min(...recent)) / Math.min(...recent) < 0.08;
    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chip = calculateChipDistribution(subHistory, close, true);
    const support = chip.priceLow70;
    const win = prices.slice(Math.max(0, i - 120), i + 1);
    const lo = Math.min(...win);
    const hi = Math.max(...win);
    const rangePos = hi > lo ? (close - lo) / (hi - lo) : 0.5;

    if (!holding) {
      const goldCross = close > ma20[i] && prices[i - 1] <= ma20[i - 1] && vMa5[i] > vMa20[i] * 1.3;
      const vcp = close > ma20[i] && plateau && close > Math.max(...recent) && vMa5[i] > vMa20[i] * 1.3;
      if ((goldCross || vcp) && !atLimitUp(i)) {
        holding = true;
        buyPrice = close;
        buyDate = candles[i].date;
        buyIdx = i;
      }
    } else {
      const supportBroken = close < support * 0.95;
      const takeProfit = close >= buyPrice * (1 + cfg.takeProfitPct);
      const climax = rangePos > 0.95 && !!candles[i].turnoverPct && candles[i].turnoverPct > 15;
      const lastBar = i === N - 1;
      if ((supportBroken || takeProfit || climax || lastBar) && !atLimitDown(i)) {
        const net = (close * (1 - fee)) / (buyPrice * (1 + fee)) - 1;
        out.push({
          code: s.code,
          name: s.name,
          buyDate,
          sellDate: candles[i].date,
          buyPrice,
          sellPrice: close,
          returnPct: Number((net * 100).toFixed(2)),
          holdDays: i - buyIdx,
          exitReason: supportBroken ? "跌破筹码支撑止损" : takeProfit ? "达到止盈目标" : climax ? "高位天量滞涨" : "窗口末强制平仓",
          atrPctAtEntry: atrPctAt(atr, prices, buyIdx),
        });
        holding = false;
      }
    }
  }
  return out;
}

/** 从策略生成的卖出原因里提炼一个简短的离场标签（用于交易流水展示）。 */
function shortExitReason(reason: string): string {
  if (!reason) return "策略卖出";
  if (reason.includes("破箱")) return "破箱止损";
  if (reason.includes("趋势突破")) return "趋势突破离场";
  if (reason.includes("高抛")) return "网格高抛止盈";
  if (reason.includes("分批止盈")) return "分批止盈(留runner)";
  if (reason.includes("KAMA")) return "跌破 KAMA 离场";
  if (reason.includes("ATR") || reason.includes("自适应")) return "ATR自适应跟踪止盈";
  if (reason.includes("跟踪")) return "跟踪止盈";
  if (reason.includes("支撑") || reason.includes("止损")) return "跌破筹码支撑止损";
  if (reason.includes("天量") || reason.includes("滞涨")) return "高位天量滞涨";
  return "策略卖出";
}

/**
 * 按「已登记策略」在单只票上的买卖点，叠加涨跌停撮合 + 双边手续费，产出闭合交易。
 *
 * 做法：先用该策略的回测器在整段 K 线上跑出买卖点（与个股看盘页同一套规则，保证忠实），
 * 再在「建议忠实回测」的撮合层重放这些信号：
 *   - 买点当日若已涨停 → 按 A 股规则买不进，丢弃该笔（连同其配对卖点）；
 *   - 卖点当日若跌停 → 卖不出，顺延到下一可成交日；若直到末日仍跌停则按末日收盘强平；
 *   - 进出各计一次手续费。
 * 池内无逐股基本面分，给策略一个中性瓶颈点分（poolChokepointScore，默认 60）。
 */
function simulateSymbolViaStrategy(
  s: RecommendationSeries,
  cfg: Required<RecommendationBacktestConfig>,
  strategy: Strategy,
): ClosedTrade[] {
  const candles = s.candles;
  const N = candles.length;
  if (N < cfg.warmupBars + 5) return [];
  const fee = cfg.feeBps / 10_000;
  const limitFrac = priceLimitFraction(s.code, s.name);
  const prices = candles.map((c) => c.close);

  const dayReturn = (i: number): number | null => {
    if (i < 1 || prices[i - 1] <= 0) return null;
    return prices[i] / prices[i - 1] - 1;
  };
  const atLimitUp = (i: number) => {
    const r = dayReturn(i);
    return r !== null && r >= limitFrac - LIMIT_SLACK;
  };
  const atLimitDown = (i: number) => {
    const r = dayReturn(i);
    return r !== null && r <= -(limitFrac - LIMIT_SLACK);
  };

  const atr = atrSeries(candles, 14);
  const res = strategy.run(candles, { chokepointScore: cfg.poolChokepointScore, code: s.code });
  const idxByDate = new Map<string, number>();
  candles.forEach((c, i) => idxByDate.set(c.date, i));

  const out: ClosedTrade[] = [];
  // 分数仓位累加器：支持 v6 的分批建仓/分批止盈，同时对不带 sizePct 的 v1–v5（整仓买、全清卖）
  // 退化为与旧逻辑完全一致的单仓位行为。手续费按双边计入有效买/卖价，收益按「实际部署资金」口径
  // （和 v5 整仓单笔的净收益直接可比，不掺未部署现金的拖累）。
  type Pos = {
    firstIdx: number;
    firstDate: string;
    deployedFrac: number; // 已部署占满仓比例（封顶 1）
    deployedCash: number; // 含手续费的部署成本（单位：满仓资金的分数）
    shares: number;       // 持有份额（按含费有效买价折算）
    proceedsCash: number; // 已实现卖出净收入（含费）
    buyPxNum: number;     // 加权均价分子（按部署比例加权）
    buyFracSum: number;
    sellPxNum: number;    // 加权卖价分子（按卖出份额加权）
    sellSharesSum: number;
    lastSellIdx: number;
  };
  let pos: Pos | null = null;

  const closePosition = (exitReason: string) => {
    if (!pos) return;
    const ret = pos.deployedCash > 0 ? pos.proceedsCash / pos.deployedCash - 1 : 0;
    const avgBuyPx = pos.buyFracSum > 0 ? pos.buyPxNum / pos.buyFracSum : prices[pos.firstIdx];
    const avgSellPx = pos.sellSharesSum > 0 ? pos.sellPxNum / pos.sellSharesSum : prices[pos.lastSellIdx];
    out.push({
      code: s.code,
      name: s.name,
      buyDate: pos.firstDate,
      sellDate: candles[pos.lastSellIdx].date,
      buyPrice: Number(avgBuyPx.toFixed(4)),
      sellPrice: Number(avgSellPx.toFixed(4)),
      returnPct: Number((ret * 100).toFixed(2)),
      holdDays: pos.lastSellIdx - pos.firstIdx,
      exitReason,
      atrPctAtEntry: atrPctAt(atr, prices, pos.firstIdx),
    });
    pos = null;
  };

  for (const tr of res.trades) {
    const i = idxByDate.get(tr.date);
    if (i === undefined) continue;
    if (tr.type === "buy") {
      if (atLimitUp(i)) continue; // 涨停买不进，丢弃该（加）仓点
      const wantFrac = tr.sizePct === undefined ? 1 : Math.max(0, Math.min(1, tr.sizePct));
      const room = pos ? Math.max(0, 1 - pos.deployedFrac) : 1;
      const useFrac = Math.min(wantFrac, room);
      if (useFrac <= 1e-9) continue; // 已满仓或无效买点 → 忽略（v1–v5 整仓后多余买点在此被忽略）
      const effBuy = prices[i] * (1 + fee);
      if (effBuy <= 0) continue;
      const sharesBought = useFrac / effBuy;
      if (!pos) {
        pos = {
          firstIdx: i,
          firstDate: tr.date,
          deployedFrac: 0,
          deployedCash: 0,
          shares: 0,
          proceedsCash: 0,
          buyPxNum: 0,
          buyFracSum: 0,
          sellPxNum: 0,
          sellSharesSum: 0,
          lastSellIdx: i,
        };
      }
      pos.shares += sharesBought;
      pos.deployedFrac += useFrac;
      pos.deployedCash += useFrac;
      pos.buyPxNum += prices[i] * useFrac;
      pos.buyFracSum += useFrac;
    } else {
      if (!pos) continue;
      let j = i;
      while (j < N && atLimitDown(j)) j++; // 跌停卖不出，顺延到可成交日
      const sellFracOfHolding = tr.sizePct === undefined ? 1 : Math.max(0, Math.min(1, tr.sizePct));
      const sellingAll = sellFracOfHolding >= 1;
      if (j >= N) {
        // 直到末日仍无法卖出：整仓卖点 → 丢弃该仓位（与旧逻辑一致）；分批卖点 → 跳过本次、留待末日强平
        if (sellingAll) pos = null;
        continue;
      }
      const sharesSold = sellingAll ? pos.shares : pos.shares * sellFracOfHolding;
      if (sharesSold <= 1e-12) continue;
      const effSell = prices[j] * (1 - fee);
      pos.proceedsCash += sharesSold * effSell;
      pos.shares -= sharesSold;
      pos.sellPxNum += prices[j] * sharesSold;
      pos.sellSharesSum += sharesSold;
      pos.lastSellIdx = j;
      if (pos.shares <= 1e-9) closePosition(shortExitReason(tr.reason));
    }
  }
  // 窗口末仍持仓 → 按末日收盘强制平仓剩余份额（与内置口径一致）
  if (pos && pos.shares > 1e-9) {
    const effSell = prices[N - 1] * (1 - fee);
    pos.proceedsCash += pos.shares * effSell;
    pos.sellPxNum += prices[N - 1] * pos.shares;
    pos.sellSharesSum += pos.shares;
    pos.shares = 0;
    pos.lastSellIdx = N - 1;
    closePosition("窗口末强制平仓");
  }

  return out;
}

/** 匹配持有期的「随机入场买入持有」基线：在 warmup 后的每个交易日入场、持有 horizon 天。 */
function matchedBaseline(
  series: RecommendationSeries[],
  horizon: number,
  warmupBars: number,
): { winRatePct: number; avgReturnPct: number } {
  let wins = 0;
  let count = 0;
  let sum = 0;
  for (const s of series) {
    const p = s.candles.map((c) => c.close);
    const start = Math.max(20, warmupBars);
    for (let i = start; i + horizon < p.length; i++) {
      if (p[i] <= 0) continue;
      const r = p[i + horizon] / p[i] - 1;
      sum += r;
      count++;
      if (r > 0) wins++;
    }
  }
  if (count === 0) return { winRatePct: 0, avgReturnPct: 0 };
  return {
    winRatePct: Number(((wins / count) * 100).toFixed(1)),
    avgReturnPct: Number(((sum / count) * 100).toFixed(2)),
  };
}

export function runRecommendationBacktest(
  series: RecommendationSeries[],
  cfg: RecommendationBacktestConfig = {},
): RecommendationBacktestResult {
  const full: Required<RecommendationBacktestConfig> = {
    feeBps: Math.max(0, cfg.feeBps ?? FEE_DEFAULT_BPS),
    takeProfitPct: cfg.takeProfitPct ?? 0.35,
    warmupBars: Math.max(20, cfg.warmupBars ?? 30),
    matchedHorizon: cfg.matchedHorizon ?? 0, // 0 = 取策略平均持有期
    strategyId: cfg.strategyId ?? "",
    poolChokepointScore: cfg.poolChokepointScore ?? 60,
    numTrials: Math.max(1, cfg.numTrials ?? strategyCount()),
    volTargetPct: Math.max(0.5, cfg.volTargetPct ?? 3),
  };

  // 指定了已登记策略 id → 走「策略忠实重放」路径；否则退回内置简化口径。
  const strategy = full.strategyId ? getStrategy(full.strategyId) : undefined;
  const simulate = (s: RecommendationSeries) =>
    strategy ? simulateSymbolViaStrategy(s, full, strategy) : simulateSymbol(s, full);

  const trades: ClosedTrade[] = [];
  const perSymbol: SymbolTradeStats[] = [];
  for (const s of series) {
    const t = simulate(s);
    trades.push(...t);
    const rets = t.map((x) => x.returnPct);
    const wins = rets.filter((r) => r > 0).length;
    const p = s.candles.map((c) => c.close);
    const buyHold = p.length > full.warmupBars ? (p[p.length - 1] / p[Math.max(20, full.warmupBars)] - 1) * 100 : 0;
    perSymbol.push({
      code: s.code,
      name: s.name,
      trades: t.length,
      wins,
      winRatePct: t.length ? Number(((wins / t.length) * 100).toFixed(1)) : 0,
      avgReturnPct: rets.length ? Number((rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2)) : 0,
      buyHoldPct: Number(buyHold.toFixed(2)),
    });
  }

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.returnPct > 0).length;
  const rets = trades.map((t) => t.returnPct);
  const grossWin = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(rets.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  const avgReturnPct = totalTrades ? rets.reduce((a, b) => a + b, 0) / totalTrades : 0;
  const avgHoldDays = totalTrades ? trades.reduce((a, t) => a + t.holdDays, 0) / totalTrades : 0;

  const horizon = full.matchedHorizon > 0 ? full.matchedHorizon : Math.max(1, Math.round(avgHoldDays));
  const baseline = matchedBaseline(series, horizon, full.warmupBars);
  const buyHoldAvg = perSymbol.length
    ? perSymbol.reduce((a, s) => a + s.buyHoldPct, 0) / perSymbol.length
    : 0;

  const winRatePct = totalTrades ? (wins / totalTrades) * 100 : 0;
  const pHat = totalTrades ? wins / totalTrades : 0;
  const z = totalTrades > 0 ? (pHat - 0.5) / Math.sqrt(0.25 / totalTrades) : 0;
  const pVsCoin = Number((2 * (1 - normCdf(Math.abs(z)))).toFixed(4));
  const edge = avgReturnPct - baseline.avgReturnPct;

  // ── 风险调整指标 + bootstrap CI + 多重检验校正（借鉴顶级量化机构的诚实评估口径）──
  const byTime = [...trades].sort((a, b) => (a.sellDate < b.sellDate ? -1 : a.sellDate > b.sellDate ? 1 : 0));
  const retsByTime = byTime.map((t) => t.returnPct);
  const atrByTime = byTime.map((t) => t.atrPctAtEntry);
  const spanDays = tradeSpanDays(trades);
  const tradesPerYear = spanDays > 0 ? (totalTrades / spanDays) * 365.25 : totalTrades;
  const risk = tradeRiskMetrics(retsByTime, { tradesPerYear });
  const volTargeted = volTargetedStats(retsByTime, atrByTime, { targetVolPct: full.volTargetPct });
  const atrEntries = trades.map((t) => t.atrPctAtEntry).filter((a) => a > 0);
  const avgAtrPctAtEntry = atrEntries.length ? atrEntries.reduce((a, b) => a + b, 0) / atrEntries.length : 0;
  const avgCI = totalTrades >= 2 ? meanCI(rets) : { point: avgReturnPct, lo: avgReturnPct, hi: avgReturnPct };
  const wrCI = totalTrades >= 2 ? winRateCI(rets) : { point: winRatePct, lo: winRatePct, hi: winRatePct };
  const psr = probabilisticSharpe(retsByTime, 0);
  const dsr = deflatedSharpe(retsByTime, full.numTrials);
  const bonf = bonferroniAlpha(0.05, full.numTrials);
  const significantAfterCorrection = totalTrades >= 30 && z > 0 && pVsCoin < bonf;
  const crossValidation = purgedKFoldCV(trades, 5);

  let verdict: string;
  if (totalTrades < 30) {
    verdict = `样本不足（完成交易 ${totalTrades} 笔 < 30），无法得出有统计意义的结论；请扩大股票池或拉长区间。`;
  } else if (z > 1.96 && edge > 0) {
    verdict = `在该样本上：胜率 ${winRatePct.toFixed(1)}% 显著高于掷硬币（z=${z.toFixed(2)}, p=${pVsCoin}），且每笔均值 ${avgReturnPct.toFixed(2)}% 高于同持有期买入持有基线 ${baseline.avgReturnPct.toFixed(2)}%（择时超额 +${edge.toFixed(2)}pp）。注意这仍是历史回测，不构成未来保证。`;
  } else if (z > 1.96 && edge <= 0) {
    verdict = `胜率 ${winRatePct.toFixed(1)}% 虽显著高于 50%（z=${z.toFixed(2)}），但每笔均值未超过同持有期买入持有基线（择时超额 ${edge.toFixed(2)}pp ≤ 0）——高胜率主要靠小赢多次、并未跑赢「一直持有」，不能证明择时有超额价值。`;
  } else {
    verdict = `胜率 ${winRatePct.toFixed(1)}% 对 50% 不显著（z=${z.toFixed(2)}, p=${pVsCoin}）——在该样本上无法证明策略优于随机/买入持有。`;
  }
  // 多重检验 + 风险调整的诚实补充：比较了多个策略时，把显著门槛抬高。
  if (totalTrades >= 30) {
    const corr = significantAfterCorrection
      ? `经 ${full.numTrials} 次试验的 Bonferroni 校正（阈值 p<${bonf.toFixed(4)}）后仍显著。`
      : `但经 ${full.numTrials} 次试验的 Bonferroni 校正（阈值 p<${bonf.toFixed(4)}）后不再显著——比较了多个策略，须防"撞出"假信号。`;
    const volNote =
      volTargeted.sharpe > risk.sharpe
        ? `波动率目标仓位（按 1/ATR 调仓，平均杠杆 ${volTargeted.avgLeverage.toFixed(2)}×）把逐笔 Sharpe 从 ${risk.sharpe.toFixed(2)} 提升到 ${volTargeted.sharpe.toFixed(2)}——低波动票多下、高波动票少下能改善风险调整后收益。`
        : `波动率目标仓位（平均杠杆 ${volTargeted.avgLeverage.toFixed(2)}×）未提升逐笔 Sharpe（${volTargeted.sharpe.toFixed(2)} vs ${risk.sharpe.toFixed(2)}），该样本上等权已足够。`;
    verdict += ` 风险调整：Sharpe(逐笔) ${risk.sharpe.toFixed(2)}、年化 ${risk.sharpeAnnualized.toFixed(2)}、Sortino ${risk.sortino.toFixed(2)}、Calmar ${risk.calmarRatio.toFixed(2)}、最大回撤 ${risk.maxDrawdownPct.toFixed(1)}%；PSR ${(psr * 100).toFixed(0)}%、Deflated Sharpe ${(dsr.dsr * 100).toFixed(0)}%（运气门槛 SR≈${dsr.expectedMaxSharpe.toFixed(2)}）。${corr} ${volNote}`;
    if (crossValidation.usedFolds >= 2) {
      const cv = crossValidation;
      const cvNote = cv.holdsOutOfSample
        ? `跨时间稳健：${cv.usedFolds} 折中 ${cv.positiveFolds} 折正期望。`
        : `跨时间不稳健：仅 ${cv.positiveFolds}/${cv.usedFolds} 折正期望，最差折胜率 ${cv.worstFoldWinRatePct.toFixed(0)}%——边际收益高度依赖个别行情段，须警惕过拟合。`;
      verdict += ` Purged+Embargo ${cv.usedFolds} 折交叉验证：各折胜率 ${cv.meanWinRatePct.toFixed(0)}%±${cv.stdWinRatePct.toFixed(0)}%（净化 ${cv.purgedTrades} 笔跨界交易、隔离 ${cv.embargoDays.toFixed(0)} 天）。${cvNote}`;
    }
  }
  if (strategy) {
    verdict = `【策略：${strategy.meta.name} v${strategy.meta.version}】${verdict}`;
  }

  return {
    config: full,
    strategy: strategy ? { id: strategy.meta.id, name: strategy.meta.name, version: strategy.meta.version } : undefined,
    perSymbol: perSymbol.sort((a, b) => b.trades - a.trades),
    trades: trades.sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1)),
    stats: {
      symbols: series.length,
      totalTrades,
      wins,
      winRatePct: Number(winRatePct.toFixed(1)),
      avgReturnPct: Number(avgReturnPct.toFixed(2)),
      medianReturnPct: Number(median(rets).toFixed(2)),
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? Infinity : 0,
      avgHoldDays: Number(avgHoldDays.toFixed(1)),
      matchedHorizon: horizon,
      matchedBaselineWinRatePct: baseline.winRatePct,
      matchedBaselineAvgReturnPct: baseline.avgReturnPct,
      buyHoldAvgReturnPct: Number(buyHoldAvg.toFixed(2)),
      edgePct: Number(edge.toFixed(2)),
      zVsCoin: Number(z.toFixed(2)),
      pVsCoin,
      risk: {
        sharpe: Number(risk.sharpe.toFixed(3)),
        sharpeAnnualized: Number(risk.sharpeAnnualized.toFixed(2)),
        sortino: Number(risk.sortino.toFixed(3)),
        calmarRatio: Number(risk.calmarRatio.toFixed(2)),
        maxDrawdownPct: Number(risk.maxDrawdownPct.toFixed(1)),
        cagrPct: Number(risk.cagrPct.toFixed(2)),
      },
      tradesPerYear: Number(tradesPerYear.toFixed(1)),
      avgReturnCI: { point: Number(avgCI.point.toFixed(2)), lo: Number(avgCI.lo.toFixed(2)), hi: Number(avgCI.hi.toFixed(2)) },
      winRateCI: { point: Number(wrCI.point.toFixed(1)), lo: Number(wrCI.lo.toFixed(1)), hi: Number(wrCI.hi.toFixed(1)) },
      psr: Number(psr.toFixed(4)),
      dsr: Number(dsr.dsr.toFixed(4)),
      dsrExpectedMaxSharpe: Number(dsr.expectedMaxSharpe.toFixed(3)),
      numTrials: full.numTrials,
      bonferroniAlpha: Number(bonf.toFixed(4)),
      significantAfterCorrection,
      avgAtrPctAtEntry: Number(avgAtrPctAtEntry.toFixed(2)),
      volTargeted: {
        targetVolPct: volTargeted.targetVolPct,
        avgLeverage: Number(volTargeted.avgLeverage.toFixed(2)),
        avgReturnPct: Number(volTargeted.avgReturnPct.toFixed(2)),
        sharpe: Number(volTargeted.sharpe.toFixed(3)),
        sortino: Number(volTargeted.sortino.toFixed(3)),
        maxDrawdownPct: Number(volTargeted.maxDrawdownPct.toFixed(1)),
      },
      crossValidation,
      verdict,
    },
  };
}

/**
 * Purged + Embargo K-Fold 时间分折交叉验证。
 * 按买入日把交易切成 K 个连续时间折，净化跨边界交易、隔离折首相关交易后，逐折统计胜率/每笔均值。
 */
function purgedKFoldCV(trades: ClosedTrade[], folds = 5, embargoFrac = 0.01): CrossValidation {
  const empty: CrossValidation = {
    folds,
    usedFolds: 0,
    embargoDays: 0,
    purgedTrades: 0,
    foldStats: [],
    meanWinRatePct: 0,
    stdWinRatePct: 0,
    worstFoldWinRatePct: 0,
    worstFoldAvgReturnPct: 0,
    positiveFolds: 0,
    holdsOutOfSample: false,
  };
  // 折数随样本量自适应，保证每折期望 ≥ 4 笔；不足两折则无意义。
  const K = Math.max(2, Math.min(folds, Math.floor(trades.length / 4)));
  if (trades.length < 8 || K < 2) return empty;

  const withTimes = trades
    .map((t) => ({ t, buy: Date.parse(t.buyDate), sell: Date.parse(t.sellDate) }))
    .filter((x) => Number.isFinite(x.buy) && Number.isFinite(x.sell))
    .sort((a, b) => a.buy - b.buy);
  if (withTimes.length < 8) return empty;

  const minBuy = withTimes[0].buy;
  const maxBuy = withTimes[withTimes.length - 1].buy;
  const span = maxBuy - minBuy;
  if (span <= 0) return empty;

  const foldWidth = span / K;
  const embargoMs = embargoFrac * span;
  const embargoDays = embargoMs / 86_400_000;
  const edges: number[] = [];
  for (let f = 0; f <= K; f++) edges.push(minBuy + f * foldWidth);

  const buckets: { t: ClosedTrade; buy: number; sell: number }[][] = Array.from({ length: K }, () => []);
  let purged = 0;
  for (const x of withTimes) {
    let f = Math.floor((x.buy - minBuy) / foldWidth);
    if (f >= K) f = K - 1;
    const foldStart = edges[f];
    const foldEnd = edges[f + 1];
    // Purge：持仓在本折结束后才平仓 → 标签跨折泄漏，丢弃。
    if (x.sell > foldEnd) { purged++; continue; }
    // Embargo：非首折，开仓落在折首隔离带内 → 与上一折尾部相关，丢弃。
    if (f > 0 && x.buy < foldStart + embargoMs) { purged++; continue; }
    buckets[f].push(x);
  }

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const foldStats: CVFold[] = [];
  const winRates: number[] = [];
  let positiveFolds = 0;
  for (let f = 0; f < K; f++) {
    const b = buckets[f];
    if (b.length === 0) continue;
    const rets = b.map((x) => x.t.returnPct);
    const wins = rets.filter((r) => r > 0).length;
    const wr = (wins / b.length) * 100;
    const avg = rets.reduce((s, r) => s + r, 0) / b.length;
    foldStats.push({
      index: foldStats.length + 1,
      startDate: iso(edges[f]),
      endDate: iso(edges[f + 1]),
      trades: b.length,
      winRatePct: Number(wr.toFixed(1)),
      avgReturnPct: Number(avg.toFixed(2)),
    });
    winRates.push(wr);
    if (avg > 0) positiveFolds++;
  }

  const usedFolds = foldStats.length;
  if (usedFolds === 0) return { ...empty, purgedTrades: purged, embargoDays: Number(embargoDays.toFixed(1)) };
  const meanWr = winRates.reduce((s, x) => s + x, 0) / usedFolds;
  const variance = usedFolds > 1 ? winRates.reduce((s, x) => s + (x - meanWr) ** 2, 0) / (usedFolds - 1) : 0;
  const worst = foldStats.reduce((m, f) => (f.winRatePct < m.winRatePct ? f : m), foldStats[0]);

  return {
    folds: K,
    usedFolds,
    embargoDays: Number(embargoDays.toFixed(1)),
    purgedTrades: purged,
    foldStats,
    meanWinRatePct: Number(meanWr.toFixed(1)),
    stdWinRatePct: Number(Math.sqrt(variance).toFixed(1)),
    worstFoldWinRatePct: worst.winRatePct,
    worstFoldAvgReturnPct: worst.avgReturnPct,
    positiveFolds,
    holdsOutOfSample: usedFolds >= 3 && positiveFolds >= Math.ceil(usedFolds * 0.6),
  };
}

/** 交易序列覆盖的自然日跨度（最早买入到最晚卖出）。 */
function tradeSpanDays(trades: ClosedTrade[]): number {
  if (trades.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const t of trades) {
    const b = Date.parse(t.buyDate);
    const s = Date.parse(t.sellDate);
    if (!Number.isNaN(b)) min = Math.min(min, b);
    if (!Number.isNaN(s)) max = Math.max(max, s);
  }
  if (!isFinite(min) || !isFinite(max) || max <= min) return 0;
  return (max - min) / 86_400_000;
}

/** 便捷入口：代码清单 → 批量取日 K → 运行建议忠实回测。 */
export async function backtestRecommendationByCodes(
  codes: string[],
  cfg: RecommendationBacktestConfig = {},
  opts: { limit?: number; names?: Record<string, string> } = {},
): Promise<RecommendationBacktestResult> {
  const limit = Math.max(120, Math.min(HISTORY_LIMIT, opts.limit ?? 500));
  const klineMap = await getKlinesBatch(codes, limit, "baidu-first");
  const series: RecommendationSeries[] = [];
  for (const code of codes) {
    const item = klineMap.get(code);
    if (!item || item.candles.length < 60) continue;
    // 前复权早年负价/近零会污染回测，只取正价区间。
    const clean = item.candles.filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);
    if (clean.length < 60) continue;
    series.push({
      code,
      name: opts.names?.[code] ?? code,
      candles: clean.sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
  }
  if (series.length === 0) throw new Error("无可用 K 线数据，无法回测");
  return runRecommendationBacktest(series, cfg);
}
