/**
 * 统计套利 / 配对交易（市场中性）。
 *
 * 与本项目的趋势/突破内核**互补**：趋势跟随赌方向、吃单边；配对交易**不赌大盘方向**，
 * 赚的是两只「协整」标的之间价差的均值回归——这是国际机构（含量化对冲基金）的常用 alpha 源。
 *
 * 方法（Engle-Granger 两步 + z-score 阈值交易）：
 *  1. 选股：对候选两两组合，用对数价格做 OLS 求对冲比例 β，对残差(价差)做 ADF 平稳性检验；
 *     仅保留「协整（ADF 拒绝单位根）+ 相关性够高 + 半衰期合理」的配对。
 *  2. 交易：用滚动窗口把价差标准化为 z 分数；z 过低做多价差（多 A 空 B）、z 过高做空价差，
 *     回归到 0 附近平仓，z 突破止损阈值则止损（防协整破裂）。双腿都计手续费。
 *
 * 诚实边界：A 股**融券做空受限**，纯多空配对在实盘多数票上难落地——本模块定位为
 * 「研究/信号」与「可对冲品种（ETF/两融标的/期指成分）」的可行性验证，回测如实计双边成本，
 * 不夸大可投资性。协整是**样本内**性质，会破裂；故强制止损 + 半衰期/相关性过滤降低过拟合。
 */
import type { Candle } from "./types";
import { adfTest, ols, halfLife, pearson, describe } from "./stats";

export interface PairCandidate {
  a: string;
  b: string;
  /** 对冲比例 β（对数价格回归斜率）：1 股 A 对 β 股 B。 */
  beta: number;
  /** 残差(价差) ADF t 统计量，越负越平稳。 */
  adfT: number;
  cointegrated: boolean;
  correlation: number;
  /** 价差均值回归半衰期（交易日）。 */
  halfLifeDays: number;
  /** 对齐后的样本长度。 */
  n: number;
}

export interface PairTrade {
  side: "long-spread" | "short-spread"; // long-spread = 多A空B
  entryDate: string;
  exitDate: string;
  entryZ: number;
  exitZ: number;
  /** 价差口径净收益%（含两腿手续费），市场中性。 */
  returnPct: number;
  holdDays: number;
  exitReason: string;
}

export interface PairBacktestResult {
  pair: PairCandidate;
  trades: PairTrade[];
  totalTrades: number;
  wins: number;
  winRatePct: number;
  avgReturnPct: number;
  /** 全部交易等权串行复利的净值（市场中性收益曲线）。 */
  cumReturnPct: number;
  profitFactor: number;
}

export interface PairFindOptions {
  /** ADF 平稳临界（默认 -2.86，5% 水平）。 */
  adfCrit?: number;
  minCorrelation?: number; // 默认 0.7
  minHalfLife?: number;    // 默认 2 日（太快多为噪声/微观结构）
  maxHalfLife?: number;    // 默认 60 日（太慢资金占用久）
  minOverlap?: number;     // 默认 120 根
}

export interface PairTradeOptions {
  lookback?: number;   // z 分数滚动窗口，默认 60
  entryZ?: number;     // 入场阈值，默认 2.0
  exitZ?: number;      // 平仓阈值，默认 0.5
  stopZ?: number;      // 止损阈值（协整破裂），默认 3.5
  feeBps?: number;     // 单边单腿手续费 bps，默认 30
  maxHoldDays?: number; // 单次持有上限（防价差不回归），默认 120
}

interface Aligned {
  dates: string[];
  pa: number[]; // A 收盘
  pb: number[]; // B 收盘
}

/** 按日期对齐两只票的收盘价（取交集，按时间升序）。 */
function alignCloses(a: Candle[], b: Candle[]): Aligned {
  const mb = new Map<string, number>();
  for (const c of b) mb.set(c.date, c.close);
  const dates: string[] = [];
  const pa: number[] = [];
  const pb: number[] = [];
  const sortedA = [...a].sort((x, y) => (x.date < y.date ? -1 : 1));
  for (const c of sortedA) {
    const bc = mb.get(c.date);
    if (bc != null && c.close > 0 && bc > 0) {
      dates.push(c.date);
      pa.push(c.close);
      pb.push(bc);
    }
  }
  return { dates, pa, pb };
}

