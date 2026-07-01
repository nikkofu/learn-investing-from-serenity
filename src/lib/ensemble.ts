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
 *
 * V2（幻方式增强，见 docs/ensemble-v2-highflyer-inspired-design.md）：
 * - 配权方案 weightScheme：fixed（手调）/ equal（等权）/ invVolCapped（带上下限的
 *   反波动，走前因果）+ 趋势同源簇限权 trendClusterCap，缓解"虚假多因子共振"。
 * - 组合级风控闸门 riskGate：按合成净值回撤 + 已实现波动，独立于成员信号强制降仓/
 *   清仓（对抗监督/硬止损），因果口径与次日开盘撮合一致。
 */
import type { Candle } from "./types";
import type { BacktestResult, TradeAction } from "./quant";
import { executeTargetPositionNextOpen } from "./quant";
import { getStrategy, type StrategyContext } from "./strategies";
import { computeADX, computeRegressionChannel } from "./indicators";

export type MemberKind = "trend" | "reversion" | "neutral";

export type WeightScheme = "fixed" | "equal" | "invVolCapped";

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

  // —— V2：配权方案 ——
  weightScheme: WeightScheme; // 成员基础配权方式（默认 fixed=沿用 baseWeight）
  weightLookback: number; // invVolCapped 走前窗口（估成员波动，默认 60）
  weightClampMin: number; // invVolCapped 单成员归一化权重下限（默认 0.05）
  weightClampMax: number; // invVolCapped 单成员归一化权重上限（默认 0.35）
  trendClusterCap: number; // 趋势同源簇合计权重上限（0 或 ≥1 表示关闭；默认 0）

  // —— V2：组合级风控闸门 ——
  riskGate: boolean; // 是否启用组合级风控闸门（默认 false）
  ddSoft: number; // 回撤软阈值（负数，如 -0.08）：优于此不干预
  ddHard: number; // 回撤硬阈值（负数，如 -0.15）：劣于此强制清仓 + 冷却
  cooldownBars: number; // 触发硬阈值后的强制空仓冷却根数
  volLen: number; // 已实现波动窗口（0=关闭波动闸门）
  volCap: number; // 日已实现波动上限（超出按比例降仓，0=关闭）
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
  // V2 字段：v1 取"关闭"档，保证行为与历史完全一致
  weightScheme: "fixed",
  weightLookback: 60,
  weightClampMin: 0.05,
  weightClampMax: 0.35,
  trendClusterCap: 0,
  riskGate: false,
  ddSoft: -0.08,
  ddHard: -0.15,
  cooldownBars: 5,
  volLen: 0,
  volCap: 0,
};

/**
 * ensemble-v2 默认配置：等权（T1 诊断显示等权全面小胜手调，且趋势核心 cw-v4/cw-v3/
 * chk-v5 收益相关 0.75~0.92，等权已足够分散，故不再叠加簇限权）+ 组合级风控闸门
 * （合成净值回撤软 −12%/硬 −18% 降仓，压回撤）。成员沿用 v1 清单。默认 Pro 策略不受影响。
 */
