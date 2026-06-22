/**
 * 量化统计工具库 —— 借鉴国际主流量化机构的"诚实评估"通用做法。
 *
 * 解决的核心问题：小样本 + 多策略反复比较时，单看胜率/均值极易被噪声和
 * "多重检验"骗出假显著。这里提供：
 * - 风险调整指标：Sharpe / Sortino / Calmar / 最大回撤（从逐笔净收益的近似净值曲线算）。
 * - Bootstrap 置信区间：对胜率与每笔均值给出 95% CI，量化"运气成分"。
 * - PSR / Deflated Sharpe Ratio（López de Prado, 2014）：在"试过 N 个策略"的前提下，
 *   把观察到的 Sharpe 缩水校正，回答"这个 Sharpe 是否经得起多重检验"。
 * - 多重检验校正：Bonferroni 与 Benjamini-Hochberg（FDR）。
 *
 * 约定：收益序列以"百分数"传入（如 +4.85 表示 +4.85%）。Sharpe/偏度/峰度均为
 * 量纲无关比值，百分数与小数等价，无需换算。
 */

const EULER_MASCHERONI = 0.5772156649015329;

// ── 基础分布函数 ──────────────────────────────────────────────────────────────

/** 标准正态 CDF（Abramowitz-Stegun 7.1.26 erf 近似）。 */
export function normCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2));
  return x >= 0 ? 0.5 + 0.5 * y : 0.5 - 0.5 * y;
}

/** 标准正态分位数（逆 CDF），Acklam 有理逼近，|误差| < 1.15e-9。 */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ── 描述性统计 ────────────────────────────────────────────────────────────────

export interface DescriptiveStats {
  n: number;
  mean: number;
  /** 样本标准差（n-1）。 */
  std: number;
  /** 样本偏度。 */
  skew: number;
  /** 超额峰度（正态为 0）。 */
  excessKurtosis: number;
}

export function describe(xs: number[]): DescriptiveStats {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, std: 0, skew: 0, excessKurtosis: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, std: 0, skew: 0, excessKurtosis: 0 };
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  const variance = m2 / (n - 1);
  const std = Math.sqrt(variance);
  // 用总体矩计算偏度/峰度（更稳定），std 用样本口径。
  const popStd = Math.sqrt(m2 / n);
  const skew = popStd > 0 ? m3 / n / Math.pow(popStd, 3) : 0;
  const excessKurtosis = popStd > 0 ? m4 / n / Math.pow(popStd, 4) - 3 : 0;
  return { n, mean, std, skew, excessKurtosis };
}

// ── 风险调整指标 ──────────────────────────────────────────────────────────────

/** 逐笔 Sharpe（mean/std）。annualizationFactor 给定时乘以它（通常为 sqrt(每年交易数)）。 */
export function sharpeRatio(returns: number[], opts: { annualizationFactor?: number } = {}): number {
  const d = describe(returns);
  if (d.std === 0) return 0;
  const sr = d.mean / d.std;
  return opts.annualizationFactor ? sr * opts.annualizationFactor : sr;
}

/** 逐笔 Sortino（mean / 下行偏差），targetReturn 默认 0。 */
export function sortinoRatio(returns: number[], opts: { annualizationFactor?: number; targetReturn?: number } = {}): number {
  const target = opts.targetReturn ?? 0;
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  let downSq = 0;
  for (const r of returns) {
    if (r < target) downSq += (r - target) * (r - target);
  }
  const downDev = Math.sqrt(downSq / n);
  if (downDev === 0) return 0;
  const sr = (mean - target) / downDev;
  return opts.annualizationFactor ? sr * opts.annualizationFactor : sr;
}

/** 由逐笔收益率（%）构造等权复利净值曲线（起点 1.0）。 */
export function equityCurveFromReturns(returnsPct: number[]): number[] {
  const eq = [1];
  for (const r of returnsPct) eq.push(eq[eq.length - 1] * (1 + r / 100));
  return eq;
}

/** 最大回撤（以正分数返回，如 0.32 表示 -32%）。 */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export interface RiskMetrics {
  sharpe: number; // 逐笔
  sharpeAnnualized: number; // 年化（按每年交易数）
  sortino: number; // 逐笔
  calmarRatio: number; // 年化收益 / 最大回撤
  maxDrawdownPct: number; // 正数 %
  cagrPct: number; // 复合年化收益 %
}

/**
 * 由逐笔净收益序列（按时间升序）+ 每年交易数，算一组风险调整指标。
 * 净值曲线是"等权、逐笔串行复利"的近似（忽略并发持仓），用于快速度量风险，
 * 不等同于真实组合净值。
 */