/** 评估单个配对（对数价格协整 + 相关性 + 半衰期）。 */
export function evaluatePair(
  aCode: string,
  bCode: string,
  aCandles: Candle[],
  bCandles: Candle[],
  opts: PairFindOptions = {},
): PairCandidate | null {
  const minOverlap = opts.minOverlap ?? 120;
  const al = alignCloses(aCandles, bCandles);
  if (al.dates.length < minOverlap) return null;
  const la = al.pa.map((x) => Math.log(x));
  const lb = al.pb.map((x) => Math.log(x));
  const { slope: beta, residuals } = ols(la, lb);
  const adf = adfTest(residuals, 1);
  const corr = pearson(la, lb);
  const hl = halfLife(residuals);
  const crit = opts.adfCrit ?? -2.86;
  return {
    a: aCode,
    b: bCode,
    beta,
    adfT: adf.tStat,
    cointegrated: adf.tStat < crit,
    correlation: corr,
    halfLifeDays: hl,
    n: al.dates.length,
  };
}

export interface PairAggStats {
  testedPairs: number;
  profitablePairs: number;
  totalTrades: number;
  winRatePct: number;
  avgReturnPct: number;
  /** 各配对组合复利的几何平均（等权分散到 N 个配对的近似）。 */
  portfolioCumPct: number;
}

export interface PairScanResult {
  universeSize: number;
  pairsTested: number;
  cointegratedCount: number;
  topPairs: PairCandidate[];
  /** 每个 Top 配对的单独回测（样本内，仅作机制展示）。 */
  topBacktests: PairBacktestResult[];
  inSample: PairAggStats;
  /** 样本外：前 trainFrac 选配对+定 β，后段交易（杜绝选样泄漏）。 */
  outOfSample: PairAggStats;
  note: string;
}

function aggregate(results: PairBacktestResult[]): PairAggStats {
  const used = results.filter((r) => r.totalTrades > 0);
  let trades = 0, wins = 0, retSum = 0, cum = 1, profitable = 0;
  for (const r of used) {
    trades += r.totalTrades;
    wins += r.wins;
    retSum += r.avgReturnPct * r.totalTrades;
    cum *= 1 + r.cumReturnPct / 100;
    if (r.cumReturnPct > 0) profitable++;
  }
  const geoMean = used.length > 0 ? Math.pow(cum, 1 / used.length) - 1 : 0;
  return {
    testedPairs: used.length,
    profitablePairs: profitable,
    totalTrades: trades,
    winRatePct: trades ? Number(((wins / trades) * 100).toFixed(1)) : 0,
    avgReturnPct: trades ? Number((retSum / trades).toFixed(2)) : 0,
    portfolioCumPct: Number((geoMean * 100).toFixed(2)),
  };
}

/**
 * 一站式配对扫描 + 回测（样本内 + 样本外）。candles 为已对齐前的原始 K 线 map。
 * 样本外用前 trainFrac 比例选配对/定 β，后段独立交易，杜绝选样泄漏——这是诚实评估的关键。
 */
export function runPairScan(
  candles: Record<string, Candle[]>,
  opts: { topN?: number; trainFrac?: number; find?: PairFindOptions; trade?: PairTradeOptions } = {},
): PairScanResult {
  const topN = opts.topN ?? 15;
  const trainFrac = opts.trainFrac ?? 0.6;
  const codes = Object.keys(candles);
  const pairs = findCointegratedPairs(candles, opts.find);
  const top = pairs.slice(0, topN);
  const topBacktests = top.map((p) => backtestPair(p, candles[p.a], candles[p.b], opts.trade));

  // 样本外：切分 → 训练段选配对 → 测试段交易。
  const train: Record<string, Candle[]> = {};
  const test: Record<string, Candle[]> = {};
  for (const [code, cs] of Object.entries(candles)) {
    const sorted = [...cs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const k = Math.floor(sorted.length * trainFrac);
    train[code] = sorted.slice(0, k);
    test[code] = sorted.slice(k);
  }
  const trainPairs = findCointegratedPairs(train, opts.find).slice(0, topN);
  const oosBacktests = trainPairs.map((p) => backtestPair(p, test[p.a], test[p.b], opts.trade));

  return {
    universeSize: codes.length,
    pairsTested: (codes.length * (codes.length - 1)) / 2,
    cointegratedCount: pairs.length,
    topPairs: top,
    topBacktests,
    inSample: aggregate(topBacktests),
    outOfSample: aggregate(oosBacktests),
    note: "样本内为同段选样+交易（含选样泄漏，仅作机制展示）；样本外为前段选配对+定β、后段独立交易。两者差距=过拟合程度。A股融券受限，纯多空难落地，仅供研究。",
  };
}

/** 在候选集合里两两搜索协整配对，按 ADF t（越负越好）排序返回合格者。 */
export function findCointegratedPairs(
  candles: Record<string, Candle[]>,
  opts: PairFindOptions = {},
): PairCandidate[] {
  const minCorr = opts.minCorrelation ?? 0.7;
  const minHL = opts.minHalfLife ?? 2;
  const maxHL = opts.maxHalfLife ?? 60;
  const codes = Object.keys(candles);
  const out: PairCandidate[] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const cand = evaluatePair(codes[i], codes[j], candles[codes[i]], candles[codes[j]], opts);
      if (!cand) continue;
      if (!cand.cointegrated) continue;
      if (cand.correlation < minCorr) continue;
      if (!(cand.halfLifeDays >= minHL && cand.halfLifeDays <= maxHL)) continue;
      out.push(cand);
    }
  }
  out.sort((x, y) => x.adfT - y.adfT);
  return out;
}

