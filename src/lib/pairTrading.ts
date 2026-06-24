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
import { roundTripCostPct } from "./costs";

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

// ───────────────────── 套利雷达（实时机会捕捉） ─────────────────────

export interface ArbSignal {
  pair: PairCandidate;
  /** 价差当前 z 分数（基于最后一根滚动窗口）。 */
  z: number;
  /** 当前是否开口：long-spread=多A空B（价差偏低待回升），short-spread=空A多B（价差偏高待回落）。 */
  side: "long-spread" | "short-spread";
  /** 当前价差（log A - β·log B）。 */
  spread: number;
  /** 偏离绝对值（|z|），雷达排序主键之一。 */
  deviation: number;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  /** 是否已逼近/越过止损阈（协整可能破裂，风险高）。 */
  nearStop: boolean;
  /** 基于半衰期的预计回归天数：halfLife·log2(|z|/exitZ)，夹到 [1, maxHold]。 */
  expectedRevertDays: number;
  /** 该机会近一段的价差序列（供前端画 sparkline）。 */
  spreadSeries: number[];
  /** 对应日期序列（与 spreadSeries 等长）。 */
  dateSeries: string[];
  /** 信号成立的最后交易日。 */
  asOf: string;
  /** 综合分：|z| 偏离 × 协整强度（|adfT|），用于雷达排序。 */
  rank: number;
  /** 价差口径预估单次净收益%（z 回到 exitZ，扣 4 腿费）。 */
  estNetPct: number;
  /**
   * 单边可执行化：相对其协整伙伴被「低估」的那一只 —— 对应「逢低分批布局」买入择时。
   * （A 股主板无融券，配对不再作对冲两腿，只取可单边执行的那条。）
   */
  buyCode: string;
  /** 相对被「高估」的那一只 —— 对应「减仓/规避」信号（持有者用，非建仓）。 */
  deRiskCode: string;
}

/**
 * 计算单个配对「当前」是否存在开口的套利机会（最后一根的滚动 z 偏离）。
 * 与 backtestPair 同口径（同样的滚动窗口/价差定义），但只看最新一根：
 *   |z| ≥ entryZ → 价差显著偏离，存在均值回归机会；否则返回 null（无开口）。
 */
export function currentArbSignal(
  pair: PairCandidate,
  aCandles: Candle[],
  bCandles: Candle[],
  opts: PairTradeOptions = {},
): ArbSignal | null {
  const lookback = opts.lookback ?? 60;
  const entryZ = opts.entryZ ?? 2.0;
  const exitZ = opts.exitZ ?? 0.5;
  const stopZ = opts.stopZ ?? 3.5;
  const fee = (opts.feeBps ?? 30) / 10000;
  const maxHold = opts.maxHoldDays ?? 120;

  const al = alignCloses(aCandles, bCandles);
  const { dates, pa, pb } = al;
  const n = dates.length;
  if (n <= lookback) return null;

  const spread: number[] = [];
  for (let i = 0; i < n; i++) spread.push(Math.log(pa[i]) - pair.beta * Math.log(pb[i]));

  const i = n - 1;
  const win = spread.slice(i - lookback, i);
  const d = describe(win);
  if (d.std <= 1e-9) return null;
  const z = (spread[i] - d.mean) / d.std;
  const az = Math.abs(z);
  if (az < entryZ) return null;

  // z<=0 ⇒ 价差偏低 ⇒ A 相对 B 被低估 ⇒ 买 A、规避 B；z>0 反之。
  const side: "long-spread" | "short-spread" = z <= 0 ? "long-spread" : "short-spread";
  const buyCode = side === "long-spread" ? pair.a : pair.b;
  const deRiskCode = side === "long-spread" ? pair.b : pair.a;
  const expectedRevertDays = Math.max(
    1,
    Math.min(maxHold, Math.round(pair.halfLifeDays * Math.log2(Math.max(az, exitZ + 1e-9) / exitZ))),
  );
  // 预估净收益：z 由当前回到 exitZ，价差变化 ≈ (|z|-exitZ)·std；扣 4 腿手续费。
  const grossPct = (az - exitZ) * d.std;
  const estNetPct = Number(((grossPct - 4 * fee) * 100).toFixed(2));
  const tail = Math.min(lookback, 90);

  return {
    pair,
    z: Number(z.toFixed(2)),
    side,
    spread: Number(spread[i].toFixed(4)),
    deviation: Number(az.toFixed(2)),
    entryZ,
    exitZ,
    stopZ,
    nearStop: az >= stopZ,
    expectedRevertDays,
    spreadSeries: spread.slice(n - tail).map((x) => Number(x.toFixed(4))),
    dateSeries: dates.slice(n - tail),
    asOf: dates[i],
    rank: Number((az * Math.abs(pair.adfT)).toFixed(2)),
    estNetPct,
    buyCode,
    deRiskCode,
  };
}