export function tradeRiskMetrics(returnsPct: number[], opts: { tradesPerYear: number }): RiskMetrics {
  const n = returnsPct.length;
  if (n < 2) {
    return { sharpe: 0, sharpeAnnualized: 0, sortino: 0, calmarRatio: 0, maxDrawdownPct: 0, cagrPct: 0 };
  }
  const tradesPerYear = Math.max(1e-6, opts.tradesPerYear);
  const annFactor = Math.sqrt(tradesPerYear);
  const sharpe = sharpeRatio(returnsPct);
  const sortino = sortinoRatio(returnsPct);
  const equity = equityCurveFromReturns(returnsPct);
  const maxDd = maxDrawdown(equity);
  const finalEquity = equity[equity.length - 1];
  const years = n / tradesPerYear;
  const cagr = years > 0 && finalEquity > 0 ? Math.pow(finalEquity, 1 / years) - 1 : 0;
  const calmar = maxDd > 0 ? cagr / maxDd : 0;
  return {
    sharpe,
    sharpeAnnualized: sharpe * annFactor,
    sortino,
    calmarRatio: calmar,
    maxDrawdownPct: maxDd * 100,
    cagrPct: cagr * 100,
  };
}

// ── ATR 波动率目标仓位（risk parity / volatility targeting）────────────────────

export interface VolTargetResult {
  targetVolPct: number;
  /** 平均杠杆（仓位倍数）：>1 表示低波动票放大、<1 表示高波动票缩小。 */
  avgLeverage: number;
  /** 波动率目标化后的每笔均值（%，已按 1/ATR 调仓）。 */
  avgReturnPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
}

/**
 * 波动率目标仓位：按入场时 ATR% 反比调仓，使每笔交易承担近似相等的风险。
 * 这是顶级量化机构最普适的收益来源之一——不改买卖点，仅靠"低波动多下、高波动少下"
 * 改善风险调整后收益。每笔仓位倍数 L_i = clamp(targetVolPct / atrPct_i, min, max)，
 * 目标化后该笔贡献 = 原始收益 × L_i。
 * 入参 returnsPct 与 atrPctAtEntry 须按时间升序且一一对应。
 */
export function volTargetedStats(
  returnsPct: number[],
  atrPctAtEntry: number[],
  opts: { targetVolPct: number; minLeverage?: number; maxLeverage?: number },
): VolTargetResult {
  const n = returnsPct.length;
  const minLev = opts.minLeverage ?? 0.25;
  const maxLev = opts.maxLeverage ?? 3;
  if (n === 0) {
    return { targetVolPct: opts.targetVolPct, avgLeverage: 0, avgReturnPct: 0, sharpe: 0, sortino: 0, maxDrawdownPct: 0 };
  }
  const levered: number[] = new Array(n);
  let levSum = 0;
  for (let i = 0; i < n; i++) {
    const atr = atrPctAtEntry[i];
    const L = atr && atr > 0 ? Math.min(maxLev, Math.max(minLev, opts.targetVolPct / atr)) : 1;
    levSum += L;
    levered[i] = returnsPct[i] * L;
  }
  const avgReturnPct = levered.reduce((a, b) => a + b, 0) / n;
  const equity = equityCurveFromReturns(levered);
  return {
    targetVolPct: opts.targetVolPct,
    avgLeverage: levSum / n,
    avgReturnPct,
    sharpe: sharpeRatio(levered),
    sortino: sortinoRatio(levered),
    maxDrawdownPct: maxDrawdown(equity) * 100,
  };
}

// ── Probabilistic / Deflated Sharpe Ratio (López de Prado) ───────────────────

/**
 * PSR：在观察到的 Sharpe（逐笔、非年化）下，真实 Sharpe 超过 benchmarkSharpe 的概率。
 * 计入收益分布的偏度与峰度（非正态修正）。
 */
export function probabilisticSharpe(returns: number[], benchmarkSharpe = 0): number {
  const d = describe(returns);
  if (d.n < 2 || d.std === 0) return 0;
  const sr = d.mean / d.std;
  const denom = Math.sqrt(1 - d.skew * sr + ((d.excessKurtosis) / 4) * sr * sr);
  if (!isFinite(denom) || denom <= 0) return 0;
  const z = ((sr - benchmarkSharpe) * Math.sqrt(d.n - 1)) / denom;
  return normCdf(z);
}

export interface DeflatedSharpeResult {
  /** 观察到的逐笔 Sharpe。 */
  observedSharpe: number;
  /** 在 N 次试验下、纯靠运气可期望达到的最大 Sharpe（基准门槛）。 */
  expectedMaxSharpe: number;
  /** Deflated Sharpe Ratio：真实 Sharpe 超过该门槛的概率（0~1）。 */
  dsr: number;
  numTrials: number;
}