/**
 * 回测单个配对：滚动 z 分数阈值进出场，市场中性。
 * 价差 = log(A) - β·log(B)；z = (价差 - 滚动均值)/滚动标准差。
 * 收益口径：以「多 A 空 B」的等额对冲组合计，单次收益 ≈ 价差变化（对数差），双腿各计手续费。
 */
export function backtestPair(
  pair: PairCandidate,
  aCandles: Candle[],
  bCandles: Candle[],
  opts: PairTradeOptions = {},
): PairBacktestResult {
  const lookback = opts.lookback ?? 60;
  const entryZ = opts.entryZ ?? 2.0;
  const exitZ = opts.exitZ ?? 0.5;
  const stopZ = opts.stopZ ?? 3.5;
  const fee = (opts.feeBps ?? 30) / 10000;
  const maxHold = opts.maxHoldDays ?? 120;

  const al = alignCloses(aCandles, bCandles);
  const { dates, pa, pb } = al;
  const n = dates.length;
  const spread: number[] = [];
  for (let i = 0; i < n; i++) spread.push(Math.log(pa[i]) - pair.beta * Math.log(pb[i]));

  const trades: PairTrade[] = [];
  let pos: null | { side: "long-spread" | "short-spread"; entryIdx: number; entrySpread: number; entryZ: number } = null;

  const z = (i: number): number => {
    if (i < lookback) return NaN;
    const win = spread.slice(i - lookback, i);
    const d = describe(win);
    if (d.std <= 1e-9) return NaN;
    return (spread[i] - d.mean) / d.std;
  };

  for (let i = lookback; i < n; i++) {
    const zi = z(i);
    if (Number.isNaN(zi)) continue;

    if (!pos) {
      if (zi <= -entryZ) pos = { side: "long-spread", entryIdx: i, entrySpread: spread[i], entryZ: zi };
      else if (zi >= entryZ) pos = { side: "short-spread", entryIdx: i, entrySpread: spread[i], entryZ: zi };
      continue;
    }

    const hold = i - pos.entryIdx;
    const reverted = Math.abs(zi) <= exitZ;
    const stopped = Math.abs(zi) >= stopZ;
    const timedOut = hold >= maxHold;
    const lastBar = i === n - 1;
    if (reverted || stopped || timedOut || lastBar) {
      // 价差变化 → 多A空B 组合的对数收益；short-spread 取反。双腿各一次进/出手续费 → 4 腿 fee。
      const dSpread = spread[i] - pos.entrySpread;
      const gross = pos.side === "long-spread" ? dSpread : -dSpread;
      const net = gross - 4 * fee;
      trades.push({
        side: pos.side,
        entryDate: dates[pos.entryIdx],
        exitDate: dates[i],
        entryZ: Number(pos.entryZ.toFixed(2)),
        exitZ: Number(zi.toFixed(2)),
        returnPct: Number((net * 100).toFixed(2)),
        holdDays: hold,
        exitReason: reverted ? "价差回归平仓" : stopped ? "协整破裂止损" : timedOut ? "持有超时平仓" : "窗口末强制平仓",
      });
      pos = null;
    }
  }

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.returnPct > 0).length;
  const sumProfit = trades.filter((t) => t.returnPct > 0).reduce((s, t) => s + t.returnPct, 0);
  const sumLoss = trades.filter((t) => t.returnPct < 0).reduce((s, t) => s + Math.abs(t.returnPct), 0);
  const avg = totalTrades ? trades.reduce((s, t) => s + t.returnPct, 0) / totalTrades : 0;
  let cum = 1;
  for (const t of trades) cum *= 1 + t.returnPct / 100;
  return {
    pair,
    trades,
    totalTrades,
    wins,
    winRatePct: totalTrades ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0,
    avgReturnPct: Number(avg.toFixed(2)),
    cumReturnPct: Number(((cum - 1) * 100).toFixed(2)),
    profitFactor: sumLoss > 0 ? Number((sumProfit / sumLoss).toFixed(2)) : (sumProfit > 0 ? Infinity : 0),
  };
}
