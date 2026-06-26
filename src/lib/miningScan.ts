import { promises as fs } from "fs";
import path from "path";
import {
  getDailyKline,
  getQuotesFailover,
  getStockRankList,
  emClist,
  getKlineName,
  getAnalystConsensus,
} from "./sources";
import type { Candle } from "./types";
import {
  evaluateMiningSignal,
  mapPool,
  passesFilters,
  rejectReason,
  type MiningCandidate,
  type MiningFilters,
  type MiningResult,
  type RejectReason,
} from "./mining";
import { rankNormalize } from "./portfolioBacktest";
import { getUniverseConfig, filterUniverse, isAllowed, type UniverseConfig } from "./universe";
import { getStrategy } from "./strategies";
import {
  getCachedUniverse,
  setCachedUniverse,
  universePhase,
  universeTtlMs,
  type UniversePhase,
} from "./universeCache";

/** 候选池解析阶段的进度回调（逐页拉取 / 命中缓存二选一）。 */
export interface UniverseProgress {
  /** 逐页串行拉取时每页回调一次（loaded=累计只数，pages=当前页号）。 */
  onPage?: (loaded: number, pages: number) => void;
  /** 命中候选池快照缓存时回调一次（免去逐页重拉）。 */
  onCacheHit?: (loaded: number, pages: number, ageMs: number, phase: UniversePhase, ttlMs: number) => void;
}

/** 给一个 Promise 套上超时上限（对标 SCS analyst-fallback：单只卡死不拖垮整批）。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

const ANALYST_PER_SYMBOL_TIMEOUT_MS = 8000;

/**
 * 智能挖掘 —— 服务端扫描编排（统一入口）。
 *
 * 把「股票池解析 + 高并发取数 + 信号评估 + 进度回调」收敛到一处，供
 *   - `/api/mining`（交互式流式扫描）
 *   - `/api/mining/daily`（每日全市场扫描存盘）
 * 共用，避免逻辑分散、口径不一。所有取数都走统一数据接口层（`@/lib/sources`），
 * 自带 push2→push2delay 兜底、限流与缓存。
 */

export type Universe = "hot" | "broad" | "sector" | "custom" | "full" | "demo";
export type SortField = "amount" | "changePct" | "turnover" | "volumeRatio";

export interface MiningRequest {
  universe?: Universe;
  sector?: string; // BK 代码（universe=sector 时）
  codes?: string[]; // 自定义代码（universe=custom 时）
  size?: number; // 候选池规模（broad 默认 300、hot 默认 100，最大 5000）
  sort?: SortField; // broad 排序字段（默认成交额）
  concurrency?: number; // 并发度（默认 8，区间 4–32）
  retries?: number; // K 线拉取失败重试次数（默认 3，最多 10）
  filters?: MiningFilters;
  /** 「B 买入信号」所用买卖策略 id（取自策略注册表 strategies.ts）；缺省回退内置瓶颈动量 v1。 */
  strategyId?: string;
  stream?: boolean; // 默认 true → NDJSON 流；false → 一次性 JSON（便于 cron）
  /**
   * 「两段漏斗」第 1 段：用候选池已带的批量字段（成交额/换手/量比）先粗筛，
   * 再对幸存者做昂贵的 K 线取数+信号评估，避免对全市场逐只拉 K 线。
   * full/broad 默认开启（见 DEFAULT_FULL_PREFILTER）；传 null 可显式关闭。
   */
  prefilter?: Prefilter | null;
  /** 是否对命中结果补充「卖方一致预期」维度（额外限流请求，仅打 topN 只）。 */
  withAnalyst?: boolean;
  /** withAnalyst 时补充的最大只数（默认 20，最多 100）。 */
  analystTopN?: number;
}

/** 候选池粗筛阈值（基于 clist 批量字段，零额外请求）。 */
export interface Prefilter {
  /** 最低成交额（元），过滤僵尸股/极低流动性。 */
  minAmount?: number;
  /** 最低换手率 %。 */
  minTurnover?: number;
  /** 最低量比。 */
  minVolumeRatio?: number;
  /** 粗筛后按成交额倒序保留的上限只数。 */
  maxCandidates?: number;
}

/** full/broad 全市场场景默认粗筛：≥1 亿成交额，最多 800 只（按成交额倒序）。 */
export const DEFAULT_FULL_PREFILTER: Prefilter = {
  minAmount: 1e8,
  maxCandidates: 800,
};