/**
 * Deflated Sharpe Ratio：用"试过 N 个策略"这一事实抬高基准门槛，再算 PSR。
 *
 * 期望最大 Sharpe（López de Prado, 2014）：
 *   E[max SR_N] ≈ sqrt(V) · [ (1-γ)·Φ⁻¹(1 - 1/N) + γ·Φ⁻¹(1 - 1/(N·e)) ]
 * 其中 γ 为 Euler–Mascheroni 常数。理想情况 V 是 N 个试验 Sharpe 的方差；当只能拿到
 * 单个策略时，用该 Sharpe 估计量自身的抽样方差作为保守代理（已在注释中说明此近似）。
 */
export function deflatedSharpe(returns: number[], numTrials: number): DeflatedSharpeResult {
  const d = describe(returns);
  const N = Math.max(1, Math.floor(numTrials));
  if (d.n < 2 || d.std === 0) {
    return { observedSharpe: 0, expectedMaxSharpe: 0, dsr: 0, numTrials: N };
  }
  const sr = d.mean / d.std;
  // Sharpe 估计量的抽样方差（作为试验间方差的保守代理）。
  const varSr = (1 - d.skew * sr + (d.excessKurtosis / 4) * sr * sr) / (d.n - 1);
  const sigmaSr = Math.sqrt(Math.max(0, varSr));
  let expectedMax = 0;
  if (N > 1 && sigmaSr > 0) {
    const term1 = (1 - EULER_MASCHERONI) * normInv(1 - 1 / N);
    const term2 = EULER_MASCHERONI * normInv(1 - 1 / (N * Math.E));
    expectedMax = sigmaSr * (term1 + term2);
  }
  const dsr = probabilisticSharpe(returns, expectedMax);
  return { observedSharpe: sr, expectedMaxSharpe: expectedMax, dsr, numTrials: N };
}

// ── Bootstrap 置信区间 ────────────────────────────────────────────────────────

