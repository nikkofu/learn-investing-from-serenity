import type { Candle } from "./types";
import { rankNormalize, type PortfolioScorer } from "./portfolioBacktest";

/**
 * 横截面动量 / 行业轮动打分（v0.31）。
 *
 * 与 portfolioBacktest.ts 互补：这里只负责**截面打分**（个股动量因子合成 +
 * 行业动量聚合），把排名结果以 PortfolioScorer 回调形式喂给组合回测引擎，
 * 复用其等权轮动 / 手续费 / A 股涨跌停撮合约束，天然**纯多头**（只买不卖空）。
 *
 * 避免未来函数：所有因子只读「截至打分日的历史 K 线」（回测引擎已保证传入的
 * view.history 严格早于再平衡日），不引入任何当日才知道的信息。
 */

// ── 因子窗口（交易日）──────────────────────────────────────────────────────
const W_1M = 20; // 近 1 月
const W_3M = 60; // 近 3 月
const W_6M = 120; // 近 6 月
const W_12M = 250; // 近 12 月（约 250 个交易日）
const SKIP_1M = 20; // 12-1 动量跳过最近 1 月（反转效应）
const VOL_W = 60; // 波动率窗口
const MA_W = 60; // 趋势均线窗口
/** 至少需要 3 个月历史才参与打分（否则核心动量缺失）。 */
const MIN_BARS = W_3M + 1;

/** 各动量因子的合成权重（合计应为 1）。 */
export interface MomentumWeights {
  /** 近 1 月收益。 */
  r1m: number;
  /** 近 3 月收益。 */
  r3m: number;
  /** 近 6 月收益。 */
  r6m: number;
  /** 12-1 动量（跳过最近 1 月，规避短期反转）。 */
  skip: number;
  /** 风险调整动量 = 近 3 月收益 / 年化波动。 */
  riskAdj: number;
  /** 趋势 = 现价 / MA60 − 1。 */
  trend: number;
}

/** 默认权重：以中期动量为主、辅以风险调整与趋势确认。 */
export const DEFAULT_MOMENTUM_WEIGHTS: MomentumWeights = {
  r1m: 0.15,
  r3m: 0.3,
  r6m: 0.25,
  skip: 0.1,
  riskAdj: 0.1,
  trend: 0.1,
};

/** 单只标的的原始动量因子（缺失记 null）。 */
export interface MomentumFactors {
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  skip: number | null;
  /** 年化波动率（日收益标准差 × √252）。 */
  vol: number | null;
  /** 风险调整动量 = r3m / vol。 */
  riskAdj: number | null;
  /** 趋势 = 现价 / MA60 − 1。 */
  trend: number | null;
}

/** 截面打分结果（含原始因子与合成分）。 */
export interface ScoredStock {
  code: string;
  name: string;
  /** 合成动量分（截面百分位加权，[0,1]，越大越强）。 */
  composite: number;
  factors: MomentumFactors;
}

function ret(h: Candle[], lookback: number): number | null {
  const n = h.length;
  if (n <= lookback) return null;
  const last = h[n - 1].close;
  const past = h[n - 1 - lookback].close;
  return past > 0 ? last / past - 1 : null;
}

