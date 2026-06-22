import iconv from "iconv-lite";
import type { Candle, StockFinancials, StockQuote, StockSearchResult } from "./types";
import { globalCache, getAdaptiveTTL } from "./cache";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** fetch with a timeout + small retry, since the upstream APIs are flaky. */
async function fetchRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, retries = 2, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

/** Infer market + exchange prefixes from a 6-digit A-share code. */
export function classifyCode(code: string): {
  market: "SH" | "SZ" | "BJ";
  secid: string;
  tencent: string;
} {
  const head = code[0];
  if (head === "6" || head === "9" || head === "5") {
    return { market: "SH", secid: `1.${code}`, tencent: `sh${code}` };
  }
  if (head === "8" || head === "4") {
    return { market: "BJ", secid: `0.${code}`, tencent: `bj${code}` };
  }
  return { market: "SZ", secid: `0.${code}`, tencent: `sz${code}` };
}

/** Search A-share securities by keyword (name / code / pinyin) via Eastmoney. */
export async function searchStocks(keyword: string): Promise<StockSearchResult[]> {
  const cacheKey = `search:${keyword.trim()}`;
  return globalCache.getOrCreate(
    cacheKey,
    async () => {
      const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(
        keyword
      )}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`;
      const res = await fetchRetry(url, {
        headers: { "User-Agent": UA, Referer: "https://www.eastmoney.com/" },
      });
      const data = (await res.json()) as {
        QuotationCodeTable?: { Data?: Array<Record<string, string>> };
      };
      const rows = data.QuotationCodeTable?.Data ?? [];
      const out: StockSearchResult[] = [];
      for (const r of rows) {
        const code = r.Code;
        const quoteId = r.QuoteID || "";
        // Only A-shares: QuoteID market 0 (SZ) or 1 (SH); 6-digit numeric code.
        if (!/^\d{6}$/.test(code)) continue;
        const mkt = quoteId.startsWith("1.") ? "SH" : classifyCode(code).market;
        out.push({
          code,
          name: r.Name,
          market: mkt,
          secid: quoteId || classifyCode(code).secid,
        });
      }
      return out;
    },
    getAdaptiveTTL("search")
  );
}

/**
 * Realtime quote + headline fundamentals (PE/PB/market cap) from Tencent.
 * Tencent returns a GBK-encoded `~`-delimited string.
 */
export async function getQuote(code: string): Promise<StockQuote> {
  const cacheKey = `quote:${code}`;
  const ttl = getAdaptiveTTL("quote");
  return globalCache.getOrCreate(
    cacheKey,
    async () => {
      const { tencent, market } = classifyCode(code);
      const res = await fetchRetry(`https://qt.gtimg.cn/q=${tencent}`, {
        headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const text = iconv.decode(buf, "gbk");
      const m = text.match(/="([^"]*)"/);
      if (!m || !m[1]) throw new Error(`no quote data for ${code}`);
      const f = m[1].split("~");
      if (f.length < 46) throw new Error(`unexpected quote shape for ${code}`);

      const rawTime = f[30]; // yyyymmddHHMMSS
      const time =
        rawTime && rawTime.length >= 14
          ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)} ${rawTime.slice(
              8,
              10
            )}:${rawTime.slice(10, 12)}:${rawTime.slice(12, 14)}`
          : new Date().toISOString();

      return {
        code,
        name: f[1],
        market,
        price: num(f[3]),
        prevClose: num(f[4]),
        open: num(f[5]),
        high: num(f[33]),
        low: num(f[34]),
        change: num(f[31]),
        changePct: num(f[32]),
        volume: num(f[6]),
        amount: num(f[37]) * 10000, // 万 -> 元
        turnoverPct: num(f[38]),
        amplitudePct: num(f[43]),
        pe: num(f[39]) || null,
        pb: num(f[46]) || null,
        floatMarketCap: num(f[44]) * 1e8, // 亿 -> 元
        totalMarketCap: num(f[45]) * 1e8,
        time,
      };
    },
    ttl
  );
}

/** K 线接口返回里自带的股票名缓存（code → name），用于在「补名字」请求失败时回填权威名称。 */
const klineNameCache = new Map<string, string>();
export function getKlineName(code: string): string | undefined {
  return klineNameCache.get(code);
}

/** Daily K-line history; best-effort (Eastmoney egress is flaky, so swallow errors). */
export async function getKlineSafe(code: string, limit = 120, klt = 101): Promise<Candle[]> {
  try {
    return await getKline(code, limit, klt);
  } catch {
    return [];
  }
}

/** Daily K-line history from Eastmoney (UTF-8). */
export async function getKline(code: string, limit = 120, klt = 101): Promise<Candle[]> {
  const cacheKey = `kline:${code}:${limit}:${klt}`;
  const ttl = getAdaptiveTTL("kline");
  return globalCache.getOrCreate(
    cacheKey,
    async () => {
      const { secid } = classifyCode(code);
      const url =
        `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
        `&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6` +
        `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f61&klt=${klt}&fqt=1&end=20500101&lmt=${limit}`;
      const res = await fetchRetry(url, {
        headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
      });
      const data = (await res.json()) as { data?: { name?: string; klines?: string[] } };
      if (data.data?.name) klineNameCache.set(code, data.data.name);
      const klines = data.data?.klines ?? [];
      return klines.map((line) => {
        // f51 date, f52 open, f53 close, f54 high, f55 low, f56 volume, f57 amount, f58 amplitude, f59 pct, f61 turnover
        const p = line.split(",");
        return {
          date: p[0],
          open: num(p[1]),
          close: num(p[2]),
          high: num(p[3]),
          low: num(p[4]),
          volume: num(p[5]),
          amount: num(p[6]),
          changePct: num(p[8]),
          turnoverPct: num(p[9]),
        };
      });
    },
    ttl
  );
}