export interface ArbRadarResult {
  universeSize: number;
  pairsTested: number;
  cointegratedCount: number;
  /** 当前开口的套利机会（|z|≥entryZ），按综合分降序。 */
  signals: ArbSignal[];
  asOf: string | null;
  note: string;
}

/**
 * 套利雷达：在候选股票池里全两两协整扫描，挑出「当前正开口」的价差机会并排序。
 * 这是把样本内研究引擎升级为实时捕捉工具——只报当下可行动的偏离，附方向/进出止损/预计回归天数。
 */
export function scanArbRadar(
  candles: Record<string, Candle[]>,
  opts: { find?: PairFindOptions; trade?: PairTradeOptions; maxSignals?: number } = {},
): ArbRadarResult {
  const codes = Object.keys(candles);
  const pairs = findCointegratedPairs(candles, opts.find);
  const signals: ArbSignal[] = [];
  for (const p of pairs) {
    const sig = currentArbSignal(p, candles[p.a], candles[p.b], opts.trade);
    if (sig) signals.push(sig);
  }
  signals.sort((x, y) => y.rank - x.rank);
  const limited = signals.slice(0, opts.maxSignals ?? 50);
  let asOf: string | null = null;
  for (const cs of Object.values(candles)) {
    const last = cs.length ? cs[cs.length - 1].date : null;
    if (last && (!asOf || last > asOf)) asOf = last;
  }
  return {
    universeSize: codes.length,
    pairsTested: (codes.length * (codes.length - 1)) / 2,
    cointegratedCount: pairs.length,
    signals: limited,
    asOf,
    note: "仅列出当前价差已开口（|z|≥入场阈）的协整配对机会，按 |z|×协整强度排序。预计回归天数=半衰期·log2(|z|/出场阈)。A股融券受限，纯多空难落地，请优先选两融/ETF 可对冲品种；收益为价差口径、已扣双边成本估算，仅供研究。",
  };
}

// ───────────────────── 信号回测校准（事后验证，单边口径） ─────────────────────

/**
 * 单条历史信号的事后结果（单边可执行口径）：
 * 在某根 |z|≥entryZ 开口时买入「被低估」的那一只（buyCode），持有到价差回归/止损/超时，
 * 记录这一笔单边买入的真实净收益（扣单边往返成本）、回归与否、最大逆向 z 等。
 */
export interface SignalEvent {
  entryDate: string;
  exitDate: string;
  /** 该笔实际买入（被低估）的那一只。 */
  buyCode: string;
  /** 进场时的 z（带符号）。 */
  entryZ: number;
  /** 出场时的 z（带符号）。 */
  exitZ: number;
  /** 持有期内出现过的最大 |z|（逆向最深，衡量回归前还能扛多少偏离）。 */
  maxAdverseZ: number;
  holdDays: number;
  /** 是否由「价差回归」平仓（=信号兑现）。 */
  reverted: boolean;
  exitReason: string;
  /** 单边买入腿的真实净收益%（扣一次单边买卖往返成本）。 */
  legReturnPct: number;
  /** 同上但未扣成本（毛收益%）。 */
  legReturnGrossPct: number;
}

/** 单个配对在全历史上的信号校准统计（单边口径）。 */
export interface PairCalibration {
  pair: PairCandidate;
  events: SignalEvent[];
  /** 历史触发的开口信号次数。 */
  signals: number;
  /** 其中由价差回归兑现的次数。 */
  reversions: number;
  reversionRatePct: number;
  /** 协整破裂止损次数。 */
  stopouts: number;
  /** 超时未回归次数。 */
  timeouts: number;
  /** 已回归信号的平均持有天数。 */
  avgRevertDays: number;
  /** 单边买入腿平均净收益%（覆盖全部信号）。 */
  avgLegReturnPct: number;
  /** 单边买入腿胜率%（净收益>0 占比）。 */
  legWinRatePct: number;
  /** 持有期平均最大逆向 |z|。 */
  avgMaxAdverseZ: number;
}

