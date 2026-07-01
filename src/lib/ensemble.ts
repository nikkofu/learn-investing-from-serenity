/**
 * 多策略并行决策引擎（Ensemble · 架构 B：加权投票 + 连续仓位聚合）。
 *
 * 思路：N 个成员策略各自并行回测，把每个成员「逐根应持有的仓位比例」还原成一条
 * 敞口序列 memberPos[i]∈[0,1]；再按权重（可选 regime 调制）加权平均，得到组合的
 * 逐根「目标仓位」序列 targetPos[i]∈[0,posCap]；最后交给 executeTargetPositionNextOpen
 * 按次日开盘再平衡撮合，得到组合净值/回撤/胜率/夏普。
 *
 * 与单策略互补：趋势成员在单边行情贡献敞口、均值回归成员在震荡行情贡献敞口；
 * regime 调制让「上升趋势期偏重趋势成员、震荡/下跌期偏重回归成员」，而非硬开关。
 */
import type { Candle } from "./types";
import type { BacktestResult, TradeAction } from "./quant";
import { executeTargetPositionNextOpen } from "./quant";
import { getStrategy, type StrategyContext } from "./strategies";
import { computeADX, computeRegressionChannel } from "./indicators";

export type MemberKind = "trend" | "reversion" | "neutral";

export interface EnsembleMember {
  strategyId: string;
  baseWeight: number;
  kind: MemberKind;
}

export interface EnsembleConfig {
  members: EnsembleMember[];
  posCap: number; // 组合最大总仓位（0..1，默认 1.0）
  regimeModulation: boolean; // 是否按 regime 调制成员权重
  adxTrendMin: number; // ADX ≥ 此值判定为「趋势」regime（默认 20）
  relSlopeTrendMin: number; // 回归通道每根相对斜率 |slope/mid| ≥ 此值方判方向（默认 0.0008）
  trendBoost: number; // regime 调制强度：受青睐的一类成员权重 ×boost、另一类 ÷boost（默认 1.6）
  channelLen: number; // 回归通道回看根数（regime 方向判定，默认 60）
}

/** ensemble-v1 默认配置：趋势核心 + 稳健趋势 + 均值回归卫星 + 低波动尾部。 */
export const ENSEMBLE_V1_MEMBERS: EnsembleMember[] = [
  { strategyId: "tv-cardwell-rsi-navigator-v4", baseWeight: 0.24, kind: "trend" },
  { strategyId: "tv-cardwell-rsi-navigator-v3", baseWeight: 0.20, kind: "trend" },
  { strategyId: "chokepoint-momentum-v5", baseWeight: 0.18, kind: "trend" },
  { strategyId: "channel-reversion-v1", baseWeight: 0.26, kind: "reversion" },
  { strategyId: "rsi-reversion-v1", baseWeight: 0.12, kind: "reversion" },
];

export const ENSEMBLE_V1_DEFAULTS: EnsembleConfig = {
  members: ENSEMBLE_V1_MEMBERS,
  posCap: 0.95,
  regimeModulation: true,
  adxTrendMin: 20,
  relSlopeTrendMin: 0.0008,
  trendBoost: 2.5,
  channelLen: 60,
};

/**
 * 把一个成员策略的原始信号（buy/sell + sizePct，按信号根收盘确认）还原为逐根敞口
 * 序列 memberPos[i]∈[0,1]：buy 累加 sizePct（缺省=整仓 100%），sell 按当前敞口的
 * sizePct 比例减仓（缺省/≥1=清仓）。敞口在信号后一直保持到下一次变动。
 */
export function memberPositionSeries(candles: Candle[], res: BacktestResult): number[] {
  const n = candles.length;
  const idxByDate = new Map<string, number>();
  for (let i = 0; i < n; i++) idxByDate.set(candles[i].date, i);
  const orders: { idx: number; t: TradeAction }[] = [];
  for (const t of res.trades) {
    const idx = idxByDate.get(t.date);
    if (idx != null) orders.push({ idx, t });
  }
  orders.sort((a, b) => a.idx - b.idx);
  const pos = new Array<number>(n).fill(0);
  let frac = 0;
  let oi = 0;
  for (let i = 0; i < n; i++) {
    while (oi < orders.length && orders[oi].idx === i) {
      const o = orders[oi++].t;
      if (o.type === "buy") {
        if (o.sizePct == null) frac = 1;
        else frac = Math.min(1, frac + Math.max(0, o.sizePct));
      } else {
        if (o.sizePct == null || o.sizePct >= 1) frac = 0;
        else frac = Math.max(0, frac * (1 - o.sizePct));
      }
    }
    pos[i] = frac;
  }
  return pos;
}