/**
 * 拉取最新一期主要财务指标（营收/净利/毛利率/净利率/ROE/负债率等），best-effort。
 * 用于给 AI 的基本面打分提供真实数据锚点，降低凭空臆测的幻觉。失败返回 null。
 */
export async function getFinancials(code: string): Promise<StockFinancials | null> {
  const cacheKey = `financials:${code}`;
  try {
    return await globalCache.getOrCreate(
      cacheKey,
      async () => {
        const { market } = classifyCode(code);
        const secucode = `${code}.${market}`;
        const url =
          `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA` +
          `&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)&pageNumber=1&pageSize=1` +
          `&sortColumns=REPORT_DATE&sortTypes=-1&source=HSF10&client=PC`;
        const res = await fetchRetry(url, {
          headers: { "User-Agent": UA, Referer: "https://emweb.securities.eastmoney.com/" },
          timeoutMs: 8000,
          retries: 1,
        });
        const data = (await res.json()) as { result?: { data?: Array<Record<string, unknown>> } };
        const row = data.result?.data?.[0];
        if (!row) throw new Error(`no financials for ${code}`);
        const toNum = (v: unknown): number | null =>
          typeof v === "number" && Number.isFinite(v) ? v : null;
        const reportName =
          typeof row.REPORT_DATE_NAME === "string"
            ? row.REPORT_DATE_NAME
            : typeof row.REPORT_DATE === "string"
              ? row.REPORT_DATE.slice(0, 10)
              : "";
        return {
          reportName,
          revenue: toNum(row.TOTALOPERATEREVE) ?? 0,
          revenueYoy: toNum(row.TOTALOPERATEREVETZ),
          netProfit: toNum(row.PARENTNETPROFIT) ?? 0,
          netProfitYoy: toNum(row.PARENTNETPROFITTZ),
          grossMargin: toNum(row.XSMLL),
          netMargin: toNum(row.XSJLL),
          roe: toNum(row.ROEJQ),
          debtRatio: toNum(row.ZCFZL),
          eps: toNum(row.EPSJB),
        } satisfies StockFinancials;
      },
      getAdaptiveTTL("financials")
    );
  } catch {
    return null;
  }
}

/** Simple derived stats used to ground the chokepoint scoring. */
export function deriveStats(candles: Candle[]) {
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const first = closes[0];
  const pctFromStart = first ? ((last - first) / first) * 100 : 0;
  // Position of latest price within the window's range (0 = low, 1 = high).
  const rangePos = max > min ? (last - min) / (max - min) : 0.5;
  const avgTurnover =
    candles.reduce((s, c) => s + c.turnoverPct, 0) / candles.length;
  return {
    windowDays: candles.length,
    periodReturnPct: Number(pctFromStart.toFixed(2)),
    rangePosition: Number(rangePos.toFixed(2)),
    avgTurnoverPct: Number(avgTurnover.toFixed(2)),
    windowHigh: max,
    windowLow: min,
  };
}