/** mulberry32：确定性可复现的伪随机数发生器。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CI {
  point: number;
  lo: number;
  hi: number;
}

/** 通用 percentile bootstrap 置信区间（默认 2000 次、95%、固定种子可复现）。 */
export function bootstrapCI(
  values: number[],
  statFn: (xs: number[]) => number,
  opts: { iters?: number; alpha?: number; seed?: number } = {},
): CI {
  const point = statFn(values);
  const n = values.length;
  if (n < 2) return { point, lo: point, hi: point };
  const iters = opts.iters ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const rng = mulberry32(opts.seed ?? 12345);
  const stats: number[] = new Array(iters);
  const sample = new Array<number>(n);
  for (let b = 0; b < iters; b++) {
    for (let i = 0; i < n; i++) sample[i] = values[Math.floor(rng() * n)];
    stats[b] = statFn(sample);
  }
  stats.sort((a, b) => a - b);
  const loIdx = Math.max(0, Math.floor((alpha / 2) * iters));
  const hiIdx = Math.min(iters - 1, Math.ceil((1 - alpha / 2) * iters) - 1);
  return { point, lo: stats[loIdx], hi: stats[hiIdx] };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 每笔均值（%）的 bootstrap 95% CI。 */
export function meanCI(returnsPct: number[], opts: { iters?: number; alpha?: number; seed?: number } = {}): CI {
  return bootstrapCI(returnsPct, mean, opts);
}

/** 胜率（%）的 bootstrap 95% CI（胜=收益>0）。 */
export function winRateCI(returnsPct: number[], opts: { iters?: number; alpha?: number; seed?: number } = {}): CI {
  return bootstrapCI(returnsPct, (xs) => (xs.length ? (xs.filter((r) => r > 0).length / xs.length) * 100 : 0), opts);
}

// ── 多重检验校正 ──────────────────────────────────────────────────────────────

/** Bonferroni 校正后的单次显著性阈值：alpha / m。 */
export function bonferroniAlpha(alpha: number, m: number): number {
  return alpha / Math.max(1, m);
}

export interface BHResult {
  index: number;
  pValue: number;
  significant: boolean;
  /** BH 校正后的临界值 (rank/m)·alpha。 */
  critical: number;
}

/**
 * Benjamini-Hochberg（控制 FDR）。返回与输入同序的结果数组，标注每个是否显著。
 */
export function benjaminiHochberg(pValues: number[], alpha = 0.05): BHResult[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let maxK = -1;
  for (let k = 0; k < m; k++) {
    const crit = ((k + 1) / m) * alpha;
    if (order[k].p <= crit) maxK = k;
  }
  const sigSet = new Set<number>();
  for (let k = 0; k <= maxK; k++) sigSet.add(order[k].i);
  return pValues.map((p, i) => ({
    index: i,
    pValue: p,
    significant: sigSet.has(i),
    critical: 0, // 占位，下面填充
  })).map((r) => {
    const rank = order.findIndex((o) => o.i === r.index) + 1;
    return { ...r, critical: (rank / m) * alpha };
  });
}

// ── 协整 / 配对交易（统计套利）─────────────────────────────────────────────────

export interface OLSResult {
  slope: number;     // 斜率 β（对冲比例）
  intercept: number; // 截距 α
  residuals: number[];
}

/** 简单一元最小二乘回归 y = α + β·x，返回斜率/截距/残差。 */
export function ols(y: number[], x: number[]): OLSResult {
  const n = Math.min(y.length, x.length);
  if (n < 2) return { slope: 0, intercept: 0, residuals: [] };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    sxx += dx * dx;
    sxy += dx * (y[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) residuals.push(y[i] - (intercept + slope * x[i]));
  return { slope, intercept, residuals };
}

export interface ADFResult {
  /** Dickey-Fuller t 统计量（越负越平稳）。 */
  tStat: number;
  /** 是否在 5% 水平拒绝"含单位根"（即判定平稳）。 */
  stationary5pct: boolean;
  /** 用到的滞后阶数。 */
  lag: number;
}

/**
 * Augmented Dickey-Fuller 检验（常数项、无趋势），用于判定序列是否平稳。
 *
 * 回归 Δy_t = α + γ·y_{t-1} + Σ δ_i·Δy_{t-i} + ε，对 γ 做 t 检验。
 * t 越负越平稳；与 MacKinnon 近似临界值（常数项、无趋势）比较：5% ≈ -2.86。
 * 这是 Engle-Granger 两步法的第二步（对回归残差做 ADF），用来判定两序列是否协整。
 */
export function adfTest(series: number[], maxLag = 1): ADFResult {
  const n = series.length;
  // 需要足够样本：构造 Δy 与滞后项后仍要可回归。
  const lag = Math.max(0, Math.min(maxLag, Math.floor(n / 10)));
  const start = lag + 1;
  if (n < start + 8) return { tStat: 0, stationary5pct: false, lag };

  // 因变量 Δy_t；自变量：常数、y_{t-1}、Δy_{t-1..lag}。
  const Y: number[] = [];
  const X: number[][] = [];
  for (let t = start; t < n; t++) {
    Y.push(series[t] - series[t - 1]);
    const row = [1, series[t - 1]];
    for (let i = 1; i <= lag; i++) row.push(series[t - i] - series[t - i - 1]);
    X.push(row);
  }
  const k = X[0].length;
  const m = Y.length;
  // 正规方程 (XᵀX) b = Xᵀy，高斯消元解出系数与 (XᵀX)⁻¹ 对角元用于标准误。
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  for (let r = 0; r < m; r++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[r][a] * Y[r];
      for (let b = 0; b < k; b++) XtX[a][b] += X[r][a] * X[r][b];
    }
  }
  const inv = invertMatrix(XtX);
  if (!inv) return { tStat: 0, stationary5pct: false, lag };
  const beta = new Array(k).fill(0);
  for (let a = 0; a < k; a++) {
    let s = 0;
    for (let b = 0; b < k; b++) s += inv[a][b] * Xty[b];
    beta[a] = s;
  }
  // 残差方差与 γ（索引 1）的标准误。
  let sse = 0;
  for (let r = 0; r < m; r++) {
    let yhat = 0;
    for (let a = 0; a < k; a++) yhat += X[r][a] * beta[a];
    const e = Y[r] - yhat;
    sse += e * e;
  }
  const dof = Math.max(1, m - k);
  const sigma2 = sse / dof;
  const seGamma = Math.sqrt(Math.max(1e-12, sigma2 * inv[1][1]));
  const gamma = beta[1];
  const tStat = gamma / seGamma;
  return { tStat, stationary5pct: tStat < -2.86, lag };
}

/** 高斯-约当求逆；奇异返回 null。 */
function invertMatrix(a: number[][]): number[][] | null {
  const n = a.length;
  const M = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

/**
 * 价差均值回归的半衰期（Ornstein-Uhlenbeck 近似）：
 * 回归 Δspread_t = α + λ·spread_{t-1}，半衰期 = -ln(2)/λ（λ<0 才有意义）。
 * 半衰期越短，价差回归越快、配对越好交易。
 */
export function halfLife(spread: number[]): number {
  const n = spread.length;
  if (n < 3) return Infinity;
  const y: number[] = [];
  const x: number[] = [];
  for (let t = 1; t < n; t++) { y.push(spread[t] - spread[t - 1]); x.push(spread[t - 1]); }
  const { slope } = ols(y, x);
  if (slope >= 0) return Infinity; // 不回归
  return -Math.LN2 / slope;
}

export interface PearsonResult { r: number; }

/** 皮尔逊相关系数。 */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    saa += da * da; sbb += db * db; sab += da * db;
  }
  const denom = Math.sqrt(saa * sbb);
  return denom > 0 ? sab / denom : 0;
}
