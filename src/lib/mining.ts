import type { Candle } from "./types";
import {
  analyzeTechnicalPatterns,
  calculateChipDistribution,
  generatePriceProjection,
  runChokepointMomentumBacktest,
  executeTradesNextOpen,
  type ChipDistributionResult,
  type TechnicalAssessment,
} from "./quant";
import { getStrategy, executeStrategy } from "./strategies";

/**
 * 智能挖掘（Smart Mining）—— 纯函数信号引擎。
 *
 * 目标：批量、毫秒级地从一篮子股票里筛出「底部 + 上升通道 + B 买入信号」形态，
 * 并给出预期收益率/目标止盈/安全止损，供高并发扫描 API 调用。
 *
 * 本模块**不发起任何网络请求**（K 线/行情由调用方注入），以便单测与高并发复用。
 * 所有子信号都直接复用个股分析页已在用的现成原语，确保「挖掘到的形态」与
 * 「点进去看到的图」口径一致：
 *   - analyzeTechnicalPatterns  → 回归通道(上升/下降/震荡)、通道突破、POC、目标/止损
 *   - runChokepointMomentumBacktest → 「B」买入点（图上的 B 标记即该回测的 buy 交易）、胜率、夏普
 *   - calculateChipDistribution → 筹码获利比例 / 平均成本
 *   - generatePriceProjection   → GBM 概率区间（基准/乐观目标）→ 预期收益率
 */

/** 默认用于初筛回测/情景的中性瓶颈分（与个股图表口径一致）。 */
const NEUTRAL_SCORE = 70;
/** 判定「近期」B 信号的最大交易日数（超过则视为信号已过期）。 */
const FRESH_SIGNAL_DAYS = 20;

export interface MiningCandidate {
  code: string;
  name: string;
  /** 实时现价（缺失时调用方可传最后收盘价）。 */
  price?: number;
  changePct?: number;
  turnoverPct?: number;
  /** 成交额（元）—— 候选池批量字段，用于「两段漏斗」粗筛，免额外请求。 */
  amount?: number;
  /** 量比 —— 候选池批量字段，用于粗筛。 */
  volumeRatio?: number;
  market?: string;
}

/** 卖方一致预期（命中结果的可选补充维度，见 sources/unified.getAnalystConsensus）。 */
export interface MiningAnalyst {
  buyRatio: number | null;
  reportCount: number;
  impliedTarget: number | null;
  upsidePct: number | null;
}

export interface MiningSubScores {
  bottom: number; // 底部确认 0-100
  uptrend: number; // 上升通道 0-100
  bSignal: number; // B 买入信号 0-100
  volume: number; // 量能确认 0-100
  chips: number; // 筹码结构 0-100
}

export interface MiningResult {
  code: string;
  name: string;
  market?: string;
  price: number;
  changePct?: number;

  /** 复合分 0-100（各子信号加权）。 */
  score: number;
  subScores: MiningSubScores;
  /** 命中的信号标签（用于页面徽标）。 */
  matched: string[];

  /** 当前是否存在「未平仓」的 B 买入信号（最近一笔交易为买入）。 */
  hasBuySignal: boolean;
  buySignalDate?: string;
  buySignalAgeDays?: number;

  channelType: "up" | "down" | "range";
  /** 相对斜率（%/日），正=上行。 */
  channelSlopePct: number;
  channelStatus: "inside" | "breakout" | "breakdown";
  /** 现价在回归通道内的纵向位置 0(下轨)–1(上轨)，用于「下轨支撑」判定。 */
  channelPosition: number;
  /** 现价在回看区间内的位置 0(底)–1(顶)。 */
  rangePosition: number;
  /** 现价较近 60 日最低价的反弹幅度 %。 */
  reboundOffLowPct: number;

  /** 预期收益率（基准情景 p50，60 交易日）%。 */
  expectedReturnBase: number;
  /** 预期收益率（乐观情景 p90）%。 */
  expectedReturnBull: number;
  /** 目标止盈价（同个股图表口径）。 */
  target: number;
  /** 安全止损位（同个股图表口径）。 */
  stopLoss: number;
  /** 盈亏比 =(目标-现价)/(现价-止损)。 */
  riskReward: number;

  winRate: number;
  sharpe: number;
  profitRatio: number; // 筹码获利比例 0-1
  avgCost: number;
  poc: number;