/**
 * 对单个配对做全历史信号校准：滚动 z 同 backtestPair 口径，逐笔记录开口→出场的单边结果。
 * 单边收益 = 买入「被低估」腿（z≤0 买 A、z>0 买 B）从进场到出场的真实价格涨跌，扣单边往返成本。
 */
export function calibratePair(
  pair: PairCandidate,
  aCandles: Candle[],
  bCandles: Candle[],
  opts: PairTradeOptions = {},
): PairCalibration {
  const lookback = opts.lookback ?? 60;
  const entryZ = opts.entryZ ?? 2.0;
  const exitZ = opts.exitZ ?? 0.5;
  const stopZ = opts.stopZ ?? 3.5;
  const maxHold = opts.maxHoldDays ?? 120;
  const costPct = roundTripCostPct();

  const al = alignCloses(aCandles, bCandles);
  const { dates, pa, pb } = al;
  const n = dates.length;
  const events: SignalEvent[] = [];

  const spread: number[] = [];
  for (let i = 0; i < n; i++) spread.push(Math.log(pa[i]) - pair.beta * Math.log(pb[i]));

  const zAt = (i: number): number => {
    const win = spread.slice(i - lookback, i);
    const d = describe(win);
    if (d.std <= 1e-9) return NaN;
    return (spread[i] - d.mean) / d.std;
  };

  let pos:
    | null
    | { side: "long-spread" | "short-spread"; entryIdx: number; entryZ: number; buyCode: string; maxAdverseZ: number } = null;

  for (let i = lookback; i < n; i++) {
    const zi = zAt(i);
    if (Number.isNaN(zi)) continue;

    if (!pos) {
      if (zi <= -entryZ) {
        // 价差偏低 ⇒ A 相对 B 被低估 ⇒ 买 A。
        pos = { side: "long-spread", entryIdx: i, entryZ: zi, buyCode: pair.a, maxAdverseZ: Math.abs(zi) };
      } else if (zi >= entryZ) {
        // 价差偏高 ⇒ B 相对 A 被低估 ⇒ 买 B。
        pos = { side: "short-spread", entryIdx: i, entryZ: zi, buyCode: pair.b, maxAdverseZ: Math.abs(zi) };
      }
      continue;
    }

    pos.maxAdverseZ = Math.max(pos.maxAdverseZ, Math.abs(zi));
    const hold = i - pos.entryIdx;
    const reverted = Math.abs(zi) <= exitZ;
    const stopped = Math.abs(zi) >= stopZ;
    const timedOut = hold >= maxHold;
    const lastBar = i === n - 1;
    if (reverted || stopped || timedOut || lastBar) {
      const isA = pos.buyCode === pair.a;
      const entryPx = isA ? pa[pos.entryIdx] : pb[pos.entryIdx];
      const exitPx = isA ? pa[i] : pb[i];
      const grossPct = (exitPx / entryPx - 1) * 100;
      events.push({
        entryDate: dates[pos.entryIdx],
        exitDate: dates[i],
        buyCode: pos.buyCode,
        entryZ: Number(pos.entryZ.toFixed(2)),
        exitZ: Number(zi.toFixed(2)),
        maxAdverseZ: Number(pos.maxAdverseZ.toFixed(2)),
        holdDays: hold,
        reverted,
        exitReason: reverted ? "价差回归" : stopped ? "协整破裂止损" : timedOut ? "持有超时" : "样本末强制平仓",
        legReturnGrossPct: Number(grossPct.toFixed(2)),
        legReturnPct: Number((grossPct - costPct).toFixed(2)),
      });
      pos = null;
    }
  }

  const signals = events.length;
  const reverted = events.filter((e) => e.reverted);
  const stopouts = events.filter((e) => e.exitReason === "协整破裂止损").length;
  const timeouts = events.filter((e) => e.exitReason === "持有超时").length;
  const wins = events.filter((e) => e.legReturnPct > 0).length;
  const avgRevertDays = reverted.length
    ? reverted.reduce((s, e) => s + e.holdDays, 0) / reverted.length
    : 0;
  const avgLeg = signals ? events.reduce((s, e) => s + e.legReturnPct, 0) / signals : 0;
  const avgAdverse = signals ? events.reduce((s, e) => s + e.maxAdverseZ, 0) / signals : 0;

  return {
    pair,
    events,
    signals,
    reversions: reverted.length,
    reversionRatePct: signals ? Number(((reverted.length / signals) * 100).toFixed(1)) : 0,
    stopouts,
    timeouts,
    avgRevertDays: Number(avgRevertDays.toFixed(1)),
    avgLegReturnPct: Number(avgLeg.toFixed(2)),
    legWinRatePct: signals ? Number(((wins / signals) * 100).toFixed(1)) : 0,
    avgMaxAdverseZ: Number(avgAdverse.toFixed(2)),
  };
}

