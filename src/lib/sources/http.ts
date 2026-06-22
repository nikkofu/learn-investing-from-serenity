/**
 * 共享 HTTP 工具：东财统一限流入口 emFetch()、push2 多 host 兜底、GBK 解码、数值辅助。
 *
 * 设计对应 a-stock-data 的 em_get()（数据源优先级 V3.2，东财防封）：
 *   - 所有 eastmoney.com 请求一律串行限流（最小间隔 + 随机抖动），避免触发风控封 IP。
 *   - push2 系接口（stock/get、clist、ulist、slist、fflow）境外/数据中心 IP 会被
 *     push2.eastmoney.com 返回 502，自动回退到 push2delay.eastmoney.com（实测全球可达）。
 *   - Keep-Alive 由 Node(undici) 全局连接池自动复用，无需手动管理 session。
 */

import iconv from "iconv-lite";
import { isAShareActiveTime } from "../cache";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 安全转 number，失败/缺省返回 0。 */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === "" || v === "-") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 转 number，无效返回 null（用于「无数据」与「0」需要区分的场景）。 */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 安全转字符串。 */
export function toStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

/** fetch + 超时 + 小重试（上游接口偶发抖动）。!res.ok 视为失败以触发重试/兜底。 */
export async function fetchRetry(url: string, init: FetchOpts = {}): Promise<Response> {
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
      if (attempt < retries) await sleep(350 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

/** 读取响应文本，可选 GBK 解码（腾讯/新浪/同花顺部分接口为 GBK）。 */
export async function readText(res: Response, gbk = false): Promise<string> {
  const buf = Buffer.from(await res.arrayBuffer());
  return gbk ? iconv.decode(buf, "gbk") : buf.toString("utf8");
}

/** 把对象拼成 query string。 */
export function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.set(k, String(v));
  }
  return u.toString();
}

// ── 东财防封：全局串行限流 + 随机抖动 ───────────────────────────────────
// 东财系接口（push2 / datacenter / reportapi / search / np-weblist）有风控：
// 每秒 >5 次 / 单 IP 并发 ≥10 / 1 分钟 ≥200 次 → 临时封 IP。
// 所有 eastmoney.com 请求都走 emFetch()：用一条 Promise 链把请求串起来，
// 每次至少间隔 EM_MIN_INTERVAL_MS + 100~500ms 抖动。批量任务可调大间隔。
const EM_MIN_INTERVAL_MS = Number(process.env.EM_MIN_INTERVAL_MS ?? 1000);
let emChain: Promise<unknown> = Promise.resolve();
let emLastCall = 0;

/** 东财统一请求入口：串行限流 + 默认 UA。所有 eastmoney.com 接口都应通过它。 */
export function emFetch(url: string, init: FetchOpts = {}): Promise<Response> {
  const run = async (): Promise<Response> => {
    const wait = EM_MIN_INTERVAL_MS - (Date.now() - emLastCall);
    if (wait > 0) await sleep(wait + 100 + Math.random() * 400);
    try {
      return await fetchRetry(url, {
        timeoutMs: 15000,
        retries: 1,
        ...init,
        headers: { "User-Agent": UA, ...(init.headers ?? {}) },
      });
    } finally {
      emLastCall = Date.now();
    }
  };
  // 串到链尾，无论上一个成功/失败都继续，避免链被一次失败打断。
  const result = emChain.then(run, run);
  emChain = result.catch(() => undefined);
  return result;
}

// push2 系接口的 host 兜底顺序（按封 IP / 实时性权衡）：
//   - 交易时段：先官方主站 push2.eastmoney.com（提供实时行情）→ 失败降级 push2delay；
//   - 非交易时段：直接 push2delay（push2 此时常无数据/部分网络不可达，先它省去等待）。
// 可用 EM_PUSH2_HOSTS 覆盖（逗号分隔，按序兜底），覆盖后不再按时段动态排序。
const PUSH2_PRIMARY = "push2.eastmoney.com";
const PUSH2_DELAY = "push2delay.eastmoney.com";

function push2Hosts(): string[] {
  const override = process.env.EM_PUSH2_HOSTS;
  if (override) {
    return override.split(",").map((h) => h.trim()).filter(Boolean);
  }
  return isAShareActiveTime()
    ? [PUSH2_PRIMARY, PUSH2_DELAY]
    : [PUSH2_DELAY, PUSH2_PRIMARY];
}

/**
 * 请求 push2 系接口（自动多 host 兜底 + 限流）。
 * path 形如 "/api/qt/stock/get"，params 为查询参数。
 * 非末位 host 采用「快速失败」（短超时 + 不重试），确保上一个 host 不可达时
 * 尽快降级到下一个，不会因长超时卡住整批请求。
 * 历史类接口（push2his）host 固定，不需要兜底，直接用 emFetch。
 */
export async function push2Json<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined>,
  init: FetchOpts = {},
): Promise<T> {
  const hosts = push2Hosts();
  let lastErr: unknown;
  for (let i = 0; i < hosts.length; i++) {
    const isLast = i === hosts.length - 1;
    try {
      const url = `https://${hosts[i]}${path}?${qs(params)}`;
      const res = await emFetch(url, {
        // 非末位 host：短超时、不重试 → 尽快降级；末位 host 用调用方/默认超时。
        ...(isLast ? {} : { timeoutMs: 2500, retries: 0 }),
        headers: { Referer: "https://quote.eastmoney.com/", ...(init.headers ?? {}) },
        ...init,
      });
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("push2 all hosts failed");
}

/** 东财数据中心统一查询（datacenter-web）— 龙虎榜/解禁/两融/大宗/股东户数/分红 共用。 */
export interface DatacenterParams {
  reportName: string;
  columns?: string;
  filter?: string;
  pageSize?: number;
  pageNumber?: number;
  sortColumns?: string;
  sortTypes?: string;
}

export async function emDatacenter(p: DatacenterParams): Promise<Array<Record<string, unknown>>> {
  const url =
    "https://datacenter-web.eastmoney.com/api/data/v1/get?" +
    qs({
      reportName: p.reportName,
      columns: p.columns ?? "ALL",
      filter: p.filter ?? "",
      pageNumber: String(p.pageNumber ?? 1),
      pageSize: String(p.pageSize ?? 50),
      sortColumns: p.sortColumns ?? "",
      sortTypes: p.sortTypes ?? "-1",
      source: "WEB",
      client: "WEB",
    });
  const res = await emFetch(url, { headers: { Referer: "https://data.eastmoney.com/" } });
  const d = (await res.json()) as { result?: { data?: Array<Record<string, unknown>> } };
  return d.result?.data ?? [];
}
