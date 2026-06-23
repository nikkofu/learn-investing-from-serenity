/**
 * 统一数据接口 + 优先级 + 自动互备（按 a-stock-data V3.2「按封 IP 风险」重排）。
 *
 * 每个「能力」按优先级依次尝试数据源，命中即返回，失败/空数据自动降级到下一个源，
 * 并返回实际命中的 source 和每个源的尝试记录 attempts，便于监控与排查。
 *
 * 复用项目已有的 market.ts（腾讯行情 / push2his K线 / datacenter 财务）作为主源，
 * 新数据源作为兜底，不重复造轮子。
 */

import { getQuote, getFinancials } from "../market";
import { globalCache, getAdaptiveTTL } from "../cache";
import type { StockQuote, Candle, StockFinancials } from "../types";
import { getTencentQuotes } from "./tencent";
import { getSinaFinancialReport } from "./sina";
import { getEmQuote, getEmStockInfo, getEmAnalystConsensus } from "./eastmoney";
import { getDailyHistory, HISTORY_LIMIT } from "./klineStore";
import type { EmAnalystConsensus } from "./eastmoney";
import type { Candidate, EmStockInfo, SinaReportPeriod, Sourced, SourceAttempt, TencentQuote } from "./types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** 按优先级依次尝试，命中即返回；记录每个源的成败。全部失败则抛错。 */
async function failover<T>(label: string, candidates: Candidate<T>[]): Promise<Sourced<T>> {
  const attempts: SourceAttempt[] = [];
  for (const c of candidates) {
    try {
      const data = await c.run();
      if (c.accept && !c.accept(data)) {
        attempts.push({ source: c.source, ok: false, error: "空数据" });
        continue;
      }
      attempts.push({ source: c.source, ok: true });
      return { data, source: c.source, attempts };
    } catch (e) {
      attempts.push({ source: c.source, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new Error(`[${label}] 所有数据源均失败: ${attempts.map((a) => `${a.source}(${a.error})`).join("; ")}`);
}

/** 把中文数值串解析为数字，支持「亿/万」后缀与百分号。 */
function parseCnNum(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.replace(/[,\s%]/g, "");
  let mult = 1;
  let body = s;
  if (s.endsWith("亿")) {
    mult = 1e8;
    body = s.slice(0, -1);
  } else if (s.endsWith("万")) {
    mult = 1e4;
    body = s.slice(0, -1);
  }
  const n = Number(body);
  return Number.isFinite(n) ? n * mult : null;
}

function txToStockQuote(q: TencentQuote): StockQuote {
  const market = q.code[0] === "6" || q.code[0] === "9" || q.code[0] === "5" ? "SH" : q.code[0] === "8" || q.code[0] === "4" ? "BJ" : "SZ";
  return {
    code: q.code,
    name: q.name,
    market,
    price: q.price,
    prevClose: q.prevClose,
    open: q.open,
    high: q.high,
    low: q.low,
    change: q.change,
    changePct: q.changePct,
    volume: q.volume,
    amount: q.amountWan * 10000,
    turnoverPct: q.turnoverPct,
    amplitudePct: q.amplitudePct,
    pe: q.peTtm,
    pb: q.pb,
    floatMarketCap: q.floatMarketCapYi * 1e8,
    totalMarketCap: q.totalMarketCapYi * 1e8,
    time: q.time,
  };
}

function findItem(items: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) if (items[k] !== undefined) return items[k];
  // 模糊匹配：包含关键字
  for (const k of keys) {
    const hit = Object.keys(items).find((kk) => kk.includes(k));
    if (hit) return items[hit];
  }
  return undefined;
}

function sinaToFinancials(periods: SinaReportPeriod[]): StockFinancials | null {
  const latest = periods[0];
  if (!latest) return null;
  const it = latest.items;
  return {
    reportName: latest.period,
    revenue: parseCnNum(findItem(it, "营业总收入", "营业收入")) ?? 0,
    revenueYoy: parseCnNum(findItem(it, "营业总收入_同比", "营业收入_同比")),
    netProfit: parseCnNum(findItem(it, "归属于母公司股东的净利润", "归属于母公司所有者的净利润", "净利润")) ?? 0,
    netProfitYoy: parseCnNum(findItem(it, "归属于母公司股东的净利润_同比", "净利润_同比")),
    grossMargin: parseCnNum(findItem(it, "销售毛利率", "毛利率")),
    netMargin: parseCnNum(findItem(it, "销售净利率", "净利率")),
    roe: parseCnNum(findItem(it, "净资产收益率", "ROE")),
    debtRatio: parseCnNum(findItem(it, "资产负债率")),
    eps: parseCnNum(findItem(it, "基本每股收益", "每股收益")),
  };
}

// ── 能力 1：实时行情（腾讯 → 东财 push2delay）──────────────────────────
// 在 facade 层缓存：任一源命中的结果都进缓存，避免兜底源每次重新打网络。
export function getRealtimeQuote(code: string): Promise<Sourced<StockQuote>> {
  return globalCache.getOrCreate(
    `u:quote:${code}`,
    () =>
      failover<StockQuote>("realtime-quote", [
        { source: "tencent", run: () => getQuote(code), accept: (q) => q.price > 0 || q.prevClose > 0 },
        { source: "eastmoney-push2", run: () => getEmQuote(code), accept: (q) => q.price > 0 || q.prevClose > 0 },
      ]),
    getAdaptiveTTL("quote"),
  );
}

// ── 能力 2：批量行情（腾讯批量 → 东财逐只兜底）─────────────────────────
export async function getRealtimeQuotes(codes: string[]): Promise<Sourced<Record<string, StockQuote>>> {
  const key = `u:quotes:${[...codes].sort().join(",")}`;
  return globalCache.getOrCreate(
    key,
    () =>
      failover<Record<string, StockQuote>>("realtime-quotes", [
    {
      source: "tencent",
      run: async () => {
        const m = await getTencentQuotes(codes);
        const out: Record<string, StockQuote> = {};
        for (const [c, q] of m) out[c] = txToStockQuote(q);
        return out;
      },
      accept: (o) => Object.keys(o).length > 0,
    },
    {
      source: "eastmoney-push2",
      run: async () => {
        const out: Record<string, StockQuote> = {};
        for (const c of codes) {
          try {
            out[c] = await getEmQuote(c);
          } catch {
            /* 跳过单只失败 */
          }
        }
        return out;
      },
      accept: (o) => Object.keys(o).length > 0,
    },
      ]),
    getAdaptiveTTL("quote"),
  );
}

/**
 * 「即拿即用」单只实时行情（StockQuote，腾讯 → 东财 push2 兜底）。
 * 全部源失败时抛错（与旧 market.getQuote 行为一致），便于上层 try/catch。
 */
export async function getQuoteFailover(code: string): Promise<StockQuote> {
  const { data } = await getRealtimeQuote(code);
  return data;
}

/**
 * 「即拿即用」批量行情（code → StockQuote，腾讯批量 → 东财逐只兜底）。
 * 用于补名/补价等 best-effort 场景：全部失败时返回空对象，不抛错。
 */
export async function getQuotesFailover(codes: string[]): Promise<Record<string, StockQuote>> {
  if (codes.length === 0) return {};
  try {
    const { data } = await getRealtimeQuotes(codes);
    return data;
  } catch {
    return {};
  }
}

// ── 能力 3：日 K 线（多源互备，按 V3.2「封 IP 风险」排序）──
// 不封 IP 的源（百度带 MA / 新浪 / 腾讯）优先；东财 push2his 走限流兜底。
// em-first：国内 IP 优先东财 CDN；baidu-first：批量/海外场景优先免封源。
export function getDailyKline(
  code: string,
  limit = 120,
  order: "em-first" | "baidu-first" = "em-first",
): Promise<Sourced<Candle[]>> {
  return globalCache.getOrCreate(
    `u:kline:${code}:${limit}:${order}`,
    () => getDailyKlineUncached(code, limit, order),
    getAdaptiveTTL("kline"),
  );
}

// 实际取数走 klineStore 的「全量落盘 + 增量更新」本地行情库：
// 一次性拿到完整历史（约 10 年）后按 limit 切片，盘内复用、只补增量、自动处理复权漂移。
async function getDailyKlineUncached(
  code: string,
  limit: number,
  order: "em-first" | "baidu-first",
): Promise<Sourced<Candle[]>> {
  const { data, source, attempts } = await getDailyHistory(code, order);
  return { data: data.slice(-limit), source, attempts };
}

/**
 * 取「后复权」全量日线（仅东财 fqt=2），专供回测：早年价不为负、长周期收益正确。
 * 与前复权各自独立落盘（.data/kline-cache-hfq），失败返回空数组（由调用方回退前复权全量）。
 */
export async function getHfqDailyHistory(code: string, limit = HISTORY_LIMIT): Promise<Candle[]> {
  try {
    const { data } = await getDailyHistory(code, "em-first", "hfq");
    return data.slice(-limit);
  } catch {
    return [];
  }
}

/** 把日 K 重采样为周/月 K（OHLC: 开=首/收=末/高=区间最高/低=区间最低；量额累加）。 */
function resampleCandles(daily: Candle[], unit: "week" | "month"): Candle[] {
  const bucketKey = (date: string): string => {
    if (unit === "month") return date.slice(0, 7);
    const d = new Date(date + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return date;
    // 归到本周一，使同一自然周聚到一起且按时间单调递增。
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const out: Candle[] = [];
  let curKey = "";
  for (const c of daily) {
    const key = bucketKey(c.date);
    if (key !== curKey) {
      out.push({ ...c });
      curKey = key;
    } else {
      const b = out[out.length - 1];
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.date = c.date;
      b.volume += c.volume;
      b.amount += c.amount;
      b.turnoverPct += c.turnoverPct;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const prev = i > 0 ? out[i - 1].close : out[i].open;
    out[i].changePct = prev ? Math.round(((out[i].close - prev) / prev) * 100 * 100) / 100 : 0;
  }
  return out;
}

/**
 * 给图表/分析用的「即拿即用」K 线（Candle[]，多源互备，可替换裸 getKlineSafe）。
 * klt: 101=日 / 102=周 / 103=月。周/月由日 K 重采样，全程不依赖东财 push2his。
 * 任一源（百度/新浪/push2his）成功即返回；全失败返回空数组（与 getKlineSafe 行为一致）。
 */
export async function getKlineFailover(code: string, limit = 120, klt = 101): Promise<Candle[]> {
  // 周/月需更多日线作重采样的原料。底层是落盘的全量历史，按需切片即可（上限 HISTORY_LIMIT）。
  const span = klt === 103 ? 22 : klt === 102 ? 5 : 1;
  const dailyLimit = Math.min(HISTORY_LIMIT, limit * span + 30);
  try {
    const { data } = await getDailyKline(code, dailyLimit, "baidu-first");
    if (klt === 102) return resampleCandles(data, "week").slice(-limit);
    if (klt === 103) return resampleCandles(data, "month").slice(-limit);
    return data.slice(-limit);
  } catch {
    return [];
  }
}

// ── 能力 4：主要财务指标（东财 datacenter → 新浪三表反推）───────────────
export function getMainFinancials(code: string): Promise<Sourced<StockFinancials>> {
  return globalCache.getOrCreate(
    `u:financials:${code}`,
    () =>
      failover<StockFinancials>("main-financials", [
    {
      source: "eastmoney-datacenter",
      run: async () => {
        const f = await getFinancials(code);
        if (!f) throw new Error("datacenter 返回空");
        return f;
      },
    },
    {
      source: "sina",
      run: async () => {
        const f = sinaToFinancials(await getSinaFinancialReport(code, "lrb", 4));
        if (!f) throw new Error("新浪返回空");
        return f;
      },
    },
      ]),
    getAdaptiveTTL("financials"),
  );
}

// ── 能力 5：个股基本面（东财 push2delay → 腾讯部分字段）─────────────────
export function getStockProfile(code: string): Promise<Sourced<EmStockInfo>> {
  return globalCache.getOrCreate(
    `u:profile:${code}`,
    () =>
      failover<EmStockInfo>("stock-profile", [
    {
      source: "eastmoney-push2",
      run: async () => {
        const info = await getEmStockInfo(code);
        if (!info) throw new Error("push2 返回空");
        return info;
      },
    },
    {
      source: "tencent",
      run: async () => {
        const m = await getTencentQuotes([code]);
        const q = m.get(code);
        if (!q) throw new Error("腾讯返回空");
        return {
          code: q.code,
          name: q.name,
          industry: "",
          totalShares: 0,
          floatShares: 0,
          marketCap: q.totalMarketCapYi * 1e8,
          floatMarketCap: q.floatMarketCapYi * 1e8,
          listDate: "",
          price: q.price,
        } satisfies EmStockInfo;
      },
    },
      ]),
    getAdaptiveTTL("profile"),
  );
}

// ── 能力 6：卖方一致预期（研报聚合 → 估值锚定目标价）─────────────────────
export interface AnalystConsensus {
  code: string;
  /** 纳入统计的研报数。 */
  reportCount: number;
  /** 看多评级研报数。 */
  buyCount: number;
  /** 看多占比 0–1。 */
  buyRatio: number | null;
  /** 一致 EPS（明年优先，回退今年）。 */
  consensusEps: number | null;
  consensusEpsThisYear: number | null;
  consensusEpsNextYear: number | null;
  /** 当前价（best-effort）。 */
  currentPrice: number | null;
  /** 当前 PE(TTM)。 */
  peTtm: number | null;
  /** 一致 EPS × 当前 PE 推得的目标价（有约束）。 */
  impliedTarget: number | null;
  /** 目标价隐含涨幅 %。 */
  upsidePct: number | null;
  latestReportDate: string | null;
}

// 目标价估算约束（对标 SCS：异常 PE / 过度乐观一律不外推）。
const MAX_PE_FOR_TARGET = 300;
const MAX_UPSIDE_RATIO = 2.0; // 目标价较现价最多 +200%

/**
 * 卖方一致预期（新增数据维度，对标 SCS 的 analyst/analysts）。
 * 一致预期来源走 failover（东财研报聚合，预留同花顺等二级源），
 * 再用当前 PE(TTM) 把一致 EPS 锚定成目标价/上行空间（best-effort，不阻断主结果）。
 */
export function getAnalystConsensus(code: string): Promise<Sourced<AnalystConsensus>> {
  return globalCache.getOrCreate(
    `u:analyst:${code}`,
    () => buildAnalystConsensus(code),
    getAdaptiveTTL("analyst"),
  );
}

async function buildAnalystConsensus(code: string): Promise<Sourced<AnalystConsensus>> {
  const { data: em, source, attempts } = await failover<EmAnalystConsensus>("analyst-consensus", [
    {
      source: "eastmoney-report",
      run: async () => {
        const c = await getEmAnalystConsensus(code);
        if (!c) throw new Error("无研报");
        return c;
      },
      accept: (c) => c.reportCount > 0,
    },
  ]);

  // 现价/PE：best-effort，失败不影响一致预期主体。
  let currentPrice: number | null = null;
  let peTtm: number | null = null;
  try {
    const q = await getQuoteFailover(code);
    currentPrice = Number.isFinite(q.price) && q.price > 0 ? q.price : null;
    peTtm = q.pe != null && Number.isFinite(q.pe) ? q.pe : null;
  } catch {
    /* 行情不可用时仅缺目标价 */
  }

  const consensusEps = em.consensusEpsNextYear ?? em.consensusEpsThisYear ?? null;
  let impliedTarget: number | null = null;
  let upsidePct: number | null = null;
  if (
    consensusEps != null &&
    consensusEps > 0 &&
    peTtm != null &&
    peTtm > 0 &&
    peTtm < MAX_PE_FOR_TARGET
  ) {
    const raw = consensusEps * peTtm;
    if (currentPrice && currentPrice > 0) {
      const capped = Math.min(raw, currentPrice * (1 + MAX_UPSIDE_RATIO));
      impliedTarget = Math.round(capped * 100) / 100;
      upsidePct = Math.round(((impliedTarget - currentPrice) / currentPrice) * 100 * 100) / 100;
    } else {
      impliedTarget = Math.round(raw * 100) / 100;
    }
  }

  const data: AnalystConsensus = {
    code,
    reportCount: em.reportCount,
    buyCount: em.buyCount,
    buyRatio: em.buyRatio,
    consensusEps,
    consensusEpsThisYear: em.consensusEpsThisYear,
    consensusEpsNextYear: em.consensusEpsNextYear,
    currentPrice,
    peTtm,
    impliedTarget,
    upsidePct,
    latestReportDate: em.latestReportDate,
  };
  return { data, source, attempts };
}

// ── 批量 K 线原语（对标 SCS /klines 批量；有界并发 + 缓存 + 重试）──────────
export interface KlineBatchItem {
  code: string;
  candles: Candle[];
  source: string;
}

/**
 * 批量拉取多只日 K：内部有界并发 + 单只重试，命中 facade 的 K 线缓存。
 * - 默认 baidu-first（批量/高吞吐场景优先免封 IP 的源，避免东财风控）。
 * - onOne 回调用于流式进度（每只完成即回调），不传则等全部完成。
 * - 单只失败返回空 candles（source="none"），不影响整体。
 * 把散落各处的「逐只取 K + 重试」收敛为一个原语，并为未来 Python sidecar
 * 的 /klines/batch 预留统一插槽。
 */
export async function getKlinesBatch(
  codes: string[],
  limit = 120,
  order: "em-first" | "baidu-first" = "baidu-first",
  opts: {
    concurrency?: number;
    retries?: number;
    onOne?: (item: KlineBatchItem) => void;
  } = {},
): Promise<Map<string, KlineBatchItem>> {
  const out = new Map<string, KlineBatchItem>();
  const uniq = Array.from(new Set(codes.filter((c) => /^\d{6}$/.test(c))));
  if (uniq.length === 0) return out;

  const concurrency = clampInt(opts.concurrency ?? 8, 1, 32);
  const retries = clampInt(opts.retries ?? 2, 0, 10);
  let cursor = 0;

  async function fetchOne(code: string): Promise<KlineBatchItem> {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await getDailyKline(code, limit, order);
        if (r.data.length > 0) return { code, candles: r.data, source: r.source };
      } catch {
        /* 重试 */
      }
      if (i < retries) await sleep(250 * (i + 1));
    }
    return { code, candles: [], source: "none" };
  }

  async function runner(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= uniq.length) return;
      const item = await fetchOne(uniq[i]);
      out.set(item.code, item);
      opts.onOne?.(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, uniq.length) }, () => runner()),
  );
  return out;
}