  /** 近 ~60 日收盘价，用于迷你走势图。 */
  sparkline: number[];

  /** 卖方一致预期（仅在 withAnalyst 时对命中结果补充；其余为 undefined）。 */
  analyst?: MiningAnalyst;

  /**
   * 截面相对排名 0–1（1=本次命中里最好）。绝对分之外再给「相对位置」，
   * 回答「这只在今天命中池里排第几」。由 runMiningScan 在结果集上计算。
   */
  percentile?: {
    /** 复合分的截面排名。 */
    score: number;
    /** 预期收益（基准）的截面排名。 */
    expectedReturn: number;
  };
}

/** 复合分各子信号权重（合计 1）。 */
const WEIGHTS: MiningSubScores = {
  bottom: 0.22,
  uptrend: 0.26,
  bSignal: 0.28,
  volume: 0.12,
  chips: 0.12,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/** 现价在回看区间内的相对位置（0=最低，1=最高）。 */
function rangePosition(closes: number[]): number {
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const last = closes[closes.length - 1];
  return hi > lo ? clamp((last - lo) / (hi - lo), 0, 1) : 0.5;
}

/**
 * 底部确认评分：奖励「处于区间偏低位 + 已脱离绝对底部企稳回升」，
 * 惩罚「仍在创新低的下跌中继（接飞刀）」与「已涨到高位」。
 */
function scoreBottom(closes: number[], price: number): { score: number; rangePos: number; reboundPct: number } {
  const pos = rangePosition(closes);
  const low60 = Math.min(...closes.slice(-60));
  const reboundPct = low60 > 0 ? ((price - low60) / low60) * 100 : 0;

  // 位置分：底部区间(<=0.5)给高分，越接近顶部越低；>0.7 基本不算底部。
  let posScore: number;
  if (pos <= 0.5) posScore = 100 - (pos / 0.5) * 35; // 0 → 100, 0.5 → 65
  else if (pos <= 0.7) posScore = 65 - ((pos - 0.5) / 0.2) * 45; // 0.5 → 65, 0.7 → 20
  else posScore = clamp(20 - (pos - 0.7) * 100, 0, 20);

  // 企稳分：已较低点反弹 3%–25% 视为「确认企稳」最佳；几乎没反弹(仍在创新低/下跌中继，接飞刀)
  // 给极低分以避免误判为底部；已反弹过多(追高，离底部已远)亦降分。
  let reboundScore: number;
  if (reboundPct < 1) reboundScore = 8; // 仍贴着新低，疑似下跌中继 → 不算企稳
  else if (reboundPct <= 25) reboundScore = 60 + ((Math.min(reboundPct, 12) - 1) / 11) * 40; // 1→60, 12→100
  else reboundScore = clamp(100 - (reboundPct - 25) * 2, 30, 100);

  // 企稳确认是「底部」与「下跌中继」的关键区分，故权重高于单纯的低位。
  const score = clamp(posScore * 0.45 + reboundScore * 0.55, 0, 100);
  return { score, rangePos: pos, reboundPct: Number(reboundPct.toFixed(2)) };
}

/** 上升通道评分：来自回归通道方向 + 相对斜率 + 突破状态。 */
function scoreUptrend(tech: TechnicalAssessment): { score: number; slopePct: number } {
  const { type, slope, midLine, status } = tech.trendChannel;
  const relSlope = midLine > 0 ? (slope / midLine) * 100 : 0; // %/日

  let base: number;
  if (type === "up") base = clamp(55 + relSlope * 120, 55, 95); // 斜率越陡分越高
  else if (type === "range") base = clamp(45 + relSlope * 200, 20, 60); // 震荡偏上行给中性偏高
  else base = clamp(25 + relSlope * 200, 0, 35); // 下降通道低分

  if (status === "breakout") base = clamp(base + 8, 0, 100); // 上轨突破加成
  else if (status === "breakdown") base = clamp(base - 20, 0, 100);

  return { score: clamp(base, 0, 100), slopePct: Number(relSlope.toFixed(3)) };
}

/**
 * B 买入信号评分：图上的「B」= 瓶颈动量回测的 buy 交易。
 * 若最近一笔交易为买入（当前仍持仓）且足够新 → 强信号；信号越久越衰减。
 * 退而求其次：近期出现看涨结构突破(BOS/CHoCH) 给部分分。
 */
function scoreBSignal(
  candles: Candle[],
  tech: TechnicalAssessment,
  trades: { type: "buy" | "sell"; date: string }[]
): { score: number; hasBuySignal: boolean; date?: string; ageDays?: number } {
  const dateIndex = new Map(candles.map((c, i) => [c.date, i]));
  const lastIdx = candles.length - 1;

  const last = trades[trades.length - 1];
  if (last && last.type === "buy") {
    const idx = dateIndex.get(last.date);
    const ageDays = idx === undefined ? FRESH_SIGNAL_DAYS : lastIdx - idx;
    // 越新越高：0 日 → 100，FRESH_SIGNAL_DAYS 日 → 60，更久线性衰减。
    let score: number;
    if (ageDays <= FRESH_SIGNAL_DAYS) score = 100 - (ageDays / FRESH_SIGNAL_DAYS) * 40;
    else score = clamp(60 - (ageDays - FRESH_SIGNAL_DAYS) * 2, 0, 60);
    return { score: clamp(score, 0, 100), hasBuySignal: true, date: last.date, ageDays };
  }

  // 无未平仓 B：看是否有近期看涨结构突破。
  const bos = tech.smc?.bosList ?? [];
  for (let i = bos.length - 1; i >= 0; i--) {
    if (bos[i].type === "bullish") {
      const idx = dateIndex.get(bos[i].date);
      const ageDays = idx === undefined ? 999 : lastIdx - idx;
      if (ageDays <= FRESH_SIGNAL_DAYS) {
        return { score: clamp(55 - (ageDays / FRESH_SIGNAL_DAYS) * 25, 0, 55), hasBuySignal: false, date: bos[i].date, ageDays };
      }
      break;
    }
  }
  return { score: 0, hasBuySignal: false };
}

/** 量能确认：近 5 日均换手 / 前 20 日均换手，>1 视为放量。 */
function scoreVolume(candles: Candle[]): number {
  const recent = candles.slice(-5);
  const prior = candles.slice(-25, -5);
  if (recent.length === 0 || prior.length === 0) return 40;
  const avg = (arr: Candle[]) => arr.reduce((s, c) => s + (c.turnoverPct || 0), 0) / arr.length;
  const r = avg(recent);
  const p = avg(prior);
  if (p <= 0) return 50;
  const ratio = r / p;
  // 1.0 → 50, 1.5 → 80, 2.5+ → 100；缩量(<0.8) 偏低。
  return clamp(50 + (ratio - 1) * 60, 10, 100);
}

/** 筹码结构：现价站上平均成本/POC、获利盘处于健康区间（非高位全套牢）。 */
function scoreChips(chips: ChipDistributionResult, poc: number, price: number): number {
  let score = 50;
  if (price >= chips.avgCost) score += 18; // 多数筹码获利，主力成本之上
  else score -= 12;
  if (price >= poc) score += 12; // 站上主力密集成本区
  // 获利盘比例：0.4–0.8 健康；过高(>0.92)说明普遍套牢盘少但也可能高位，过低说明深套。
  const pr = chips.profitRatio;
  if (pr >= 0.4 && pr <= 0.85) score += 20;
  else if (pr > 0.85) score += 6;
  else score += pr * 25;
  return clamp(score, 0, 100);
}

/**
 * 评估单只股票的挖掘信号（纯计算，无网络）。
 * candles 建议传入≥120 根日 K（越多通道/回测越稳），price 传实时现价（缺失用最后收盘）。
 * opts.strategyId 指定「B 买入信号」所用的买卖策略（取自策略注册表 strategies.ts），
 * 缺省/未知 id 时回退到内置「瓶颈动量 v1」，与全站 /chart 口径保持一致。
 */
export function evaluateMiningSignal(
  input: MiningCandidate & { candles: Candle[] },
  opts?: { strategyId?: string },
): MiningResult | null {
  const { code, name, candles, market, changePct } = input;
  if (!candles || candles.length < 60) return null; // 样本不足无法判形态

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1];
  const price = input.price && input.price > 0 ? input.price : lastClose;

  const chips = calculateChipDistribution(candles, price);
  const tech = analyzeTechnicalPatterns(candles, price, chips);
  // 成交价统一走「次日开盘成交（T+1 open）」口径，B 信号点与全站一致。
  // strategyId 命中策略注册表则用所选策略产出 B 信号，否则回退内置瓶颈动量 v1。
  const strat = opts?.strategyId ? getStrategy(opts.strategyId) : undefined;
  // 自撮合元策略（Ensemble）已在 run() 内撮合，executeStrategy 会跳过二次撮合；
  // 其成交点即目标仓位再平衡点，作为 B 信号点与全站口径一致。
  const backtest = strat
    ? executeStrategy(strat, candles, { chokepointScore: NEUTRAL_SCORE, code })
    : executeTradesNextOpen(candles, runChokepointMomentumBacktest(candles, NEUTRAL_SCORE, { code }));
  const projections = generatePriceProjection(candles, NEUTRAL_SCORE);

  const bottom = scoreBottom(closes, price);
  const uptrend = scoreUptrend(tech);
  const bSig = scoreBSignal(candles, tech, backtest.trades);
  const volume = scoreVolume(candles);
  const chipScore = scoreChips(chips, tech.vrvp.poc, price);

  const subScores: MiningSubScores = {
    bottom: Math.round(bottom.score),
    uptrend: Math.round(uptrend.score),
    bSignal: Math.round(bSig.score),
    volume: Math.round(volume),
    chips: Math.round(chipScore),
  };

  const score = Math.round(
    subScores.bottom * WEIGHTS.bottom +
      subScores.uptrend * WEIGHTS.uptrend +
      subScores.bSignal * WEIGHTS.bSignal +
      subScores.volume * WEIGHTS.volume +
      subScores.chips * WEIGHTS.chips
  );

  // 预期收益率：取情景模拟末期（60 交易日）基准/乐观目标相对现价的涨幅。
  const lastProj = projections[projections.length - 1];
  const expectedReturnBase = lastProj ? Number((((lastProj.base - price) / price) * 100).toFixed(2)) : 0;
  const expectedReturnBull = lastProj ? Number((((lastProj.bull - price) / price) * 100).toFixed(2)) : 0;

  const target = safe(tech.actionAdvice.takeProfit, price * 1.25);
  const stopLoss = safe(tech.actionAdvice.stopLoss, price * 0.92);
  const riskReward = price - stopLoss > 0 ? Number(((target - price) / (price - stopLoss)).toFixed(2)) : 0;

  // 现价在回归通道内的纵向位置：0=贴下轨，1=贴上轨。通道宽=上轨-下轨（=3×标准差，恒>0）。
  const chWidth = tech.trendChannel.upperLine - tech.trendChannel.lowerLine;
  const channelPosition =
    chWidth > 0 ? clamp((price - tech.trendChannel.lowerLine) / chWidth, 0, 1) : 0.5;

  const matched: string[] = [];
  if (subScores.bottom >= 60) matched.push("底部企稳");
  if (uptrend.score >= 60 && tech.trendChannel.type === "up") matched.push("上升通道");
  // 「下轨支撑」：上升通道 + 现价贴近下轨（≤通道宽 DEFAULT_LOWER_BAND_PCT）且未跌破下轨——高抛低吸切入点。
  if (
    tech.trendChannel.type === "up" &&
    tech.trendChannel.status !== "breakdown" &&
    channelPosition <= DEFAULT_LOWER_BAND_PCT
  )
    matched.push("下轨支撑");
  // 仅在非下降通道时把「上轨突破」视为利多信号（下降通道里的线性回归上穿多为拟合假象）。
  if (tech.trendChannel.status === "breakout" && tech.trendChannel.type !== "down") matched.push("通道突破");
  if (bSig.hasBuySignal) matched.push("B 买入信号");
  else if (subScores.bSignal > 0) matched.push("结构突破");
  if (subScores.volume >= 70) matched.push("放量");
  if (price >= tech.vrvp.poc) matched.push("站上POC");

  return {
    code,
    name,
    market,
    price: Number(price.toFixed(2)),
    changePct,
    score,
    subScores,
    matched,
    hasBuySignal: bSig.hasBuySignal,
    buySignalDate: bSig.date,
    buySignalAgeDays: bSig.ageDays,
    channelType: tech.trendChannel.type,
    channelSlopePct: uptrend.slopePct,
    channelStatus: tech.trendChannel.status,
    channelPosition: Number(channelPosition.toFixed(2)),
    rangePosition: Number(bottom.rangePos.toFixed(2)),
    reboundOffLowPct: bottom.reboundPct,
    expectedReturnBase,
    expectedReturnBull,
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward,
    winRate: safe(backtest.winRate),
    sharpe: safe(backtest.sharpe ?? 0),
    profitRatio: chips.profitRatio,
    avgCost: chips.avgCost,
    poc: tech.vrvp.poc,
    sparkline: closes.slice(-60).map((v) => Number(v.toFixed(2))),
  };
}

