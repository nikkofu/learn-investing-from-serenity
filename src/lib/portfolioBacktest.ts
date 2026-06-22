import type { Candle } from "./types";
import { getKlinesBatch } from "./sources";

/**
 * 组合级回测引擎（对标 SCS web/lib/backtest.ts，纯 TS 实现）。
 *
 * 与 quant.ts 里「单只股票」回测互补：这里按**截面排名**每 N 个交易日轮动持有
 * top-K 只，模拟一个真实组合：现金 / 持仓 / 手续费 / 最大持仓数 / 100 股整手 /
 * A 股涨跌停撮合约束。输出净值曲线 + CAGR + 最大回撤 + 年化夏普 + 换手 + 交易流水。
 *
 * 关键纪律（避免未来函数）：再平衡日 D 的打分只看 D **之前**收盘价（严格早于 D），
 * 成交按 D 当日收盘价执行；不引入任何「当日才知道」的信息。
 */

export interface PortfolioSeries {
  code: string;
  name: string;
  /** 日 K（按日期升序）。 */
  candles: Candle[];
}

export interface PortfolioBacktestConfig {
  /** 初始资金（元），默认 100 万。 */
  startCash?: number;
  /** 每隔多少个交易日再平衡一次，默认 5。 */
  rebalanceEveryNDays?: number;
  /** 回测起始日 YYYY-MM-DD，默认对齐后的首日。 */
  startDate?: string;
  /** 回测结束日 YYYY-MM-DD，默认对齐后的末日。 */
  endDate?: string;
  /** 单边手续费（基点 bps，1bp=0.01%），默认 30（含佣金+印花税近似）。 */
  feeBps?: number;
  /** 最大同时持仓只数（等权），默认 10。 */
  maxPositions?: number;
  /** 最短持有交易日数（抑制频繁换手），默认 0。 */
  minHoldBars?: number;
}

/**
 * 截面打分器：给定再平衡日 asOf 与各标的「严格早于 asOf 的历史 K 线」，
 * 返回**从优到劣排序**的代码列表（只需返回想买入的候选，靠前者优先）。
 */
export type PortfolioScorer = (
  asOf: string,
  view: Array<{ code: string; name: string; history: Candle[] }>,
) => string[];

export interface PortfolioBar {
  date: string;
  equity: number;
  cash: number;
  positions: Record<string, { shares: number; price: number }>;
}

export interface PortfolioTrade {
  date: string;
  code: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
}

export interface PortfolioStats {
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  annualizedSharpe: number;
  trades: number;
  /** 换手率 %：累计成交额 / 平均净值。 */
  turnoverPct: number;
}

export interface PortfolioBacktestResult {
  config: Required<Omit<PortfolioBacktestConfig, "startDate" | "endDate">> & {
    startDate: string;
    endDate: string;
  };
  equityCurve: PortfolioBar[];
  trades: PortfolioTrade[];
  stats: PortfolioStats;
}

// ── A 股涨跌停（F2 撮合真实性）─────────────────────────────────────────────
/**
 * 按板块返回单日涨跌停幅度（占前收的比例）：
 * 主板 ±10%（ST ±5%）、创业板/科创板 ±20%、北交所 ±30%。
 */
export function priceLimitFraction(code: string, name: string): number {
  const c = code.replace(/^(sh|sz|bj)/i, "").replace(/\.(sh|sz|bj)$/i, "");
  if (/^(688|689|300|301)/.test(c)) return 0.2; // 科创板 / 创业板
  if (/^(4|8|92)/.test(c)) return 0.3; // 北交所
  return /ST/i.test(name) ? 0.05 : 0.1; // 主板（ST 减半）
}

// 吸收交易所对涨跌停价的 0.01 元取整误差（K 线为前复权，日内涨跌幅口径一致）。
const LIMIT_SLACK = 0.003;

// ── 工具 ──────────────────────────────────────────────────────────────────
function unionDates(series: PortfolioSeries[]): string[] {
  const all = new Set<string>();
  for (const s of series) for (const k of s.candles) all.add(k.date);
  return [...all].sort();
}

function indexByDate(candles: Candle[]): Map<string, Candle> {
  const m = new Map<string, Candle>();
  for (const k of candles) m.set(k.date, k);
  return m;
}

/** 排名归一化：把一组数映射到 [0,1]（并列取平均名次）。null 记 0。 */
export function rankNormalize(values: Array<number | null>): number[] {
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  const ranks = new Array<number>(values.length).fill(0);
  if (valid.length === 0) return ranks;
  valid.sort((a, b) => a.v - b.v);
  let start = 0;
  for (let i = 1; i <= valid.length; i++) {
    if (i === valid.length || valid[i].v !== valid[start].v) {
      const avgRank = (start + i - 1) / 2;
      const normalized = avgRank / Math.max(valid.length - 1, 1);
      for (let j = start; j < i; j++) ranks[valid[j].i] = normalized;
      start = i;
    }
  }
  return ranks;
}

