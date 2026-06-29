/**
 * 日 K 线「全量落盘 + 增量更新」本地行情库（对标通达信 / 同花顺等本地行情软件的做法）：
 *
 *   - 首次请求某只票 → 一次性拉取约 10 年日线，落盘到 .data/kline-cache/<code>.json；
 *   - 之后每次请求 → 只补「增量」（最近一小段窗口），与盘内数据去重合并后回写，
 *     不再重复下载 10 年，省带宽、抗封 IP、回测样本稳定；
 *   - 复权漂移检测：增量窗口与盘内重叠日期的收盘价若整体性偏移（除权除息导致前复权价变化），
 *     判定为「复权变化」并触发一次全量刷新，保证历史价连续不串档；
 *   - 网络全失败时回退盘内旧数据（降级可用，不阻断分析 / 回测）。
 *
 * 全量历史在内存层（globalCache，key=u:history:<code>:<order>）做请求合并 + 短 TTL 复用，
 * 上层 getDailyKline / getKlineFailover / getKlinesBatch 统一走这里取数后再按需切片。
 */
import { promises as fs } from "fs";
import path from "path";
import { getKline } from "../market";
import { getBaiduKline } from "./baidu";
import { getSinaKline, SINA_KLINE_MAX } from "./sina";
import { globalCache, getAdaptiveTTL, isAShareActiveTime } from "../cache";
import { getHistoryStart, HISTORY_MAX_BARS } from "../marketSettings";
import type { Candle } from "../types";
import type { BaiduCandle, Sourced, SourceAttempt, Candidate } from "./types";

/**
 * 全量历史拉取 / 保留上限（条数）。起始日期由 marketSettings 配置（默认 2000-01-01）驱动，
 * 本常量只作「最多保留多少根」的上限，取足够大以不截断从起始日期至今的全部日线。
 */
export const HISTORY_LIMIT = HISTORY_MAX_BARS;
/** 增量更新时回看的重叠窗口（覆盖短期断更 + 复权漂移检测的样本）。 */
const OVERLAP_BARS = 60;
/** 复权漂移判定：重叠已结算日收盘价偏移超过此比例视为「价不一致」。 */
const ADJ_TOLERANCE = 0.005;
/** 重叠样本中偏移占比超过此值即判为复权变化，触发全量刷新（规避单点脏数据误判）。 */
const ADJ_DRIFT_FRACTION = 0.3;

/** 复权口径：qfq=前复权（显示/打分，贴合现价）/ hfq=后复权（回测，早年价不为负、长周期收益正确）。 */
export type FqMode = "qfq" | "hfq";

const CACHE_DIR_QFQ = path.join(process.cwd(), ".data", "kline-cache");
const CACHE_DIR_HFQ = path.join(process.cwd(), ".data", "kline-cache-hfq");
function cacheDir(fq: FqMode): string {
  return fq === "hfq" ? CACHE_DIR_HFQ : CACHE_DIR_QFQ;
}

interface DiskRecord {
  code: string;
  /** 完整日线（按日期升序），前复权口径。 */
  candles: Candle[];
  /** 最近一次更新时间（ms）。 */
  updatedAt: number;
  /** 最近一次成功取数的命中源。 */
  source: string;
}

function fileFor(code: string, fq: FqMode): string {
  return path.join(cacheDir(fq), `${code}.json`);
}

async function readDisk(code: string, fq: FqMode): Promise<DiskRecord | null> {
  try {
    const raw = await fs.readFile(fileFor(code, fq), "utf8");
    const rec = JSON.parse(raw) as DiskRecord;
    if (!Array.isArray(rec.candles) || rec.candles.length === 0) return null;
    return rec;
  } catch {
    return null;
  }
}

async function writeDisk(code: string, candles: Candle[], source: string, fq: FqMode): Promise<void> {
  const rec: DiskRecord = { code, candles, updatedAt: Date.now(), source };
  const file = fileFor(code, fq);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // 先写临时文件再原子重命名，避免并发 / 中断写坏缓存。
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rec), "utf8");
  await fs.rename(tmp, file);
}

/** 盘内数据「新鲜」窗口：盘中 2 分钟、非交易时段 12 小时内不再打网络。 */
function freshMs(): number {
  return isAShareActiveTime() ? 2 * 60 * 1000 : 12 * 60 * 60 * 1000;
}