export const MAX_SIZE = 5000;

function marketOfCode(code: string): "SH" | "SZ" | "BJ" {
  const h = code[0];
  if (h === "6" || h === "9" || h === "5") return "SH";
  if (h === "8" || h === "4") return "BJ";
  return "SZ";
}

interface ClistRow {
  f12?: string; // code
  f14?: string; // name
  f2?: number | string; // price
  f3?: number | string; // changePct
  f6?: number | string; // 成交额（元）
  f8?: number | string; // 换手率 %
  f10?: number | string; // 量比
}

function num(v: number | string | undefined): number {
  if (v == null || v === "-") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 东财 clist 板块段：依据股票池纯净化配置动态拼装。
 * SH 主板 m:1 t:2、SZ 主板 m:0 t:6、创业板 m:0 t:80、科创板 m:1 t:23、北交所 m:0 t:81 s:2048。
 * 配置剔除的板块直接不从源头拉取（省请求），ST/B 股等再由 filterUniverse 统一过滤。
 */
function boardSegments(cfg: UniverseConfig): string[] {
  const seg = ["m:1 t:2", "m:0 t:6"]; // 沪深主板始终包含
  if (!cfg.excludeChiNext) seg.push("m:0 t:80"); // 创业板
  if (!cfg.excludeStar) seg.push("m:1 t:23"); // 科创板
  if (!cfg.excludeBeijing) seg.push("m:0 t:81 s:2048"); // 北交所
  return seg;
}

/** 全市场排序字段 → 东财 clist 的 fid。 */
const SORT_FID: Record<string, string> = {
  amount: "f6", // 成交额
  changePct: "f3", // 涨跌幅
  turnover: "f8", // 换手率
  volumeRatio: "f10", // 量比
};

/** 全市场 / 主板候选池：按指定字段倒序取前 pz 只（板块范围依股票池纯净化配置）。 */
async function fetchBroadUniverse(pz: number, fid = "f6"): Promise<MiningCandidate[]> {
  const diff = (await emClist({
    pn: 1, pz, po: 1, np: 1, fltt: 2, invt: 2, fid,
    fs: boardSegments(getUniverseConfig()).join(","),
    fields: "f12,f14,f2,f3,f6,f8,f10",
  })) as unknown as ClistRow[];
  return diff
    .filter((r) => r.f12 && /^\d{6}$/.test(r.f12))
    .map((r) => rowToCandidate(r));
}

/** clist 行 → 候选（含两段漏斗用的批量字段：成交额/换手/量比）。 */
function rowToCandidate(r: ClistRow): MiningCandidate {
  return {
    code: r.f12 as string,
    name: r.f14 || `证券${r.f12}`,
    price: num(r.f2),
    changePct: num(r.f3),
    amount: num(r.f6),
    turnoverPct: num(r.f8),
    volumeRatio: num(r.f10),
    market: marketOfCode(r.f12 as string),
  };
}

/**
 * 「两段漏斗」第 1 段：用候选池已带的批量字段做粗筛。
 * 仅对带有相应字段的候选生效（字段缺失视为通过，避免误杀），
 * 再按成交额倒序截断到 maxCandidates。返回粗筛后的候选数组。
 */
export function applyPrefilter(
  cands: MiningCandidate[],
  pf: Prefilter,
): MiningCandidate[] {
  let kept = cands.filter((c) => {
    if (pf.minAmount != null && c.amount != null && c.amount < pf.minAmount) return false;
    if (pf.minTurnover != null && c.turnoverPct != null && c.turnoverPct < pf.minTurnover) return false;
    if (pf.minVolumeRatio != null && c.volumeRatio != null && c.volumeRatio < pf.minVolumeRatio) return false;
    return true;
  });
  if (pf.maxCandidates != null && kept.length > pf.maxCandidates) {
    kept = [...kept]
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, pf.maxCandidates);
  }
  return kept;
}

/**
 * 全量全市场候选池：板块范围由「股票池纯净化」配置决定（设置页可调），
 * 默认沪深主板 + 创业板、剔除科创板/北交所，ST/*ST/退/B 股再由 filterUniverse 统一剔除。
 * 逐页拉取（统一 clist 兜底+限流）。
 */