function annualizedVol(h: Candle[], window: number): number | null {
  const n = h.length;
  if (n <= window) return null;
  const rets: number[] = [];
  for (let i = n - window; i < n; i++) {
    const prev = h[i - 1].close;
    if (prev > 0) rets.push(h[i].close / prev - 1);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? sd * Math.sqrt(252) : null;
}

/** 计算单只标的的动量因子；历史不足 MIN_BARS 返回 null。 */
export function computeMomentumFactors(history: Candle[]): MomentumFactors | null {
  if (history.length < MIN_BARS) return null;
  const r3m = ret(history, W_3M);
  if (r3m === null) return null; // 核心动量缺失则不参与
  const vol = annualizedVol(history, VOL_W);
  // 12-1 动量：close[-(SKIP_1M)] / close[-W_12M] − 1。
  let skip: number | null = null;
  const n = history.length;
  if (n > W_12M) {
    const recent = history[n - 1 - SKIP_1M].close;
    const past = history[n - 1 - W_12M].close;
    skip = past > 0 ? recent / past - 1 : null;
  }
  // 趋势：现价 / MA60 − 1。
  const maWindow = history.slice(-MA_W);
  const ma = maWindow.reduce((s, k) => s + k.close, 0) / maWindow.length;
  const last = history[n - 1].close;
  const trend = ma > 0 ? last / ma - 1 : null;
  return {
    r1m: ret(history, W_1M),
    r3m,
    r6m: ret(history, W_6M),
    skip,
    vol,
    riskAdj: vol && vol > 0 && r3m !== null ? r3m / vol : null,
    trend,
  };
}

/**
 * 截面动量打分：对一组标的逐因子做排名归一化（[0,1]，缺失记 0），按权重合成，
 * 返回**从优到劣排序**的列表（含原始因子，便于 UI 展示）。
 */
export function scoreCrossSection(
  view: Array<{ code: string; name: string; history: Candle[] }>,
  weights: MomentumWeights = DEFAULT_MOMENTUM_WEIGHTS,
): ScoredStock[] {
  const eligible: Array<{ code: string; name: string; factors: MomentumFactors }> = [];
  for (const v of view) {
    const factors = computeMomentumFactors(v.history);
    if (factors) eligible.push({ code: v.code, name: v.name, factors });
  }
  if (eligible.length === 0) return [];
  const rR1m = rankNormalize(eligible.map((e) => e.factors.r1m));
  const rR3m = rankNormalize(eligible.map((e) => e.factors.r3m));
  const rR6m = rankNormalize(eligible.map((e) => e.factors.r6m));
  const rSkip = rankNormalize(eligible.map((e) => e.factors.skip));
  const rRisk = rankNormalize(eligible.map((e) => e.factors.riskAdj));
  const rTrend = rankNormalize(eligible.map((e) => e.factors.trend));
  return eligible
    .map((e, i) => ({
      code: e.code,
      name: e.name,
      factors: e.factors,
      composite:
        weights.r1m * rR1m[i] +
        weights.r3m * rR3m[i] +
        weights.r6m * rR6m[i] +
        weights.skip * rSkip[i] +
        weights.riskAdj * rRisk[i] +
        weights.trend * rTrend[i],
    }))
    .sort((a, b) => b.composite - a.composite);
}

/**
 * 个股动量打分器：注入组合回测引擎，按合成动量分截面排名返回候选代码（纯多头）。
 */
export function momentumScorer(weights: MomentumWeights = DEFAULT_MOMENTUM_WEIGHTS): PortfolioScorer {
  return (_asOf, view) => scoreCrossSection(view, weights).map((s) => s.code);
}

// ── 行业轮动 ────────────────────────────────────────────────────────────────
/** 一个板块及其成分股（历史 K 线）。 */
export interface SectorConstituents {
  code: string;
  name: string;
  stocks: Array<{ code: string; name: string; history: Candle[] }>;
}

/** 板块动量聚合结果。 */
export interface SectorMomentum {
  code: string;
  name: string;
  /** 参与打分的成分股数（历史充足者）。 */
  stockCount: number;
  /** 板块合成动量 = 成分股合成分均值（[0,1]）。 */
  avgComposite: number;
  /** 宽度：近 3 月收益为正的成分股占比 %。 */
  breadthPct: number;
  /** 成分股近 3 月收益均值 %。 */
  avgR3mPct: number;
  /** 板块内动量最强的若干只（默认 3）。 */
  topStocks: Array<{ code: string; name: string; composite: number }>;
}

/**
 * 行业轮动信号：把所有板块成分股放入**同一截面**打分（保证百分位口径一致），
 * 再按板块聚合（均值合成分 + 宽度 + 近 3 月收益均值），返回从强到弱排序。
 */
export function rankSectors(
  sectors: SectorConstituents[],
  weights: MomentumWeights = DEFAULT_MOMENTUM_WEIGHTS,
  topStocksPerSector = 3,
): SectorMomentum[] {
  // 1) 全市场池去重打分（同一截面）。
  const pool = new Map<string, { code: string; name: string; history: Candle[] }>();
  for (const sec of sectors) {
    for (const s of sec.stocks) {
      if (!pool.has(s.code)) pool.set(s.code, s);
    }
  }
  const scored = scoreCrossSection([...pool.values()], weights);
  const byCode = new Map(scored.map((s) => [s.code, s]));

  // 2) 按板块聚合。
  const out: SectorMomentum[] = [];
  for (const sec of sectors) {
    const members: ScoredStock[] = [];
    for (const s of sec.stocks) {
      const sc = byCode.get(s.code);
      if (sc) members.push(sc);
    }
    if (members.length === 0) continue;
    const avgComposite = members.reduce((acc, m) => acc + m.composite, 0) / members.length;
    const r3ms = members.map((m) => m.factors.r3m).filter((v): v is number => v !== null);
    const breadthPct = r3ms.length > 0 ? (r3ms.filter((v) => v > 0).length / r3ms.length) * 100 : 0;
    const avgR3mPct = r3ms.length > 0 ? (r3ms.reduce((s, v) => s + v, 0) / r3ms.length) * 100 : 0;
    const topStocks = [...members]
      .sort((a, b) => b.composite - a.composite)
      .slice(0, topStocksPerSector)
      .map((m) => ({ code: m.code, name: m.name, composite: m.composite }));
    out.push({
      code: sec.code,
      name: sec.name,
      stockCount: members.length,
      avgComposite,
      breadthPct,
      avgR3mPct,
      topStocks,
    });
  }
  return out.sort((a, b) => b.avgComposite - a.avgComposite);
}

/**
 * 行业轮动打分器：每个再平衡日先按板块动量选出 top-K 板块，再在这些板块内
 * 按个股合成动量排序返回候选（纯多头）。需传入 code→板块 的映射。
 */
export function sectorRotationScorer(opts: {
  /** 代码 → 所属板块（用于把个股归并到板块）。 */
  codeToSector: Map<string, { code: string; name: string }>;
  /** 选取动量最强的前几个板块，默认 3。 */
  topSectors?: number;
  weights?: MomentumWeights;
}): PortfolioScorer {
  const topSectors = Math.max(1, opts.topSectors ?? 3);
  const weights = opts.weights ?? DEFAULT_MOMENTUM_WEIGHTS;
  return (_asOf, view) => {
    const scored = scoreCrossSection(view, weights);
    if (scored.length === 0) return [];
    // 聚合到板块（均值合成分）。
    const agg = new Map<string, { name: string; sum: number; n: number }>();
    for (const s of scored) {
      const sec = opts.codeToSector.get(s.code);
      if (!sec) continue;
      const cur = agg.get(sec.code) ?? { name: sec.name, sum: 0, n: 0 };
      cur.sum += s.composite;
      cur.n += 1;
      agg.set(sec.code, cur);
    }
    const rankedSectors = [...agg.entries()]
      .map(([code, v]) => ({ code, avg: v.sum / v.n }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, topSectors);
    const keepSectors = new Set(rankedSectors.map((s) => s.code));
    // 只保留 top-K 板块内的个股，按合成分排序。
    return scored
      .filter((s) => {
        const sec = opts.codeToSector.get(s.code);
        return sec ? keepSectors.has(sec.code) : false;
      })
      .map((s) => s.code);
  };
}