/**
 * 最近一个「应已收盘结算」的交易日（北京时区，YYYY-MM-DD）。
 * 收盘清算完成（约 15:30）前当日尚未结算，取上一交易日；周末顺延至上一工作日。
 * 注：未含法定节假日日历，节假日会回退到最近自然工作日，该日无数据时增量取数为空，
 * 按既有逻辑降级回放盘内数据，不影响正确性。
 */
function latestSettledTradingDate(): string {
  const bj = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  if (bj.getHours() * 60 + bj.getMinutes() < 15 * 60 + 30) bj.setDate(bj.getDate() - 1);
  while (bj.getDay() === 0 || bj.getDay() === 6) bj.setDate(bj.getDate() - 1);
  const m = String(bj.getMonth() + 1).padStart(2, "0");
  const d = String(bj.getDate()).padStart(2, "0");
  return `${bj.getFullYear()}-${m}-${d}`;
}

function baiduToCandles(rows: BaiduCandle[], limit: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = i > 0 ? rows[i - 1].close : r.open;
    out.push({
      date: r.date,
      open: r.open,
      close: r.close,
      high: r.high,
      low: r.low,
      volume: r.volume,
      amount: r.amount,
      changePct: prev ? Math.round(((r.close - prev) / prev) * 100 * 100) / 100 : 0,
      turnoverPct: r.turnoverPct,
    });
  }
  return out.slice(-limit);
}