async function fetchFullUniverse(
  prog?: UniverseProgress,
  pf?: Prefilter | null,
): Promise<MiningCandidate[]> {
  const segments = boardSegments(getUniverseConfig()).join(",");
  const sig = prefilterSig(pf);

  // 先查按时段自适应 TTL 的候选池快照缓存。命中条件：
  //   - 完整快照（complete!==false，含旧快照）：可服务任意粗筛口径；
  //   - 提前终止得到的「部分快照」：仅当粗筛签名一致时可复用（其前缀即所需 top-N）。
  const now = new Date();
  const cached = await getCachedUniverse(segments, now);
  if (cached && (cached.complete !== false || cached.prefilterSig === sig)) {
    prog?.onCacheHit?.(
      cached.candidates.length,
      cached.pages,
      now.getTime() - cached.fetchedAt,
      universePhase(now),
      universeTtlMs(now),
    );
    return cached.candidates;
  }

  // 东财 clist 每页上限 100（push2delay 会把更大的 pz 截到 100），故必须翻页。
  // 关键提速：clist 按成交额（fid=f6, po=1）严格倒序返回，因此在以下任一条件成立时
  // 可提前终止翻页——后续页成交额只会更低，绝不可能再进入粗筛结果：
  //   ① 已集齐 maxCandidates 只「过板块过滤 + 过 min-* 阈值」的候选（与最终结果同口径）；
  //   ② 整页末行成交额已 < minAmount（该页之后全部更低，必被 minAmount 卡掉）。
  // 请求速率不变（仍单并发 + 最小 1s 限流 + 抖动），但总请求数从 ~50 页降到个位数，
  // 全程零额外封 IP 风险（请求更少 = 风险更低）。无粗筛口径（pf 为空）时不提前终止，
  // 仍拉完整全市场（complete=true，可被任意口径复用）。
  const PAGE = 100;
  const MAX_PAGES = 80; // 安全上限（8000 只），防止异常时无限翻页
  const cap = pf?.maxCandidates;
  const rows: ClistRow[] = [];
  let pages = 0;
  let reachedEnd = false;
  let earlyStopped = false;
  const qualifiedSeen = new Set<string>();
  let qualified = 0;
  for (let pn = 1; pn <= MAX_PAGES; pn++) {
    const diff = (await emClist({
      pn, pz: PAGE, po: 1, np: 1, fltt: 2, invt: 2, fid: "f6",
      fs: segments, fields: "f12,f14,f2,f3,f6,f8,f10",
    })) as unknown as ClistRow[];
    if (!diff || diff.length === 0) { reachedEnd = true; break; }
    rows.push(...diff);
    pages = pn;
    // 候选池拉取阶段每页回调一次进度，让前端有可见反馈，避免长时间「点了不动」。
    prog?.onPage?.(rows.length, pn);
    if (diff.length < PAGE) { reachedEnd = true; break; } // 最后一页（已完整拉完）

    // —— 提前终止判定（仅在配置了 maxCandidates 上限时启用）——
    // 无 cap（如「生成今日股票池」要全量覆盖）时不提前终止，仍拉完整全市场，
    // 得到 complete=true 的快照可被任意口径复用（避免与 top-N 部分快照互相挤兑缓存）。
    if (cap != null) {
      for (const r of diff) {
        const code = r.f12;
        if (!code || !/^\d{6}$/.test(code) || qualifiedSeen.has(code)) continue;
        if (!isAllowed(code, r.f14)) continue; // 与 filterUniverse 同口径（剔除 ST/退/B 等）
        if (pf?.minAmount != null && num(r.f6) < pf.minAmount) continue;
        if (pf?.minTurnover != null && num(r.f8) < pf.minTurnover) continue;
        if (pf?.minVolumeRatio != null && num(r.f10) < pf.minVolumeRatio) continue;
        qualifiedSeen.add(code);
        qualified++;
      }
      if (qualified >= cap) { earlyStopped = true; break; } // 已集齐 top-maxCandidates（按成交额）
      if (pf?.minAmount != null && num(diff[diff.length - 1].f6) < pf.minAmount) {
        // 整页末行成交额已跌破 minAmount（clist 倒序，后续页只会更低）：即便不足
        // maxCandidates 只，后续也不可能再有过 minAmount 的票，可安全终止。
        earlyStopped = true;
        break;
      }
    }
  }

  const seen = new Set<string>();
  const candidates = rows
    .filter((r) => r.f12 && /^\d{6}$/.test(r.f12))
    .filter((r) => !seen.has(r.f12 as string) && seen.add(r.f12 as string)) // 跨页去重
    .map((r) => rowToCandidate(r));

  // 落盘 + 内存缓存，供 TTL 内的后续扫描秒级复用。
  // complete=true：拉完整全市场，可服务任意口径；提前终止则为部分快照，记录粗筛签名。
  const complete = reachedEnd && !earlyStopped;
  await setCachedUniverse({ segments, fetchedAt: Date.now(), pages, candidates, complete, prefilterSig: sig });
  return candidates;
}