export interface RadarCalibrationAgg {
  pairsWithSignals: number;
  totalSignals: number;
  reversionRatePct: number;
  avgRevertDays: number;
  avgLegReturnPct: number;
  legWinRatePct: number;
  avgMaxAdverseZ: number;
}

export interface RadarCalibrationResult {
  universeSize: number;
  pairsTested: number;
  cointegratedCount: number;
  /** 每个协整配对的历史信号校准，按信号净收益降序。 */
  calibrations: PairCalibration[];
  agg: RadarCalibrationAgg;
  asOf: string | null;
  note: string;
}

/**
 * 套利雷达信号回测校准：对池内全部协整配对做全历史信号事后回测，
 * 统计「买入被低估腿」这套单边择时规则历史上的回归率、平均回归天数、单边净收益、胜率与最大逆向。
 * 用来校准 z 阈是否可信——回归率高/单边胜率高/逆向浅 ⇒ 信号更可托付。
 */
export function calibrateRadar(
  candles: Record<string, Candle[]>,
  opts: { find?: PairFindOptions; trade?: PairTradeOptions } = {},
): RadarCalibrationResult {
  const codes = Object.keys(candles);
  const pairs = findCointegratedPairs(candles, opts.find);
  const calibrations = pairs
    .map((p) => calibratePair(p, candles[p.a], candles[p.b], opts.trade))
    .filter((c) => c.signals > 0)
    .sort((x, y) => y.avgLegReturnPct - x.avgLegReturnPct);

  let totalSignals = 0,
    totalReversions = 0,
    sumRevertDays = 0,
    revertCount = 0,
    sumLeg = 0,
    wins = 0,
    sumAdverse = 0;
  for (const c of calibrations) {
    totalSignals += c.signals;
    totalReversions += c.reversions;
    sumRevertDays += c.avgRevertDays * c.reversions;
    revertCount += c.reversions;
    for (const e of c.events) {
      sumLeg += e.legReturnPct;
      if (e.legReturnPct > 0) wins++;
      sumAdverse += e.maxAdverseZ;
    }
  }

  let asOf: string | null = null;
  for (const cs of Object.values(candles)) {
    const last = cs.length ? cs[cs.length - 1].date : null;
    if (last && (!asOf || last > asOf)) asOf = last;
  }

  return {
    universeSize: codes.length,
    pairsTested: (codes.length * (codes.length - 1)) / 2,
    cointegratedCount: pairs.length,
    calibrations,
    agg: {
      pairsWithSignals: calibrations.length,
      totalSignals,
      reversionRatePct: totalSignals ? Number(((totalReversions / totalSignals) * 100).toFixed(1)) : 0,
      avgRevertDays: revertCount ? Number((sumRevertDays / revertCount).toFixed(1)) : 0,
      avgLegReturnPct: totalSignals ? Number((sumLeg / totalSignals).toFixed(2)) : 0,
      legWinRatePct: totalSignals ? Number(((wins / totalSignals) * 100).toFixed(1)) : 0,
      avgMaxAdverseZ: totalSignals ? Number((sumAdverse / totalSignals).toFixed(2)) : 0,
    },
    asOf,
    note: "事后回测：对每个协整配对全历史回放，每次 |z|≥入场阈开口就买入被低估的那一只，持有至价差回归/止损/超时。单边收益为该腿真实价格涨跌已扣单边往返成本（含市场 β，非中性）。回归率=由价差回归兑现占比；最大逆向=回归前出现过的最深 |z|。协整为样本内性质会破裂，历史回归率不代表未来，非投资建议。",
  };
}