/** 「下轨支撑」默认阈值：现价距回归通道下轨 ≤ 通道宽度该占比时视为贴近下轨（0=下轨，1=上轨）。 */
export const DEFAULT_LOWER_BAND_PCT = 0.35;

export interface MiningFilters {
  minScore?: number; // 最低复合分
  minExpectedReturn?: number; // 最低基准预期收益 %
  requireUptrend?: boolean; // 必须上升通道
  /**
   * 必须「回归通道下轨支撑」：上升通道 + 现价贴近下轨（≤ lowerBandPct 通道宽）且未跌破下轨。
   * 用于在上升趋势中寻找高抛低吸切入点；勾选后已隐含「必须上升通道」。
   */
  requireLowerBandSupport?: boolean;
  /** 「贴近下轨」阈值：现价在通道内纵向位置 ≤ 该值（0=下轨，1=上轨）。缺省 DEFAULT_LOWER_BAND_PCT。 */
  lowerBandPct?: number;
  requireBSignal?: boolean; // 必须有未平仓 B 买入信号
  /** B 信号「新鲜度」上限（交易日）：仅保留距今 ≤ 该值的刚发出信号。0=仅当日，1=当日/隔日。 */
  maxBSignalAgeDays?: number;
}

/** 判断一条结果是否满足筛选条件。 */
export function passesFilters(r: MiningResult, f: MiningFilters): boolean {
  return rejectReason(r, f) === null;
}