/** 粗筛签名：部分快照缓存复用判定用（口径一致才可复用提前终止得到的前缀）。 */
function prefilterSig(pf?: Prefilter | null): string {
  if (!pf) return "full";
  return `a:${pf.minAmount ?? ""}|t:${pf.minTurnover ?? ""}|v:${pf.minVolumeRatio ?? ""}|n:${pf.maxCandidates ?? ""}`;
}

/** 东财人气榜 Top100 作为候选池（统一 emappdata 接口）。 */
async function fetchHotUniverse(): Promise<MiningCandidate[]> {
  const rank = await getStockRankList(100);
  return enrichNames(rank.map((r) => r.code));
}

/** 给一组代码补全名称/现价/涨幅：统一批量行情接口（腾讯批量 → 东财兜底，不封 IP）。 */
async function enrichNames(codes: string[]): Promise<MiningCandidate[]> {
  const out = new Map<string, MiningCandidate>();
  for (const code of codes) out.set(code, { code, name: `证券${code}`, market: marketOfCode(code) });
  const quoteMap = await getQuotesFailover(codes);
  for (const code of codes) {
    const q = quoteMap[code];
    if (q) {
      out.set(code, {
        code,
        name: q.name || `证券${code}`,
        price: q.price,
        changePct: q.changePct,
        market: q.market,
      });
    }
  }
  return codes.map((c) => out.get(c) as MiningCandidate);
}

/** 读取本地已同步的板块成分股映射（运行时产物）。 */
async function loadSectorStocksMap(): Promise<Record<string, Array<{ code: string; name: string }>>> {
  try {
    const p = path.join(process.cwd(), "data", "sector_stocks_map.json");
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as Record<string, Array<{ code: string; name: string }>>;
  } catch {
    return {};
  }
}

/** 用 secondary 去重补足 primary 到 target 数量。 */
function fillUnique(primary: MiningCandidate[], secondary: MiningCandidate[], target: number): MiningCandidate[] {
  const seen = new Set(primary.map((c) => c.code));
  for (const c of secondary) {
    if (primary.length >= target) break;
    if (c.code && !seen.has(c.code)) {
      seen.add(c.code);
      primary.push(c);
    }
  }
  return primary;
}

async function resolveUniverseRaw(
  body: MiningRequest,
  prog?: UniverseProgress,
  pf?: Prefilter | null,
): Promise<MiningCandidate[]> {
  const universe = body.universe || "hot";
  if (universe === "custom") {
    const codes = (body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c));
    return enrichNames(Array.from(new Set(codes)));
  }
  if (universe === "sector") {
    const map = await loadSectorStocksMap();
    const list = body.sector ? map[body.sector] ?? [] : Object.values(map).flat();
    const codes = Array.from(new Set(list.map((s) => s.code).filter((c) => /^\d{6}$/.test(c))));
    return enrichNames(codes);
  }
  if (universe === "full") {
    return fetchFullUniverse(prog, pf);
  }
  if (universe === "broad") {
    const size = Math.max(20, Math.min(MAX_SIZE, body.size ?? 300));
    const fid = SORT_FID[body.sort ?? "amount"] ?? "f6";
    return fetchBroadUniverse(size, fid);
  }
  // hot：人气榜 Top100；若目标数量 > 100，按成交额从全市场自动补足到 target。
  const hot = await fetchHotUniverse();
  const target = Math.max(1, Math.min(MAX_SIZE, body.size ?? 100));
  if (target <= hot.length) return hot.slice(0, target);
  const fill = await fetchBroadUniverse(target, "f6").catch(() => [] as MiningCandidate[]);
  return fillUnique(hot, fill, target);
}

/**
 * 解析候选股票池并统一应用「股票池纯净化」配置（剔除科创/北交所/ST/B 股等，
 * 口径由 /settings 持久化配置决定）。所有 universe 类型（含 custom/sector）都过滤，
 * 确保全站口径一致。
 */