export const ENSEMBLE_V2_DEFAULTS: EnsembleConfig = {
  ...ENSEMBLE_V1_DEFAULTS,
  weightScheme: "equal",
  // 趋势簇限权保留为可选旋钮：诊断显示在「等权」基底下，等权本身已足够分散，额外簇
  // 限权反而以 ~4.6pt 收益换 ~0.6pt 回撤，得不偿失，故默认关闭（=0）。
  trendClusterCap: 0,
  riskGate: true,
  ddSoft: -0.12,
  ddHard: -0.18,
  cooldownBars: 0,
  volLen: 0,
  volCap: 0,
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

/** 样本标准差（总体口径，与波动估计一致）。 */
function stddev(a: number[]): number {
  if (a.length === 0) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/**
 * 计算第 i 根各成员的「基础权重」（未经 regime 调制），按 weightScheme：
 * - fixed：沿用 baseWeight（与 v1 一致）；
 * - equal：等权；
 * - invVolCapped：走前窗口 [i-L, i-1] 估各成员策略收益波动，w∝1/σ，逐个夹到
 *   [clampMin, clampMax] 后再归一化；窗口不足回退 baseWeight（fixed）。
 * 最后按 trendClusterCap 对「趋势同源簇」合计权重限权（把超出部分让渡给非趋势成员）。
 */
function baseWeightsAt(
  i: number,
  members: EnsembleMember[],
  memberRet: number[][],
  cfg: EnsembleConfig
): number[] {
  const N = members.length;
  const norm = (v: number[]): number[] => {
    const s = v.reduce((a, x) => a + x, 0);
    return s > 0 ? v.map((x) => x / s) : v.map(() => 1 / (N || 1));
  };

  let w: number[];
  if (cfg.weightScheme === "equal") {
    w = norm(members.map(() => 1));
  } else if (cfg.weightScheme === "invVolCapped" && i > cfg.weightLookback) {
    const sig = members.map((_, mi) => stddev(memberRet[mi].slice(i - cfg.weightLookback, i)));
    let raw = norm(sig.map((s) => (s > 0 ? 1 / s : 0)));
    // 夹逼上下限后重新归一化，避免退化性地把权重全砸进极低波动成员
    raw = raw.map((x) => Math.min(cfg.weightClampMax, Math.max(cfg.weightClampMin, x)));
    w = norm(raw);
  } else {
    w = norm(members.map((m) => m.baseWeight)); // fixed / invVolCapped 预热回退
  }

  // 趋势同源簇限权：趋势成员合计权重超过 cap 时，簇内等比压缩、缺额让渡给非趋势成员
  const cap = cfg.trendClusterCap;
  if (cap > 0 && cap < 1) {
    const trendSum = members.reduce((s, m, mi) => s + (m.kind === "trend" ? w[mi] : 0), 0);
    const otherSum = 1 - trendSum;
    if (trendSum > cap && otherSum > 0) {
      const tScale = cap / trendSum;
      const oScale = (1 - cap) / otherSum;
      w = members.map((m, mi) => (m.kind === "trend" ? w[mi] * tScale : w[mi] * oScale));
    }
  }
  return w;
}

/**
 * 计算组合逐根目标仓位序列。每根：按 weightScheme 定各成员基础权重（可选趋势簇限权），
 * 再按 regime 调制（上行趋势期抬升趋势成员、压低回归成员；震荡/下行期反之），归一化后
 * 对 memberPos 加权求和，乘 posCap 截断。
 */
export function computeEnsembleTargets(candles: Candle[], ctx: StrategyContext, cfg: EnsembleConfig): number[] {
  const n = candles.length;
  const members: EnsembleMember[] = [];
  const memberPos: number[][] = [];
  for (const m of cfg.members) {
    const strat = getStrategy(m.strategyId);
    if (!strat) continue;
    const res = strat.run(candles, ctx);
    members.push(m);
    memberPos.push(memberPositionSeries(candles, res));
  }
  if (members.length === 0) return new Array<number>(n).fill(0);

  // 成员逐根策略收益（走前配权用）：r_i[t] = pos_i[t-1] * (close[t]/close[t-1]-1)
  const memberRet: number[][] = memberPos.map((pos) => {
    const r = new Array<number>(n).fill(0);
    for (let t = 1; t < n; t++) {
      const ret = candles[t - 1].close > 0 ? candles[t].close / candles[t - 1].close - 1 : 0;
      r[t] = pos[t - 1] * ret;
    }
    return r;
  });

  const regime = cfg.regimeModulation
    ? detectRegime(candles, cfg.adxTrendMin, cfg.relSlopeTrendMin, cfg.channelLen)
    : new Array<Regime>(n).fill("range");

  // fixed/equal 的基础权重与 i 无关，预先算一次；invVolCapped 每根重算（走前）。
  const staticW = cfg.weightScheme === "invVolCapped" ? null : baseWeightsAt(0, members, memberRet, cfg);

  const target = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const bw = staticW ?? baseWeightsAt(i, members, memberRet, cfg);
    let sumW = 0;
    let acc = 0;
    for (let mi = 0; mi < members.length; mi++) {
      const w = cfg.regimeModulation ? bw[mi] * regimeFactor(regime[i], members[mi].kind, cfg.trendBoost) : bw[mi];
      sumW += w;
      acc += w * memberPos[mi][i];
    }
    const blended = sumW > 0 ? acc / sumW : 0;
    target[i] = Math.max(0, Math.min(cfg.posCap, blended));
  }
  return target;
}

/**
 * 组合级风控闸门（Critic / 硬止损）：对未加闸门的目标仓位序列，按「合成因果净值回撤
 * + 已实现波动」逐根计算风控乘数 gate∈[0,1] 并作用，独立于成员信号。
 * 因果口径：第 i 根用 ≤i 的信息（合成净值取自 ≤i-1 的目标仓位，回撤/波动截至第 i 根），
 * 乘子作用于第 i 根目标（第 i+1 开盘执行），与 executeTargetPositionNextOpen 一致。
 * - 回撤：dd ≥ ddSoft 不干预；ddHard < dd < ddSoft 线性降仓；dd ≤ ddHard 清仓 + 冷却。
 * - 波动：近 volLen 根已实现波动 > volCap 时按 volCap/vol 比例降仓（volLen=0 关闭）。
 */
export function applyRiskGate(target: number[], candles: Candle[], cfg: EnsembleConfig): number[] {
  const n = target.length;
  const ret = candles.map((c, i) => (i > 0 && candles[i - 1].close > 0 ? c.close / candles[i - 1].close - 1 : 0));
  const gated = new Array<number>(n).fill(0);
  let eq = 1;
  let peak = 1;
  let cooldown = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      eq *= 1 + target[i - 1] * ret[i];
      if (eq > peak) peak = eq;
    }
    const dd = peak > 0 ? eq / peak - 1 : 0;

    let g: number;
    if (dd <= cfg.ddHard) {
      g = 0;
      cooldown = cfg.cooldownBars;
    } else if (cooldown > 0) {
      cooldown--;
      g = 0;
    } else if (dd < cfg.ddSoft) {
      const denom = cfg.ddHard - cfg.ddSoft;
      g = denom !== 0 ? (cfg.ddHard - dd) / denom : 1;
    } else {
      g = 1;
    }
    g = Math.max(0, Math.min(1, g));

    if (cfg.volLen > 0 && cfg.volCap > 0 && i >= cfg.volLen) {
      const vol = stddev(ret.slice(i - cfg.volLen, i));
      if (vol > cfg.volCap) g = Math.min(g, cfg.volCap / vol);
    }
    gated[i] = g * target[i];
  }
  return gated;
}

/** 运行 Ensemble 回测（架构 B）。 */
export function runEnsembleParams(candles: Candle[], ctx: StrategyContext, cfg: EnsembleConfig): BacktestResult {
  // regime 方向判定需要通道预热；预热不足直接空仓
  const warmup = Math.max(cfg.channelLen, 30);
  if (candles.length < warmup + 5) {
    return { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };
  }
  let target = computeEnsembleTargets(candles, ctx, cfg);
  if (cfg.riskGate) target = applyRiskGate(target, candles, cfg);
  return executeTargetPositionNextOpen(candles, target);
}

/** ensemble-v1 默认封装。 */
export function runEnsembleV1(candles: Candle[], ctx: StrategyContext): BacktestResult {
  return runEnsembleParams(candles, ctx, ENSEMBLE_V1_DEFAULTS);
}

/** ensemble-v2 默认封装（等权 + 趋势簇限权 + 风控闸门）。 */
export function runEnsembleV2(candles: Candle[], ctx: StrategyContext): BacktestResult {
  return runEnsembleParams(candles, ctx, ENSEMBLE_V2_DEFAULTS);
}