/** 未命中原因键（与 passesFilters 同序，返回首个未通过项；用于「未命中原因分布」统计）。 */
export type RejectReason =
  | "minScore"
  | "minExpectedReturn"
  | "requireUptrend"
  | "requireLowerBandSupport"
  | "requireBSignal"
  | "bSignalMissing"
  | "bSignalStale";

/**
 * 返回一条结果「第一个未通过的筛选项」（通过返回 null）。
 * 与 passesFilters 严格同序，使日志里的「未命中原因分布」与实际过滤口径一致，
 * 便于排查 0 命中是被哪条筛选条件卡掉。
 */
export function rejectReason(r: MiningResult, f: MiningFilters): RejectReason | null {
  if (f.minScore != null && r.score < f.minScore) return "minScore";
  if (f.minExpectedReturn != null && r.expectedReturnBase < f.minExpectedReturn) return "minExpectedReturn";
  if (f.requireUptrend && r.channelType !== "up") return "requireUptrend";
  // 下轨支撑：上升通道 + 未跌破下轨 + 现价贴近下轨（纵向位置 ≤ 阈值）。任一不满足即卡掉。
  if (f.requireLowerBandSupport) {
    const thr = f.lowerBandPct ?? DEFAULT_LOWER_BAND_PCT;
    const ok = r.channelType === "up" && r.channelStatus !== "breakdown" && r.channelPosition <= thr;
    if (!ok) return "requireLowerBandSupport";
  }
  if (f.requireBSignal && !r.hasBuySignal) return "requireBSignal";
  // 「刚发出」过滤：必须有未平仓 B 信号，且其形成距今不超过 maxBSignalAgeDays 个交易日。
  if (f.maxBSignalAgeDays != null) {
    if (!r.hasBuySignal) return "bSignalMissing";
    if (r.buySignalAgeDays == null || r.buySignalAgeDays > f.maxBSignalAgeDays) return "bSignalStale";
  }
  return null;
}

/**
 * 有界并发执行池：对 items 以最多 concurrency 个并行执行 worker，
 * 单个任务抛错不影响整体（返回 null 由调用方过滤），每完成一个回调 onSettled。
 * 用于高并发扫描时控制对上游行情接口的瞬时压力。
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R | null, item: T, index: number) => void
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));

  async function runner(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      let r: R | null = null;
      try {
        r = await worker(items[i], i);
      } catch {
        r = null;
      }
      results[i] = r;
      onSettled?.(r, items[i], i);
    }
  }

  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}