async function runFailover(label: string, chain: Candidate<Candle[]>[]): Promise<Sourced<Candle[]>> {
  const attempts: SourceAttempt[] = [];
  for (const c of chain) {
    try {
      const data = await c.run();
      if (data.length === 0) {
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

/** 拉「全量」历史（约 10 年）：百度带 start_time / 新浪放开 datalen / 东财大 lmt。 */
function fetchFull(code: string, order: "em-first" | "baidu-first", fq: FqMode): Promise<Sourced<Candle[]>> {
  // 后复权（回测口径）只用东财 fqt=2：百度/新浪默认前复权，混入会污染后复权缓存导致早年价又变负，故 hfq 不接它们做兜底。
  if (fq === "hfq") {
    const emHfq: Candidate<Candle[]> = {
      source: "eastmoney-push2his(hfq)",
      run: () => getKline(code, HISTORY_MAX_BARS, 101, 2),
    };
    return runFailover("full-kline-hfq", [emHfq]);
  }
  // 起始日期由配置驱动（默认 2000-01-01）；某源有更晚的硬性起点时以该源能给的最早为准。
  const start = getHistoryStart();
  const baidu: Candidate<Candle[]> = {
    source: "baidu",
    run: async () => baiduToCandles(await getBaiduKline(code, start), HISTORY_MAX_BARS),
  };
  const sina: Candidate<Candle[]> = {
    source: "sina",
    run: () => getSinaKline(code, Math.min(SINA_KLINE_MAX, HISTORY_MAX_BARS)),
  };
  const em: Candidate<Candle[]> = {
    source: "eastmoney-push2his",
    run: () => getKline(code, HISTORY_MAX_BARS),
  };
  const chain = order === "em-first" ? [em, baidu, sina] : [baidu, sina, em];
  return runFailover("full-kline", chain);
}

/** 拉「增量」窗口（最近 n 根）：优先用支持小 n 的源（新浪 / 东财）省流量，百度兜底切片。 */
function fetchRecent(code: string, order: "em-first" | "baidu-first", n: number, fq: FqMode): Promise<Sourced<Candle[]>> {
  if (fq === "hfq") {
    const emHfq: Candidate<Candle[]> = { source: "eastmoney-push2his(hfq)", run: () => getKline(code, n, 101, 2) };
    return runFailover("recent-kline-hfq", [emHfq]);
  }
  const sina: Candidate<Candle[]> = { source: "sina", run: () => getSinaKline(code, n) };
  const em: Candidate<Candle[]> = { source: "eastmoney-push2his", run: () => getKline(code, n) };
  const baidu: Candidate<Candle[]> = {
    source: "baidu",
    run: async () => baiduToCandles(await getBaiduKline(code), n),
  };
  const chain = order === "em-first" ? [em, sina, baidu] : [sina, em, baidu];
  return runFailover("recent-kline", chain);
}

/** 按日期去重合并（新数据覆盖同日旧数据，如当日盘中 bar），升序输出。 */
function mergeCandles(oldC: Candle[], newC: Candle[]): Candle[] {
  const m = new Map<string, Candle>();
  for (const c of oldC) m.set(c.date, c);
  for (const c of newC) m.set(c.date, c);
  return Array.from(m.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 复权漂移检测：对「已结算」重叠日期（早于盘内最后一根）比对收盘价，
 * 偏移超阈值的占比过高 → 判定发生除权除息导致前复权价整体平移，需全量刷新。
 */
function hasAdjustmentDrift(oldC: Candle[], recent: Candle[], lastDate: string): boolean {
  const oldByDate = new Map(oldC.map((c) => [c.date, c]));
  let compared = 0;
  let drifted = 0;
  for (const r of recent) {
    if (r.date >= lastDate) continue; // 跳过当日未结算 bar
    const o = oldByDate.get(r.date);
    if (!o || !o.close || !r.close) continue;
    compared++;
    if (Math.abs(r.close - o.close) / o.close > ADJ_TOLERANCE) drifted++;
  }
  if (compared < 5) return false; // 样本太少不轻易判漂移
  return drifted / compared > ADJ_DRIFT_FRACTION;
}

async function loadDailyHistory(code: string, order: "em-first" | "baidu-first", fq: FqMode): Promise<Sourced<Candle[]>> {
  const disk = await readDisk(code, fq);

  if (disk && disk.candles.length > 0) {
    const lastDate = disk.candles[disk.candles.length - 1].date;
    // 盘后若盘内缺最新结算交易日的日 K（收盘后仍停留在上一交易日），强制补一次增量；
    // 否则 12h「非交易时段新鲜窗口」内会一直看不到当日结算 bar。补齐后条件自动失效，不反复打网。
    const missingSettledBar = lastDate < latestSettledTradingDate();
    // 盘内足够新 → 直接回放，不打网络。
    if (!missingSettledBar && Date.now() - disk.updatedAt < freshMs()) {
      return { data: disk.candles, source: `${disk.source}+disk`, attempts: [] };
    }
    try {
      const recent = await fetchRecent(code, order, OVERLAP_BARS, fq);
      if (recent.data.length === 0) {
        return { data: disk.candles, source: `${disk.source}+disk(stale)`, attempts: recent.attempts };
      }
      // 增量窗口最早一根都晚于盘内最后一根 → 中间有缺口（断更过久 / 长期停牌）→ 全量刷新。
      const earliestNew = recent.data[0].date;
      if (earliestNew > lastDate) {
        const full = await fetchFull(code, order, fq);
        if (full.data.length >= disk.candles.length) {
          await writeDisk(code, full.data, full.source, fq);
          return { data: full.data, source: `${full.source}+full-refresh`, attempts: full.attempts };
        }
      }
      // 复权漂移 → 全量刷新（历史价整体平移，增量拼接会串档）。
      if (hasAdjustmentDrift(disk.candles, recent.data, lastDate)) {
        const full = await fetchFull(code, order, fq);
        if (full.data.length > 0) {
          await writeDisk(code, full.data, full.source, fq);
          return { data: full.data, source: `${full.source}+adj-refresh`, attempts: full.attempts };
        }
      }
      const merged = mergeCandles(disk.candles, recent.data);
      await writeDisk(code, merged, recent.source, fq);
      return { data: merged, source: `${recent.source}+incremental`, attempts: recent.attempts };
    } catch {
      // 网络全失败：降级回放盘内旧数据。
      return { data: disk.candles, source: `${disk.source}+disk(offline)`, attempts: [] };
    }
  }

  // 无盘内缓存 → 一次性全量拉取并落盘。
  const full = await fetchFull(code, order, fq);
  if (full.data.length > 0) await writeDisk(code, full.data, full.source, fq);
  return full;
}

/**
 * 取某只票的「完整日线历史」（约 10 年，前复权）。内部走盘内增量更新，
 * 并在内存层做请求合并 + 短 TTL 复用，避免一次请求内多处重复触发。
 */
export function getDailyHistory(
  code: string,
  order: "em-first" | "baidu-first" = "em-first",
  fq: FqMode = "qfq",
): Promise<Sourced<Candle[]>> {
  return globalCache.getOrCreate(
    `u:history:${code}:${order}:${fq}`,
    () => loadDailyHistory(code, order, fq),
    getAdaptiveTTL("kline"),
  );
}
