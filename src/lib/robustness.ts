import type { Candle } from "@/lib/types";
import {
  backtestPair,
  evaluatePair,
  type PairCandidate,
  type PairTradeOptions,
} from "@/lib/pairTrading";

/**
 * v0.35 过拟合体检（稳健性可视化）。
 *
 * 把「过拟合防护 + 校准」做成显性卖点：对一个协整配对，给出两张证据图——
 *  1) 参数高原热图 paramPlateau：在 (入场阈 entryZ × z 窗口 lookback) 两维网格上扫描，
 *     每格跑一次全样本回测取净值/胜率。稳健策略的盈利区是一片连续「高原」，
 *     过拟合策略只有孤立「尖峰」（挪一格就崩）。
 *  2) Walk-forward 衰减曲线 walkForward：把历史切成 (folds+1) 段，逐段做
 *     「样本内(IS)选最优参 → 紧邻样本外(OOS)用同参验证」的滚动前推，
 *     画出 IS vs OOS 净值与样本外效率（OOS/IS），稳健策略的 OOS 不会塌。
 *
 * 全部基于既有 backtestPair / evaluatePair，零新依赖；产物均为统计信号、非投资建议。
 */

// ───────────────────── 参数网格（可被入参覆盖） ─────────────────────

const DEFAULT_ENTRY_GRID = [1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
const DEFAULT_LOOKBACK_GRID = [30, 45, 60, 90, 120];

// walk-forward 专用网格：样本内窗口较短，故 lookback 收窄以保证每段 IS 都能跑出交易。
const WF_ENTRY_GRID = [1.5, 2.0, 2.5, 3.0];
const WF_LOOKBACK_GRID = [20, 40, 60];

/** 单格回测结果（一组 entryZ × lookback）。 */
export interface PlateauCell {
  entryZ: number;
  lookback: number;
  cumReturnPct: number;
  winRatePct: number;
  trades: number;
  /** 是否有效（交易数达标）。 */
  valid: boolean;
}

export interface ParamPlateau {
  entryGrid: number[];
  lookbackGrid: number[];
  cells: PlateauCell[];
  /** 净值最高的有效格。 */
  best: PlateauCell | null;
  /** 有效格中盈利（净值>0）占比 %。越高越说明盈利区是一片高原。 */
  profitableCellPct: number;
  /** 最优格四邻（上下左右）净值相对最优的平均保留比（0~1，越高越「不挪就崩」=稳）。 */
  neighborRetention: number;
  /** 最小成交笔数门槛（低于此判为无效格）。 */
  minTrades: number;
}

// ───────────────────── 参数高原热图 ─────────────────────

export function paramPlateau(
  pair: PairCandidate,
  aCandles: Candle[],
  bCandles: Candle[],
  base: PairTradeOptions = {},
  entryGrid: number[] = DEFAULT_ENTRY_GRID,
  lookbackGrid: number[] = DEFAULT_LOOKBACK_GRID,
  minTrades = 3,
): ParamPlateau {
  const cells: PlateauCell[] = [];
  for (const lookback of lookbackGrid) {
    for (const entryZ of entryGrid) {
      const r = backtestPair(pair, aCandles, bCandles, {
        ...base,
        lookback,
        entryZ,
      });
      cells.push({
        entryZ,
        lookback,
        cumReturnPct: r.cumReturnPct,
        winRatePct: r.winRatePct,
        trades: r.totalTrades,
        valid: r.totalTrades >= minTrades,
      });
    }
  }

  const validCells = cells.filter((c) => c.valid);
  const best =
    validCells.length > 0
      ? validCells.reduce((a, b) => (b.cumReturnPct > a.cumReturnPct ? b : a))
      : null;
  const profitableCellPct =
    validCells.length > 0
      ? Number(
          ((validCells.filter((c) => c.cumReturnPct > 0).length / validCells.length) * 100).toFixed(1),
        )
      : 0;

  // 最优格四邻保留比：在网格坐标上取上下左右，看净值相对最优还剩多少（裁到 [0,1]）。
  let neighborRetention = 0;
  if (best && best.cumReturnPct > 0) {
    const ei = entryGrid.indexOf(best.entryZ);
    const li = lookbackGrid.indexOf(best.lookback);
    const at = (e: number, l: number): PlateauCell | undefined =>
      cells.find((c) => c.entryZ === entryGrid[e] && c.lookback === lookbackGrid[l]);
    const neigh: PlateauCell[] = [];
    if (ei > 0) { const c = at(ei - 1, li); if (c) neigh.push(c); }
    if (ei < entryGrid.length - 1) { const c = at(ei + 1, li); if (c) neigh.push(c); }
    if (li > 0) { const c = at(ei, li - 1); if (c) neigh.push(c); }
    if (li < lookbackGrid.length - 1) { const c = at(ei, li + 1); if (c) neigh.push(c); }
    if (neigh.length > 0) {
      const ratios = neigh.map((c) => Math.max(0, Math.min(1, c.cumReturnPct / best.cumReturnPct)));
      neighborRetention = Number((ratios.reduce((s, r) => s + r, 0) / ratios.length).toFixed(2));
    }
  }

  return {
    entryGrid,
    lookbackGrid,
    cells,
    best,
    profitableCellPct,
    neighborRetention,
    minTrades,
  };
}

// ───────────────────── Walk-forward 滚动前推 ─────────────────────

export interface WalkForwardFold {
  idx: number;
  /** 样本内/样本外日期边界。 */
  isStart: string;
  isEnd: string;
  oosStart: string;
  oosEnd: string;
  /** 样本内选出的最优参。 */
  bestEntryZ: number;
  bestLookback: number;
  /** 样本内净值/胜率/笔数。 */
  isCumPct: number;
  isWinPct: number;
  isTrades: number;
  /** 同参在样本外的净值/胜率/笔数。 */
  oosCumPct: number;
  oosWinPct: number;
  oosTrades: number;
  /** 样本外效率：oosCum/isCum（IS>0 时），裁到 [-1,2]。 */
  efficiency: number | null;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** 各 fold 样本外效率中位数（IS 盈利的 fold）。 */
  medianEfficiency: number | null;
  isAvgCumPct: number;
  oosAvgCumPct: number;
  /** 样本外为正的 fold 占比 %。 */
  oosPositivePct: number;
}

/** 按日期升序对齐两腿的共同交易日（用于切窗）。 */
function commonDates(a: Candle[], b: Candle[]): string[] {
  const sb = new Set(b.map((c) => c.date));
  return a
    .filter((c) => sb.has(c.date) && c.close > 0)
    .map((c) => c.date)
    .sort();
}

const sliceByDate = (cs: Candle[], lo: string, hi: string): Candle[] =>
  cs.filter((c) => c.date >= lo && c.date <= hi);

export function walkForward(
  pair: PairCandidate,
  aCandles: Candle[],
  bCandles: Candle[],
  base: PairTradeOptions = {},
  folds = 4,
  entryGrid: number[] = WF_ENTRY_GRID,
  lookbackGrid: number[] = WF_LOOKBACK_GRID,
): WalkForwardResult {
  const dates = commonDates(aCandles, bCandles);
  const n = dates.length;
  const segCount = folds + 1;
  const empty: WalkForwardResult = {
    folds: [],
    medianEfficiency: null,
    isAvgCumPct: 0,
    oosAvgCumPct: 0,
    oosPositivePct: 0,
  };
  // 每段至少要能容纳最大 lookback + 若干交易；否则不做 WFO。
  const maxLb = Math.max(...lookbackGrid);
  if (n < segCount * (maxLb + 20)) return empty;
  // 样本外窗口最少交易日（warmup 由前序 IS 借入，故此处只要求够开几笔）。
  const MIN_OOS_BARS = 20;

  const segLen = Math.floor(n / segCount);
  const out: WalkForwardFold[] = [];

  for (let k = 0; k < folds; k++) {
    // 锚定式扩张：IS = [0, segEnd)，OOS = [segEnd, segEnd+segLen)。
    const isEndIdx = segLen * (k + 1);
    const oosEndIdx = Math.min(n, isEndIdx + segLen);
    if (oosEndIdx - isEndIdx < MIN_OOS_BARS) continue;

    const isStartDate = dates[0];
    const isEndDate = dates[isEndIdx - 1];
    // OOS 切窗带 maxLb 根预热（用于滚动 z），但只统计 entryDate ≥ oosStart 的交易。
    const warmupIdx = Math.max(0, isEndIdx - maxLb);
    const oosWarmDate = dates[warmupIdx];
    const oosStartDate = dates[isEndIdx];
    const oosEndDate = dates[oosEndIdx - 1];

    const isA = sliceByDate(aCandles, isStartDate, isEndDate);
    const isB = sliceByDate(bCandles, isStartDate, isEndDate);
    // 样本内重估 β（真前推：不偷看未来），失败则沿用全样本 pair。
    const isPair = evaluatePair(pair.a, pair.b, isA, isB, { minOverlap: 60 }) ?? pair;

    // 样本内网格寻优：取净值最高且交易≥3 的参；都不达标则取交易最多的。
    let bestCell: { entryZ: number; lookback: number; cum: number; win: number; trades: number } | null = null;
    for (const lookback of lookbackGrid) {
      for (const entryZ of entryGrid) {
        const r = backtestPair(isPair, isA, isB, { ...base, lookback, entryZ });
        const cand = { entryZ, lookback, cum: r.cumReturnPct, win: r.winRatePct, trades: r.totalTrades };
        if (!bestCell) { bestCell = cand; continue; }
        const candOk = cand.trades >= 3;
        const bestOk = bestCell.trades >= 3;
        if (candOk && !bestOk) bestCell = cand;
        else if (candOk === bestOk && cand.cum > bestCell.cum) bestCell = cand;
      }
    }
    if (!bestCell) continue;

    // 样本外：用 IS 选出的参 + IS 估的 β，在 OOS 窗（含预热）回测，只数 oosStart 之后开仓的交易。
    const oosA = sliceByDate(aCandles, oosWarmDate, oosEndDate);
    const oosB = sliceByDate(bCandles, oosWarmDate, oosEndDate);
    const oosBt = backtestPair(isPair, oosA, oosB, {
      ...base,
      lookback: bestCell.lookback,
      entryZ: bestCell.entryZ,
    });
    const oosTrades = oosBt.trades.filter((t) => t.entryDate >= oosStartDate);
    const oosWins = oosTrades.filter((t) => t.returnPct > 0).length;
    let oosCum = 1;
    for (const t of oosTrades) oosCum *= 1 + t.returnPct / 100;
    const oosCumPct = Number(((oosCum - 1) * 100).toFixed(2));
    const oosWinPct = oosTrades.length ? Number(((oosWins / oosTrades.length) * 100).toFixed(1)) : 0;

    const efficiency =
      bestCell.cum > 0
        ? Number(Math.max(-1, Math.min(2, oosCumPct / bestCell.cum)).toFixed(2))
        : null;

    out.push({
      idx: k + 1,
      isStart: isStartDate,
      isEnd: isEndDate,
      oosStart: oosStartDate,
      oosEnd: oosEndDate,
      bestEntryZ: bestCell.entryZ,
      bestLookback: bestCell.lookback,
      isCumPct: bestCell.cum,
      isWinPct: bestCell.win,
      isTrades: bestCell.trades,
      oosCumPct,
      oosWinPct,
      oosTrades: oosTrades.length,
      efficiency,
    });
  }

  if (out.length === 0) return empty;

  const effs = out.map((f) => f.efficiency).filter((e): e is number => e != null).sort((a, b) => a - b);
  const medianEfficiency =
    effs.length > 0
      ? effs.length % 2
        ? effs[(effs.length - 1) / 2]
        : Number(((effs[effs.length / 2 - 1] + effs[effs.length / 2]) / 2).toFixed(2))
      : null;
  const isAvgCumPct = Number((out.reduce((s, f) => s + f.isCumPct, 0) / out.length).toFixed(2));
  const oosAvgCumPct = Number((out.reduce((s, f) => s + f.oosCumPct, 0) / out.length).toFixed(2));
  const oosPositivePct = Number(((out.filter((f) => f.oosCumPct > 0).length / out.length) * 100).toFixed(1));

  return { folds: out, medianEfficiency, isAvgCumPct, oosAvgCumPct, oosPositivePct };
}

// ───────────────────── 综合体检结论 ─────────────────────

export type RobustnessGrade = "robust" | "fragile" | "overfit";

export interface RobustnessReport {
  pair: PairCandidate;
  base: Required<Pick<PairTradeOptions, "exitZ" | "stopZ" | "feeBps" | "maxHoldDays">>;
  plateau: ParamPlateau;
  wf: WalkForwardResult;
  grade: RobustnessGrade;
  /** 0~100 稳健分（越高越不像过拟合）。 */
  score: number;
  reasons: string[];
}

/**
 * 综合稳健分：参数高原盈利占比(35%) + 最优格邻域保留(20%) +
 * 样本外效率(30%) + 样本外为正占比(15%)。
 */
export function robustnessReport(
  pair: PairCandidate,
  aCandles: Candle[],
  bCandles: Candle[],
  opts: PairTradeOptions = {},
): RobustnessReport {
  const base: Required<Pick<PairTradeOptions, "exitZ" | "stopZ" | "feeBps" | "maxHoldDays">> = {
    exitZ: opts.exitZ ?? 0.5,
    stopZ: opts.stopZ ?? 3.5,
    feeBps: opts.feeBps ?? 30,
    maxHoldDays: opts.maxHoldDays ?? 120,
  };
  const plateau = paramPlateau(pair, aCandles, bCandles, base);
  const wf = walkForward(pair, aCandles, bCandles, base);

  const plateauScore = plateau.profitableCellPct; // 0~100
  const retentionScore = plateau.neighborRetention * 100; // 0~100
  const effRaw = wf.medianEfficiency; // 可能 null
  const effScore = effRaw == null ? 40 : Math.max(0, Math.min(100, effRaw * 60)); // eff=1→60,1.67→100
  const oosPosScore = wf.oosPositivePct; // 0~100

  const score = Number(
    Math.max(
      0,
      Math.min(100, plateauScore * 0.35 + retentionScore * 0.2 + effScore * 0.3 + oosPosScore * 0.15),
    ).toFixed(1),
  );

  const reasons: string[] = [];
  reasons.push(`参数高原盈利格 ${plateau.profitableCellPct}%（${plateau.cells.filter((c) => c.valid).length} 个有效格）`);
  reasons.push(`最优格邻域净值保留 ${(plateau.neighborRetention * 100).toFixed(0)}%`);
  if (wf.folds.length > 0) {
    reasons.push(
      `Walk-forward ${wf.folds.length} 段：样本外效率中位 ${wf.medianEfficiency == null ? "—" : wf.medianEfficiency}，样本外为正 ${wf.oosPositivePct}%（IS均值 ${wf.isAvgCumPct}% → OOS均值 ${wf.oosAvgCumPct}%）`,
    );
  } else {
    reasons.push("Walk-forward 样本不足（历史过短，未做滚动前推）");
  }

  let grade: RobustnessGrade;
  if (score >= 65 && plateau.profitableCellPct >= 55 && wf.oosAvgCumPct >= 0) grade = "robust";
  else if (score < 40 || (wf.isAvgCumPct > 0 && wf.oosAvgCumPct < 0)) grade = "overfit";
  else grade = "fragile";

  return { pair, base, plateau, wf, grade, score, reasons };
}