export async function resolveUniverse(
  body: MiningRequest,
  prog?: UniverseProgress,
  pf?: Prefilter | null,
): Promise<MiningCandidate[]> {
  const raw = await resolveUniverseRaw(body, prog, pf);
  return filterUniverse(raw);
}

/**
 * 拉取 K 线并带失败重试：getDailyKline 在网络失败/限流时返回空数组（[]），
 * 此时重试最多 retries 次（递增退避）；若返回的是「有数据但不足」则属于
 * 真正的次新股/历史不足，重试也不会变多，直接返回不浪费时间。
 */
async function fetchCandlesWithRetry(
  code: string,
  retries: number,
): Promise<{ candles: Candle[]; source: string }> {
  let source = "none";
  for (let i = 0; i <= retries; i++) {
    try {
      // 与 /chart 的 getKlineFailover(code,360,101) 完全一致：取 390 根再切末 360 根，
      // 共用同一缓存键 → 同一只股票在「图表」和「挖掘」拿到逐字节相同的 K 线，
      // 保证 B 信号判定一致（同算法 + 同数据 = 同结果）。
      const r = await getDailyKline(code, 390, "baidu-first");
      source = r.source;
      if (r.data.length > 0) return { candles: r.data.slice(-360), source }; // 有数据即返回（次新/停牌重试无益）
    } catch {
      /* 全源均失败，退避后重试 */
    }
    if (i < retries) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  return { candles: [], source };
}

async function scanOne(
  cand: MiningCandidate,
  retries: number,
  strategyId?: string,
): Promise<{ result: MiningResult | null; source: string }> {
  const { candles, source } = await fetchCandlesWithRetry(cand.code, retries);
  if (candles.length < 60) return { result: null, source };
  // 「补名字」失败时名称会退回 `证券<代码>`，用 K 线接口自带的权威名回填。
  if (!cand.name || cand.name === `证券${cand.code}`) {
    const kn = getKlineName(cand.code);
    if (kn) cand.name = kn;
  }
  return { result: evaluateMiningSignal({ ...cand, candles }, { strategyId }), source };
}

// ---------------- 演示数据（离线、无网络） ----------------

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

function demoCandles(seed: number, kind: "bottomUp" | "down" | "extended" | "range"): Candle[] {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let p = 8 + rnd() * 30;
  const N = 220;
  for (let i = 0; i < N; i++) {
    let drift: number;
    if (kind === "down") drift = -0.008;
    else if (kind === "extended") drift = 0.012;
    else if (kind === "range") drift = i < N - 40 ? (rnd() - 0.5) * 0.004 : 0.006;
    else drift = i < 80 ? -0.014 : i < 150 ? (rnd() - 0.5) * 0.01 : 0.013; // bottomUp
    p *= 1 + drift + (rnd() - 0.5) * 0.012;
    p = Math.max(1, p);
    const turnover = (kind === "bottomUp" && i >= 150) || (kind === "range" && i >= N - 40) ? 2.8 + rnd() * 2 : 1 + rnd();
    const d = new Date(2025, 0, 1);
    d.setDate(d.getDate() + i);
    out.push({
      date: d.toISOString().slice(0, 10),
      open: +(p * 0.996).toFixed(2),
      close: +p.toFixed(2),
      high: +(p * (1.01 + rnd() * 0.02)).toFixed(2),
      low: +(p * (0.99 - rnd() * 0.02)).toFixed(2),
      volume: Math.round(1e6 * (1 + rnd())),
      amount: Math.round(1e6 * p),
      changePct: 0,
      turnoverPct: +turnover.toFixed(2),
    });
  }
  return out;
}

function demoStocks(): { cand: MiningCandidate; candles: Candle[] }[] {
  const kinds: Array<"bottomUp" | "down" | "extended" | "range"> = [
    "bottomUp", "bottomUp", "bottomUp", "bottomUp", "bottomUp", "bottomUp",
    "range", "range", "range", "range",
    "extended", "extended", "extended",
    "down", "down", "down", "down",
  ];
  const names = ["瓶颈科技", "隐冠材料", "启明半导", "凌云装备", "星河生物", "远峰新能", "沧海智能", "北辰精工", "东隅医疗", "南山高端", "霁月软件", "承光光电", "长策传感", "未名化工", "暮云地产", "旧岸钢铁", "残阳航运"];
  return kinds.map((kind, i) => {
    const code = String(600100 + i * 7).padStart(6, "0");
    const candles = demoCandles(1000 + i, kind);
    return {
      cand: { code, name: names[i % names.length], market: "SH", price: candles[candles.length - 1].close, changePct: +((Math.random() - 0.3) * 4).toFixed(2) },
      candles,
    };
  });
}

// ---------------- 扫描编排 ----------------

export type ScanEvent =
  | {
      type: "meta";
      total: number;
      universe: string;
      concurrency: number;
      rawTotal?: number;
      filters?: MiningFilters;
      prefilter?: Prefilter | null;
      strategyId?: string;
      strategyName?: string;
    }
  | { type: "universe"; loaded: number; pages: number; cached?: boolean; ageMs?: number; phase?: string; ttlMs?: number }
  | { type: "result"; item: MiningResult }
  | {
      type: "progress";
      scanned: number;
      total: number;
      matched: number;
      failed: number;
      code: string;
      name: string;
      outcome: "matched" | "filtered" | "failed";
      source: string;
      score?: number;
      ret?: number;
    }
  | {
      type: "done";
      scanned: number;
      failed: number;
      matched: number;
      elapsedMs: number;
      /** 未命中原因分布（被各筛选项卡掉的只数 + 取数失败 fetchFailed）。 */
      reasons?: Record<string, number>;
    }
  | { type: "error"; message: string };

export interface ScanSummary {
  total: number;
  scanned: number;
  failed: number;
  matched: number;
  elapsedMs: number;
}

/**
 * 运行一次完整扫描：解析股票池 → 有界并发取数+评估 → 过滤+排序。
 * `onEvent` 可选，用于流式进度（meta/progress/result/done）。返回汇总 + 命中结果。
 * 抛错由调用方捕获（流式场景包装为 error 事件）。
 */
export async function runMiningScan(
  body: MiningRequest,
  onEvent?: (ev: ScanEvent) => void,
): Promise<{ summary: ScanSummary; results: MiningResult[] }> {
  const concurrency = Math.max(4, Math.min(32, body.concurrency ?? 8));
  const retries = Math.max(0, Math.min(10, body.retries ?? 3));
  const filters: MiningFilters = body.filters ?? {};
  const strategyId = body.strategyId;
  const isDemo = body.universe === "demo";

  // 两段漏斗第 1 段的粗筛口径需在「拉取候选池前」算好：full 全市场据此可在
  // 集齐 top-maxCandidates 时提前终止翻页（同一份 pf 复用于候选池提前终止、
  // 粗筛截断、meta 回显，口径一致）。显式传 prefilter 优先，传 null 关闭。
  let pf: Prefilter | null = null;
  if (!isDemo) {
    if (body.prefilter !== undefined) pf = body.prefilter;
    else if (body.universe === "full" || body.universe === "broad") pf = DEFAULT_FULL_PREFILTER;
  }

  const demoMap = new Map<string, Candle[]>();
  let candidates: MiningCandidate[];
  if (isDemo) {
    const stocks = demoStocks();
    candidates = stocks.map((s) => s.cand);
    for (const s of stocks) demoMap.set(s.cand.code, s.candles);
  } else {
    // 候选池解析阶段（尤其 full 全市场逐页拉取）较耗时，逐页回报进度，
    // 使前端在「开始扫描」前的等待期也有日志滚动，不再像「点了不动」。
    candidates = await resolveUniverse(body, {
      onPage: (loaded, pages) => onEvent?.({ type: "universe", loaded, pages }),
      onCacheHit: (loaded, pages, ageMs, phase, ttlMs) =>
        onEvent?.({ type: "universe", loaded, pages, cached: true, ageMs, phase, ttlMs }),
    }, pf);
  }

  // 去重
  const seen = new Set<string>();
  candidates = candidates.filter((c) => c && c.code && !seen.has(c.code) && seen.add(c.code));

  // 两段漏斗第 1 段：粗筛截断（full/broad 默认开启；提前终止时候选池已是 top-N 前缀，
  // 此处再按 maxCandidates 精确截断，结果与拉全量一致）。
  const rawTotal = candidates.length;
  if (!isDemo && pf) candidates = applyPrefilter(candidates, pf);

  const t0 = Date.now();
  const total = candidates.length;
  // 回显本次筛选+粗筛条件与策略源，便于排查（如 0 命中时核对阈值是否过严）。
  const strat = strategyId ? getStrategy(strategyId) : undefined;
  const strategyName = strat ? `${strat.meta.name} v${strat.meta.version}` : undefined;
  onEvent?.({
    type: "meta",
    total,
    universe: body.universe || "hot",
    concurrency,
    rawTotal,
    filters,
    prefilter: pf,
    strategyId,
    strategyName,
  });

  const results: MiningResult[] = [];
  let scanned = 0;
  let failed = 0;
  let matched = 0;
  // 未命中原因分布：被各筛选项卡掉的只数 + 取数失败。
  const reasons: Record<string, number> = {};
  const bump = (key: RejectReason | "fetchFailed") => {
    reasons[key] = (reasons[key] ?? 0) + 1;
  };

  if (total === 0) {
    onEvent?.({ type: "done", scanned: 0, failed: 0, matched: 0, elapsedMs: 0 });
    return { summary: { total: 0, scanned: 0, failed: 0, matched: 0, elapsedMs: 0 }, results: [] };
  }

  const worker = async (
    cand: MiningCandidate,
  ): Promise<{ result: MiningResult | null; source: string }> => {
    const demo = demoMap.get(cand.code);
    if (demo) {
      await new Promise((r) => setTimeout(r, 40));
      return { result: evaluateMiningSignal({ ...cand, candles: demo }, { strategyId }), source: "demo" };
    }
    return scanOne(cand, retries, strategyId);
  };

  await mapPool(candidates, concurrency, worker, (r, cand) => {
    scanned++;
    const res = r?.result ?? null;
    const source = r?.source ?? "none";
    let outcome: "matched" | "filtered" | "failed";
    if (!res) {
      failed++;
      outcome = "failed";
      bump("fetchFailed");
    } else if (passesFilters(res, filters)) {
      matched++;
      outcome = "matched";
      results.push(res);
      onEvent?.({ type: "result", item: res });
    } else {
      outcome = "filtered";
      const rr = rejectReason(res, filters);
      if (rr) bump(rr);
    }
    onEvent?.({
      type: "progress",
      scanned,
      total,
      matched,
      failed,
      code: cand.code,
      name: cand.name,
      outcome,
      source,
      score: res?.score,
      ret: res?.expectedReturnBase,
    });
  });

  results.sort((a, b) => b.score - a.score || b.expectedReturnBase - a.expectedReturnBase);

  // F3 截面相对排名：在命中结果集上给出「相对位置」（0–1，1=最优）。
  if (results.length > 0) {
    const sP = rankNormalize(results.map((r) => r.score));
    const eP = rankNormalize(results.map((r) => r.expectedReturnBase));
    results.forEach((r, i) => {
      r.percentile = {
        score: Math.round(sP[i] * 1000) / 1000,
        expectedReturn: Math.round(eP[i] * 1000) / 1000,
      };
    });
  }

  // 可选：对命中结果按分数 topN 补充「卖方一致预期」维度（低并发，避免触发东财风控）。
  // F4 韧性：单只超时降级（不拖垂整批），并用 anySucceeded 区分「后端宕机」与「确实无研报」。
  if (body.withAnalyst && results.length > 0) {
    const topN = Math.max(1, Math.min(100, body.analystTopN ?? 20));
    const top = results.slice(0, topN);
    let anySucceeded = false;
    await mapPool(top, Math.min(4, top.length), async (r) => {
      try {
        const { data } = await withTimeout(getAnalystConsensus(r.code), ANALYST_PER_SYMBOL_TIMEOUT_MS);
        anySucceeded = true;
        r.analyst = {
          buyRatio: data.buyRatio,
          reportCount: data.reportCount,
          impliedTarget: data.impliedTarget,
          upsidePct: data.upsidePct,
        };
      } catch {
        /* best-effort：超时/失败不影响主结果 */
      }
      return null;
    });
    if (!anySucceeded) {
      console.warn(`[mining] 卖方一致预期补充全部失败（${top.length} 只），疑似研报源不可用。`);
    }
  }

  const elapsedMs = Date.now() - t0;
  onEvent?.({ type: "done", scanned, failed, matched, elapsedMs, reasons });
  return { summary: { total, scanned, failed, matched, elapsedMs }, results };
}