export type Regime = "trend_up" | "range" | "trend_down";

/**
 * 逐根 regime 判定（方向感知）：ADX 判「是否成趋势」，回归通道相对斜率判方向。
 * - ADX ≥ adxTrendMin 且 slope/mid ≥ +relSlopeTrendMin → trend_up（趋势上行）
 * - ADX ≥ adxTrendMin 且 slope/mid ≤ −relSlopeTrendMin → trend_down（趋势下行）
 * - 其余（ADX 低或斜率平） → range（震荡）
 * 预热不足处按 range 处理（保守，不给趋势成员额外加权）。
 */
export function detectRegime(candles: Candle[], adxTrendMin: number, relSlopeTrendMin: number, channelLen: number): Regime[] {
  const adx = computeADX(candles, 14);
  const ch = computeRegressionChannel(candles, channelLen, 1.5);
  return candles.map((_, i) => {
    const a = adx[i];
    const p = ch[i];
    const trending = Number.isFinite(a) && a >= adxTrendMin;
    if (!trending || !p || !Number.isFinite(p.slope) || !Number.isFinite(p.mid) || p.mid === 0) return "range";
    const rel = p.slope / p.mid;
    if (rel >= relSlopeTrendMin) return "trend_up";
    if (rel <= -relSlopeTrendMin) return "trend_down";
    return "range";
  });
}

/** 某 regime 下，某类成员的权重调制因子。 */
function regimeFactor(regime: Regime, kind: MemberKind, boost: number): number {
  if (kind === "neutral" || boost <= 1) return 1;
  if (regime === "trend_up") return kind === "trend" ? boost : 1 / boost;
  // range / trend_down：偏重均值回归、压低趋势成员（趋势成员在震荡挨打、在下行亏钱）
  return kind === "reversion" ? boost : 1 / boost;
}

/**
 * 计算组合逐根目标仓位序列。每根：按 regime 调制各成员权重（上行趋势期抬升趋势
 * 成员、压低回归成员；震荡/下行期反之），归一化后对 memberPos 加权求和，再乘
 * posCap 截断。
 */
export function computeEnsembleTargets(candles: Candle[], ctx: StrategyContext, cfg: EnsembleConfig): number[] {
  const n = candles.length;
  const memberSeries: { pos: number[]; kind: MemberKind; w: number }[] = [];
  for (const m of cfg.members) {
    const strat = getStrategy(m.strategyId);
    if (!strat) continue;
    const res = strat.run(candles, ctx);
    memberSeries.push({ pos: memberPositionSeries(candles, res), kind: m.kind, w: m.baseWeight });
  }
  if (memberSeries.length === 0) return new Array<number>(n).fill(0);

  const regime = cfg.regimeModulation
    ? detectRegime(candles, cfg.adxTrendMin, cfg.relSlopeTrendMin, cfg.channelLen)
    : new Array<Regime>(n).fill("range");
  const target = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sumW = 0;
    let acc = 0;
    for (const ms of memberSeries) {
      const w = cfg.regimeModulation ? ms.w * regimeFactor(regime[i], ms.kind, cfg.trendBoost) : ms.w;
      sumW += w;
      acc += w * ms.pos[i];
    }
    const blended = sumW > 0 ? acc / sumW : 0;
    target[i] = Math.max(0, Math.min(cfg.posCap, blended));
  }
  return target;
}

/** 运行 Ensemble 回测（架构 B）。 */
export function runEnsembleParams(candles: Candle[], ctx: StrategyContext, cfg: EnsembleConfig): BacktestResult {
  // regime 方向判定需要通道预热；预热不足直接空仓
  const warmup = Math.max(cfg.channelLen, 30);
  if (candles.length < warmup + 5) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }
  const target = computeEnsembleTargets(candles, ctx, cfg);
  return executeTargetPositionNextOpen(candles, target);
}

/** ensemble-v1 默认封装。 */
export function runEnsembleV1(candles: Candle[], ctx: StrategyContext): BacktestResult {
  return runEnsembleParams(candles, ctx, ENSEMBLE_V1_DEFAULTS);
}