/**
 * 默认打分器：纯价格动量（避免基本面的未来函数泄漏）。
 * 综合 20 日动量与「现价/MA20」两个截面排名（0.6/0.4），返回从优到劣的代码。
 * 历史不足 21 根的标的不参与。
 */
export function defaultMomentumScorer(
  _asOf: string,
  view: Array<{ code: string; name: string; history: Candle[] }>,
): string[] {
  const LOOKBACK = 20;
  const eligible = view.filter((v) => v.history.length >= LOOKBACK + 1);
  if (eligible.length === 0) return [];
  const mom: Array<number | null> = [];
  const maR: Array<number | null> = [];
  for (const v of eligible) {
    const h = v.history;
    const last = h[h.length - 1].close;
    const past = h[h.length - 1 - LOOKBACK].close;
    mom.push(past > 0 ? last / past - 1 : null);
    const window = h.slice(-LOOKBACK);
    const ma = window.reduce((s, k) => s + k.close, 0) / window.length;
    maR.push(ma > 0 ? last / ma : null);
  }
  const rMom = rankNormalize(mom);
  const rMa = rankNormalize(maR);
  return eligible
    .map((v, i) => ({ code: v.code, score: 0.6 * rMom[i] + 0.4 * rMa[i] }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.code);
}

function annualizedSharpe(equities: number[]): number {
  const rets: number[] = [];
  for (let k = 1; k < equities.length; k++) {
    const prev = equities[k - 1];
    if (prev > 0) rets.push(equities[k] / prev - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return Number(((mean / sd) * Math.sqrt(252)).toFixed(2));
}

function maxDrawdownPct(equities: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equities) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = 1 - e / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD * 100;
}

/**
 * 运行组合回测：截面排名 → 每 N 日轮动等权持有 top-K → 净值/统计。
 * `scorer` 默认用价格动量；可注入挖掘分/任意截面策略。
 */
export function runPortfolioBacktest(
  series: PortfolioSeries[],
  cfg: PortfolioBacktestConfig = {},
  scorer: PortfolioScorer = defaultMomentumScorer,
): PortfolioBacktestResult {
  const startCash = cfg.startCash ?? 1_000_000;
  const rebalanceEveryNDays = Math.max(1, cfg.rebalanceEveryNDays ?? 5);
  const feeBps = Math.max(0, cfg.feeBps ?? 30);
  const maxPositions = Math.max(1, cfg.maxPositions ?? 10);
  const minHoldBars = Math.max(0, cfg.minHoldBars ?? 0);
  const fee = feeBps / 10_000;

  const allDates = unionDates(series);
  const startDate = cfg.startDate ?? allDates[0];
  const endDate = cfg.endDate ?? allDates[allDates.length - 1];
  const dates = allDates.filter((d) => d >= startDate && d <= endDate);
  if (dates.length < 5) {
    throw new Error(`对齐后的交易日不足（${dates.length}），无法回测`);
  }

  const byDate = series.map((s) => indexByDate(s.candles));
  const codes = series.map((s) => s.code);
  const codeIndex = new Map(codes.map((c, j) => [c, j] as const));

  // 用全量序列建「前收」表，使窗口首日也能判涨跌停。
  const prevCloseByDate = series.map((s) => {
    const sorted = [...s.candles].sort((a, b) => (a.date < b.date ? -1 : 1));
    const m = new Map<string, number>();
    for (let k = 1; k < sorted.length; k++) m.set(sorted[k].date, sorted[k - 1].close);
    return m;
  });
  const limitFrac = series.map((s) => priceLimitFraction(s.code, s.name));
  const dayReturn = (j: number, date: string, close: number): number | null => {
    const prev = prevCloseByDate[j].get(date);
    if (prev === undefined || prev <= 0) return null;
    return close / prev - 1;
  };
  const atLimitUp = (j: number, date: string, close: number): boolean => {
    const r = dayReturn(j, date, close);
    return r !== null && r >= limitFrac[j] - LIMIT_SLACK;
  };
  const atLimitDown = (j: number, date: string, close: number): boolean => {
    const r = dayReturn(j, date, close);
    return r !== null && r <= -(limitFrac[j] - LIMIT_SLACK);
  };

  let cash = startCash;
  const shares: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const lastBuyBar: Record<string, number> = {};
  const equityCurve: PortfolioBar[] = [];
  const trades: PortfolioTrade[] = [];
  let grossTraded = 0; // 累计成交额（含买卖），用于换手率

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    // 当日各标的收盘价（停牌则缺失）。
    const prices: Record<string, number> = {};
    for (let j = 0; j < series.length; j++) {
      const k = byDate[j].get(date);
      if (k) {
        prices[codes[j]] = k.close;
        lastPrice[codes[j]] = k.close;
      }
    }

    const isRebalance = i % rebalanceEveryNDays === 0;
    if (isRebalance) {
      // 严格早于 date 的历史视图（避免未来函数）。
      const view = series.map((s) => ({
        code: s.code,
        name: s.name,
        history: s.candles.filter((k) => k.date < date),
      }));
      const ranked = scorer(date, view);
      // 目标持仓：排名靠前、当日可交易（有价、非涨停）的 top-K。
      const target: string[] = [];
      for (const code of ranked) {
        if (target.length >= maxPositions) break;
        const px = prices[code];
        if (px === undefined) continue; // 停牌
        const j = codeIndex.get(code);
        if (j !== undefined && atLimitUp(j, date, px)) continue; // 涨停买不进
        target.push(code);
      }
      const targetSet = new Set(target);

      // 1) 卖出：不在目标内的持仓（受跌停/停牌/最短持有约束）。
      for (const code of codes) {
        if (targetSet.has(code)) continue;
        const held = shares[code] ?? 0;
        if (held <= 0) continue;
        const px = prices[code];
        if (px === undefined) continue; // 停牌：今日无法卖，顺延
        const j = codeIndex.get(code)!;
        if (atLimitDown(j, date, px)) continue; // 跌停卖不出，顺延
        if (minHoldBars && lastBuyBar[code] !== undefined && i - lastBuyBar[code] < minHoldBars) {
          continue; // 未满最短持有
        }
        const proceeds = held * px * (1 - fee);
        cash += proceeds;
        grossTraded += held * px;
        trades.push({ date, code, side: "sell", shares: held, price: px });
        shares[code] = 0;
      }

      // 2) 买入：目标内尚未持有的，按等权预算买入（100 股整手，现金约束）。
      const wantBuy = target.filter((code) => (shares[code] ?? 0) === 0);
      if (wantBuy.length > 0) {
        const equityNow =
          cash +
          codes.reduce((sum, c) => sum + (shares[c] ?? 0) * (prices[c] ?? lastPrice[c] ?? 0), 0);
        const perName = equityNow / maxPositions;
        for (const code of wantBuy) {
          const px = prices[code];
          if (!px || px <= 0) continue;
          const budget = Math.min(perName, cash);
          const sh = Math.floor(budget / (px * (1 + fee)) / 100) * 100; // 100 股整手
          if (sh <= 0) continue;
          const cost = sh * px * (1 + fee);
          if (cost > cash) continue;
          cash -= cost;
          grossTraded += sh * px;
          shares[code] = (shares[code] ?? 0) + sh;
          lastBuyBar[code] = i;
          trades.push({ date, code, side: "buy", shares: sh, price: px });
        }
      }
    }

    // 按市值计净值（停牌按最近成交价标记）。
    let equity = cash;
    const positions: PortfolioBar["positions"] = {};
    for (const code of codes) {
      const held = shares[code] ?? 0;
      if (held > 0) {
        const px = prices[code] ?? lastPrice[code] ?? 0;
        equity += held * px;
        positions[code] = { shares: held, price: px };
      }
    }
    equityCurve.push({ date, equity, cash, positions });
  }

  const equities = equityCurve.map((b) => b.equity);
  const startEq = equities[0];
  const endEq = equities[equities.length - 1];
  const totalReturnPct = (endEq / startEq - 1) * 100;
  const spanMs = Date.parse(equityCurve[equityCurve.length - 1].date) - Date.parse(equityCurve[0].date);
  const years = spanMs > 0 ? spanMs / (365.25 * 24 * 3600 * 1000) : 0;
  const cagrPct = years > 0 && startEq > 0 ? ((endEq / startEq) ** (1 / years) - 1) * 100 : 0;
  const avgEquity = equities.reduce((s, e) => s + e, 0) / equities.length || 1;
  const turnoverPct = (grossTraded / avgEquity) * 100;

  return {
    config: {
      startCash,
      rebalanceEveryNDays,
      feeBps,
      maxPositions,
      minHoldBars,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    },
    equityCurve,
    trades,
    stats: {
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      cagrPct: Number(cagrPct.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct(equities).toFixed(2)),
      annualizedSharpe: annualizedSharpe(equities),
      trades: trades.length,
      turnoverPct: Number(turnoverPct.toFixed(1)),
    },
  };
}

/**
 * 便捷入口：给定代码清单 → 用 facade 的批量原语取日 K → 运行组合回测。
 * 复用 getKlinesBatch（有界并发 + 缓存 + baidu-first 免封源），names 可选用于涨跌停判定。
 */
export async function backtestPortfolioByCodes(
  codes: string[],
  cfg: PortfolioBacktestConfig = {},
  opts: { limit?: number; names?: Record<string, string>; scorer?: PortfolioScorer } = {},
): Promise<PortfolioBacktestResult> {
  const limit = Math.max(60, Math.min(800, opts.limit ?? 400));
  const klineMap = await getKlinesBatch(codes, limit, "baidu-first");
  const series: PortfolioSeries[] = [];
  for (const code of codes) {
    const item = klineMap.get(code);
    if (!item || item.candles.length < 30) continue;
    series.push({
      code,
      name: opts.names?.[code] ?? code,
      candles: [...item.candles].sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
  }
  if (series.length === 0) throw new Error("无可用 K 线数据，无法回测");
  return runPortfolioBacktest(series, cfg, opts.scorer ?? defaultMomentumScorer);
}
