import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { globalCache } from "./cache";
import { syncPostsWithRemote, fetchSerenityJson } from "./knowledge";
import { emClist, getStockRankList, getQuotesFailover } from "./sources";
import { fetchTopTvStrategies, TV_STRATEGIES_PATH, type TvStrategiesFile } from "./tvScripts";

/**
 * 统一数据同步编排：把分散的同步能力收编为一处，供「数据同步中心」页面与自有程序统一调用。
 *
 * 生产级保障：
 *  - 先抓取 → 内存校验（格式 + 数据正常性）→ 才落盘；校验不通过绝不触碰本地旧文件。
 *  - 原子写入（先写 *.tmp 再 rename），杜绝半截损坏文件。
 *  - 防缩水守护：新数据量较上次骤减（疑似源故障/限流残缺）则拒写，保留旧版本。
 *  - 版本号 + 时间戳 + 内容哈希记录在 .data/sync/manifest.json；内容变更才版本号 +1。
 *  - 每次内容变更保留文件快照到 .data/sync/snapshots/<源>/（可回滚）。
 *
 * ⚠️ 仅在服务端运行（依赖 fs 与外部行情接口）。
 */

const DATA_DIR = path.join(process.cwd(), "data");
const APP_DATA_DIR = path.join(process.cwd(), ".data");
const SYNC_DIR = path.join(APP_DATA_DIR, "sync");
const SNAP_DIR = path.join(SYNC_DIR, "snapshots");
const MANIFEST_PATH = path.join(SYNC_DIR, "manifest.json");

const POSTS_PATH = path.join(APP_DATA_DIR, "x-posts.json");
const HOT_RANK_PATH = path.join(DATA_DIR, "hot_rank.json");
const HOT_SECTORS_PATH = path.join(DATA_DIR, "hot_sectors.json");
const SECTORS_META_PATH = path.join(DATA_DIR, "sectors_metadata.json");
const SECTOR_STOCKS_PATH = path.join(DATA_DIR, "sector_stocks_map.json");

export type SyncSourceId = "serenity" | "hotRank" | "industrySectors" | "sectorStocks" | "hotSectors" | "tvStrategies";

export interface SyncSourceMeta {
  id: SyncSourceId;
  label: string;
  description: string;
  /** 落盘文件（相对项目根，用于状态展示）。 */
  file: string;
  /** 该源较重、耗时较长（前端提示）。 */
  heavy?: boolean;
  /** 防缩水阈值：新数量低于「上次数量 × 该比例」即视为异常拒写（默认 0.5）。 */
  minRatio: number;
  /** 快照保留版本数（大文件可调小）。 */
  snapshotKeep: number;
}

/** 同步顺序即「依次同步全部」时的执行顺序。 */
export const SYNC_SOURCES: SyncSourceMeta[] = [
  {
    id: "serenity",
    label: "Serenity 最新消息",
    description: "从 GitHub 远程归档增量同步 Serenity（白毛股神）最新推文/研究成果。",
    file: ".data/x-posts.json",
    minRatio: 0.8,
    snapshotKeep: 2,
  },
  {
    id: "hotRank",
    label: "热门股票排行",
    description: "东方财富股吧人气榜 Top100，并补全实时价格/涨跌幅/换手率。",
    file: "data/hot_rank.json",
    minRatio: 0.5,
    snapshotKeep: 5,
  },
  {
    id: "industrySectors",
    label: "行业板块",
    description: "东方财富行业板块列表（Top120），用于板块热力与分类。",
    file: "data/sectors_metadata.json",
    minRatio: 0.6,
    snapshotKeep: 5,
  },
  {
    id: "sectorStocks",
    label: "个股清单（板块成分股）",
    description: "逐板块抓取成分股映射，供选股/扫描使用。该项请求较多、耗时较长。",
    file: "data/sector_stocks_map.json",
    heavy: true,
    minRatio: 0.6,
    snapshotKeep: 3,
  },
  {
    id: "hotSectors",
    label: "热门板块（概念）",
    description: "东方财富概念板块按当日涨幅排序的热门榜 Top60。",
    file: "data/hot_sectors.json",
    minRatio: 0.5,
    snapshotKeep: 5,
  },
  {
    id: "tvStrategies",
    label: "TradingView 热门策略（参考）",
    description: "抓取 TradingView 策略脚本列表第一页的公开元数据（名称/作者/链接/点赞/访问级别），建立可复刻清单。仅作外链参考，不抓源码、保留原作者署名。",
    file: ".data/tv-strategies.json",
    minRatio: 0.5,
    snapshotKeep: 5,
  },
];

const META_BY_ID: Record<SyncSourceId, SyncSourceMeta> = Object.fromEntries(
  SYNC_SOURCES.map((s) => [s.id, s])
) as Record<SyncSourceId, SyncSourceMeta>;

export interface VersionInfo {
  version: number;
  syncedAt: string;
  count: number;
  hash: string;
}

interface ManifestEntry {
  current: VersionInfo;
  history: VersionInfo[];
}

type Manifest = Record<string, ManifestEntry>;

export interface SyncResult {
  id: SyncSourceId;
  ok: boolean;
  count: number;
  message: string;
  durationMs: number;
  version?: number;
  changed?: boolean;
  error?: string;
}

export interface SyncSourceStatus extends SyncSourceMeta {
  available: boolean;
  count: number;
  lastSyncAt: string | null;
  version: number;
  /** 仅 serenity：远端 data/sync_state.json 的最新更新时间（实时拉取，失败为 null）。 */
  remoteUpdatedAt?: string | null;
  /** 仅 serenity：本地上次已应用的远端更新时间。 */
  localRemoteUpdatedAt?: string | null;
  /** 仅 serenity：本地是否已与远端最新一致。 */
  upToDate?: boolean;
}

// ---------------- 通用：原子写、哈希、清单、快照 ----------------

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath); // 同盘 rename 为原子操作
}

async function loadManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

async function saveManifest(m: Manifest): Promise<void> {
  await atomicWrite(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

async function pruneSnapshots(id: string, keep: number): Promise<void> {
  const dir = path.join(SNAP_DIR, id);
  try {
    const entries = await fs.readdir(dir);
    const sorted = entries.sort(); // v0001_... 文件名前缀零填充，字典序即时间序
    const excess = sorted.slice(0, Math.max(0, sorted.length - keep));
    await Promise.all(excess.map((f) => fs.rm(path.join(dir, f), { recursive: true, force: true })));
  } catch {
    /* 目录不存在则忽略 */
  }
}

async function snapshotFiles(id: string, version: number, syncedAt: string, files: { path: string }[], keep: number): Promise<void> {
  const tsSafe = syncedAt.replace(/[:.]/g, "-");
  const dir = path.join(SNAP_DIR, id, `v${String(version).padStart(4, "0")}_${tsSafe}`);
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) {
    try {
      await fs.copyFile(f.path, path.join(dir, path.basename(f.path)));
    } catch {
      /* 源文件可能因故缺失，跳过 */
    }
  }
  await pruneSnapshots(id, keep);
}

/**
 * 通用提交：以任意字符串 key 记录版本（供 sync 与 bundle 复用）。
 * @param hashSource 用于判定「内容是否变化」的稳定字符串（不含时间戳/版本号）。
 * @param buildFiles 给定 (version, syncedAt) 产出要写入的文件内容。
 */
async function commitVersionGeneric(opts: {
  key: string;
  count: number;
  hashSource: string;
  snapshotKeep: number;
  buildFiles: (version: number, syncedAt: string) => { path: string; content: string }[];
}): Promise<{ version: number; syncedAt: string; changed: boolean }> {
  const { key, count, hashSource, snapshotKeep, buildFiles } = opts;
  const manifest = await loadManifest();
  const prev = manifest[key]?.current;

  const hash = sha256(hashSource);
  const changed = !prev || prev.hash !== hash;
  const version = prev ? (changed ? prev.version + 1 : prev.version) : 1;
  const syncedAt = new Date().toISOString();

  const files = buildFiles(version, syncedAt);
  for (const f of files) await atomicWrite(f.path, f.content);

  if (changed) {
    await snapshotFiles(key, version, syncedAt, files, snapshotKeep);
  }

  const info: VersionInfo = { version, syncedAt, count, hash };
  const history = [...(manifest[key]?.history ?? []), info].slice(-20);
  manifest[key] = { current: info, history };
  await saveManifest(manifest);

  return { version, syncedAt, changed };
}

async function commitVersion(opts: {
  id: SyncSourceId;
  count: number;
  hashSource: string;
  buildFiles: (version: number, syncedAt: string) => { path: string; content: string }[];
}): Promise<{ version: number; syncedAt: string; changed: boolean }> {
  return commitVersionGeneric({
    key: opts.id,
    count: opts.count,
    hashSource: opts.hashSource,
    snapshotKeep: META_BY_ID[opts.id].snapshotKeep,
    buildFiles: opts.buildFiles,
  });
}

/** 通用防缩水守护：相对上次记录骤减则视为异常。首次（无 prev）放行。 */
async function guardShrinkGeneric(key: string, newCount: number, minRatio: number): Promise<void> {
  const manifest = await loadManifest();
  const prev = manifest[key]?.current;
  if (prev && prev.count > 0 && newCount < prev.count * minRatio) {
    throw new Error(
      `数据异常：本次仅 ${newCount} 条，较上次 ${prev.count} 条骤减（阈值 ${Math.round(minRatio * 100)}%），疑似源故障/限流，已拒绝覆盖旧数据。`
    );
  }
}

async function guardShrink(id: SyncSourceId, newCount: number): Promise<void> {
  return guardShrinkGeneric(id, newCount, META_BY_ID[id].minRatio);
}

// ---------------- Serenity 远端变更检测（sync_state.json） ----------------

/** Serenity 数据仓库的远端同步状态，由上游 data/sync_state.json 提供。 */
interface SerenityRemoteState {
  last_tweet_id?: string;
  last_update_time?: string;
  /** 本地记录该状态的时间。 */
  fetchedAt?: string;
}

const SERENITY_REMOTE_STATE_PATH = path.join(SYNC_DIR, "serenity_remote.json");

/** 拉取远端 sync_state.json（仅几百字节，用于廉价的「是否有新数据」判断）。失败返回 null，不阻断同步。 */
async function fetchSerenityRemoteState(): Promise<SerenityRemoteState | null> {
  try {
    // 小文件，缩短超时；多源回退（raw 优先以保证状态最新）。
    const { data: j } = await fetchSerenityJson<SerenityRemoteState>("sync_state.json", 12000);
    if (!j || (!j.last_tweet_id && !j.last_update_time)) return null;
    return { last_tweet_id: j.last_tweet_id, last_update_time: j.last_update_time };
  } catch {
    return null;
  }
}

/** 读取本地上次已应用的远端状态。 */
async function loadSerenityRemoteState(): Promise<SerenityRemoteState | null> {
  try {
    return JSON.parse(await fs.readFile(SERENITY_REMOTE_STATE_PATH, "utf8")) as SerenityRemoteState;
  } catch {
    return null;
  }
}

// ---------------- 各数据源同步实现（先校验，后提交） ----------------

async function syncSerenity(force = false): Promise<{ count: number; message: string; version: number; changed: boolean }> {
  // 变更检测：先拉几百字节的 sync_state.json，与本地已应用状态比对；
  // 若 last_tweet_id 与 last_update_time 均未变且本地已有数据，则跳过 8MB 全量下载。
  const remote = await fetchSerenityRemoteState();
  if (!force && remote?.last_update_time) {
    const local = await loadSerenityRemoteState();
    const prev = (await loadManifest())["serenity"]?.current;
    if (
      prev &&
      local?.last_update_time === remote.last_update_time &&
      local?.last_tweet_id === remote.last_tweet_id
    ) {
      return {
        count: prev.count,
        message: `远端无新数据（last_update_time ${remote.last_update_time} 未变），已跳过下载`,
        version: prev.version,
        changed: false,
      };
    }
  }

  // knowledge.syncPostsWithRemote 内部已加固（远端非空校验 + 原子写）。这里负责版本化与防缩水记录。
  const r = await syncPostsWithRemote();
  if (!r.totalCount || r.totalCount <= 0) throw new Error("同步后本地推文为空，已判为异常");
  await guardShrink("serenity", r.totalCount);
  // 文件已由 knowledge 原子写入；读回内容用于快照。
  const content = await fs.readFile(POSTS_PATH, "utf8");
  // 哈希仅取推文数据（剔除每次都会变化的 scrapedAt 时间戳），使「内容未变→版本不变」成立。
  let hashSource = content;
  try {
    const parsed = JSON.parse(content) as { posts?: unknown[] };
    hashSource = JSON.stringify(parsed.posts ?? []);
  } catch {
    /* 解析失败则退回整文件哈希 */
  }
  const { version, changed } = await commitVersion({
    id: "serenity",
    count: r.totalCount,
    hashSource,
    buildFiles: () => [{ path: POSTS_PATH, content }],
  });
  // 记录本次已应用的远端状态，供下次变更检测比对。
  if (remote) {
    await atomicWrite(
      SERENITY_REMOTE_STATE_PATH,
      JSON.stringify({ ...remote, fetchedAt: new Date().toISOString() }, null, 2)
    );
  }
  return { count: r.totalCount, message: `新增 ${r.newCount} 条，累计 ${r.totalCount} 条`, version, changed };
}

interface HotRankItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  turnoverPct: number;
  market: string;
}

function isStockCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

async function syncHotRank(): Promise<{ count: number; message: string; version: number; changed: boolean }> {
  // 榜单：统一 emappdata 接口（限流 + 全球可达）。
  const rankList = await getStockRankList(100);
  if (rankList.length < 30) {
    throw new Error(`人气榜返回异常（仅 ${rankList.length} 条），拒绝写入`);
  }

  // 补行情：统一 facade（腾讯批量 → 东财 push2delay 兜底，不直连被封的 push2）。
  const quoteMap = await getQuotesFailover(rankList.map((r) => r.code));

  const list: HotRankItem[] = rankList.map((item) => {
    const q = quoteMap[item.code];
    return {
      rank: item.rank,
      code: item.code,
      name: q?.name || item.sc,
      price: q?.price ?? 0,
      changePct: q?.changePct ?? 0,
      turnoverPct: q?.turnoverPct ?? 0,
      market: item.market,
    };
  });

  // 校验：代码格式正确的占比需达标，避免拉到一堆脏数据。
  const validCodes = list.filter((x) => isStockCode(x.code)).length;
  if (validCodes < list.length * 0.8) {
    throw new Error(`人气榜数据校验失败：有效股票代码仅 ${validCodes}/${list.length}，拒绝写入`);
  }

  await guardShrink("hotRank", list.length);
  const { version, changed } = await commitVersion({
    id: "hotRank",
    count: list.length,
    hashSource: JSON.stringify(list),
    buildFiles: (v, ts) => [{ path: HOT_RANK_PATH, content: JSON.stringify({ source: "hotRank", version: v, syncedAt: ts, count: list.length, list }, null, 2) }],
  });
  globalCache.delete("market:hot-rank");
  return { count: list.length, message: `已同步热门股 ${list.length} 只`, version, changed };
}

async function fetchIndustrySectorList(): Promise<Array<{ code: string; name: string }>> {
  // 统一 clist（push2→push2delay 兜底 + 限流）。fs 用空格分隔，由 URLSearchParams 编码为 +。
  const raw = (await emClist({
    pn: 1, pz: 120, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
    fs: "m:90 t:2 f:!2", fields: "f12,f14",
  })) as Array<{ f12?: string; f14?: string }>;
  return raw
    .map((s) => ({ code: s.f12 || "", name: s.f14 || "" }))
    .filter((s) => s.code && s.name);
}

async function syncIndustrySectors(): Promise<{ count: number; message: string; version: number; changed: boolean }> {
  const sectors = await fetchIndustrySectorList();
  if (sectors.length < 20) throw new Error(`行业板块返回异常（仅 ${sectors.length} 个），拒绝写入`);
  await guardShrink("industrySectors", sectors.length);
  const { version, changed } = await commitVersion({
    id: "industrySectors",
    count: sectors.length,
    hashSource: JSON.stringify(sectors),
    buildFiles: () => [{ path: SECTORS_META_PATH, content: JSON.stringify(sectors, null, 2) }],
  });
  globalCache.delete("market:sectors");
  globalCache.delete("market:sectors:all_raw");
  return { count: sectors.length, message: `已同步行业板块 ${sectors.length} 个`, version, changed };
}

async function readSectorMeta(): Promise<Array<{ code: string; name: string }>> {
  try {
    return JSON.parse(await fs.readFile(SECTORS_META_PATH, "utf8"));
  } catch {
    return [];
  }
}

async function syncSectorStocks(): Promise<{ count: number; message: string; version: number; changed: boolean }> {
  let sectors = await readSectorMeta();
  if (sectors.length === 0) {
    sectors = await fetchIndustrySectorList();
    if (sectors.length > 0) await atomicWrite(SECTORS_META_PATH, JSON.stringify(sectors, null, 2));
  }
  if (sectors.length === 0) throw new Error("无可用板块元数据，无法同步成分股");

  const map: Record<string, Array<{ code: string; name: string }>> = {};
  let totalStocks = 0;
  let failed = 0;
  for (const s of sectors) {
    try {
      // 统一 clist（push2→push2delay 兜底 + 内置限流）。
      const raw = (await emClist({
        pn: 1, pz: 80, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
        fs: `b:${s.code}`, fields: "f12,f14",
      })) as Array<{ f12?: string; f14?: string }>;
      const stocks = raw.map((x) => ({ code: x.f12 || "", name: x.f14 || "" })).filter((x) => x.code && x.name);
      map[s.code] = stocks;
      totalStocks += stocks.length;
    } catch {
      map[s.code] = [];
      failed++;
    }
  }

  // 校验：失败板块占比过高 或 成分股总数为 0 视为异常。
  if (totalStocks === 0) throw new Error("成分股全部为空，拒绝写入");
  if (failed > sectors.length * 0.4) {
    throw new Error(`成分股抓取失败板块过多（${failed}/${sectors.length}），疑似限流，拒绝写入`);
  }

  await guardShrink("sectorStocks", totalStocks);
  const { version, changed } = await commitVersion({
    id: "sectorStocks",
    count: totalStocks, // 防缩水按成分股总数判定更敏感
    hashSource: JSON.stringify(map),
    buildFiles: () => [{ path: SECTOR_STOCKS_PATH, content: JSON.stringify(map, null, 2) }],
  });
  sectors.forEach((s) => {
    globalCache.delete(`market:sector-stocks:${s.code}`);
    globalCache.delete(`market:sector-stocks:top15:${s.code}`);
  });
  return { count: Object.keys(map).length, message: `已同步 ${sectors.length} 个板块、合计 ${totalStocks} 条成分股`, version, changed };
}

interface HotSectorItem {
  code: string;
  name: string;
  changePct: number;
  netInflow: number;
  leadStockName: string;
  leadStockCode: string;
  leadStockChangePct: number;
}

async function syncTvStrategies(): Promise<{ count: number; message: string; version: number; changed: boolean }> {
  const list = await fetchTopTvStrategies();
  if (!Array.isArray(list) || list.length < 5) {
    throw new Error(`TradingView 策略列表返回异常（仅 ${Array.isArray(list) ? list.length : 0} 条），拒绝写入`);
  }
  // 校验：带链接的占比需达标，避免落入残缺数据。
  const withUrl = list.filter((x) => x.url && x.name).length;
  if (withUrl < list.length * 0.8) {
    throw new Error(`TV 策略数据校验失败：有效条目仅 ${withUrl}/${list.length}，拒绝写入`);
  }

  await guardShrink("tvStrategies", list.length);
  // 哈希仅取「会随脚本变化」的稳定子集（id+更新时间+点赞），避免无意义版本跳动。
  const hashSource = JSON.stringify(list.map((x) => [x.id, x.updatedAt, x.likes]));
  const { version, changed } = await commitVersion({
    id: "tvStrategies",
    count: list.length,
    hashSource,
    buildFiles: (v, ts) => [
      {
        path: TV_STRATEGIES_PATH,
        content: JSON.stringify(
          { source: "tvStrategies", version: v, syncedAt: ts, count: list.length, list } satisfies TvStrategiesFile,
          null,
          2
        ),
      },
    ],
  });
  return { count: list.length, message: `已同步 TradingView 热门策略 ${list.length} 条`, version, changed };
}

async function syncHotSectors(): Promise<{ count: number; message: string; version: number; changed: boolean }> {
  // 统一 clist（push2→push2delay 兜底 + 限流）。fs 用空格分隔。
  const raw = (await emClist({
    pn: 1, pz: 60, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
    fs: "m:90 t:3 f:!2", fields: "f2,f3,f12,f14,f62,f128,f140,f141",
  })) as Array<Record<string, unknown>>;
  if (!Array.isArray(raw) || raw.length < 10) {
    throw new Error(`概念板块返回异常（仅 ${Array.isArray(raw) ? raw.length : 0} 个），拒绝写入`);
  }
  const num = (v: unknown) => (v != null && v !== "-" ? Number(v) : 0);
  const list: HotSectorItem[] = raw
    .map((r) => ({
      code: (r.f12 as string) || "",
      name: (r.f14 as string) || "未知板块",
      changePct: num(r.f3),
      netInflow: num(r.f62),
      leadStockName: (r.f128 as string) || "-",
      leadStockCode: (r.f140 as string) || "",
      leadStockChangePct: num(r.f141),
    }))
    .filter((x) => x.code);

  if (list.length < 10) throw new Error(`概念板块有效数据不足（${list.length} 个），拒绝写入`);
  await guardShrink("hotSectors", list.length);
  const { version, changed } = await commitVersion({
    id: "hotSectors",
    count: list.length,
    hashSource: JSON.stringify(list),
    buildFiles: (v, ts) => [{ path: HOT_SECTORS_PATH, content: JSON.stringify({ source: "hotSectors", version: v, syncedAt: ts, count: list.length, list }, null, 2) }],
  });
  return { count: list.length, message: `已同步热门概念板块 ${list.length} 个`, version, changed };
}

type SourceRunner = (force: boolean) => Promise<{ count: number; message: string; version: number; changed: boolean }>;

const RUNNERS: Record<SyncSourceId, SourceRunner> = {
  serenity: (force) => syncSerenity(force),
  hotRank: () => syncHotRank(),
  industrySectors: () => syncIndustrySectors(),
  sectorStocks: () => syncSectorStocks(),
  hotSectors: () => syncHotSectors(),
  tvStrategies: () => syncTvStrategies(),
};

/**
 * 运行单个数据源同步，返回结构化结果（不抛出，错误装入 result）。
 * @param force 对 serenity 源：跳过 sync_state.json 变更检测，强制全量重拉。
 */
export async function runSync(id: SyncSourceId, force = false): Promise<SyncResult> {
  const start = Date.now();
  const runner = RUNNERS[id];
  if (!runner) {
    return { id, ok: false, count: 0, message: "", durationMs: 0, error: `未知数据源: ${id}` };
  }
  try {
    const { count, message, version, changed } = await runner(force);
    return { id, ok: true, count, message, durationMs: Date.now() - start, version, changed };
  } catch (err) {
    return {
      id,
      ok: false,
      count: 0,
      message: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 依次运行全部数据源（顺序见 SYNC_SOURCES），遇错继续，返回每项结果。 */
export async function runAllSync(force = false): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const s of SYNC_SOURCES) {
    results.push(await runSync(s.id, force));
  }
  return results;
}

// ---------------- 状态读取 ----------------

async function statFile(p: string): Promise<string | null> {
  try {
    const st = await fs.stat(p);
    return st.mtime.toISOString();
  } catch {
    return null;
  }
}

async function readCount(meta: SyncSourceMeta): Promise<{ available: boolean; count: number }> {
  const tryJson = async <T>(p: string): Promise<T | null> => {
    try {
      return JSON.parse(await fs.readFile(p, "utf8")) as T;
    } catch {
      return null;
    }
  };
  switch (meta.id) {
    case "serenity": {
      const d = await tryJson<{ posts?: unknown[] }>(POSTS_PATH);
      return { available: !!d, count: d?.posts?.length ?? 0 };
    }
    case "hotRank": {
      const d = await tryJson<{ list?: unknown[] }>(HOT_RANK_PATH);
      return { available: !!d, count: d?.list?.length ?? 0 };
    }
    case "industrySectors": {
      const d = await tryJson<unknown[]>(SECTORS_META_PATH);
      return { available: Array.isArray(d), count: Array.isArray(d) ? d.length : 0 };
    }
    case "sectorStocks": {
      const d = await tryJson<Record<string, unknown[]>>(SECTOR_STOCKS_PATH);
      return { available: !!d, count: d ? Object.keys(d).length : 0 };
    }
    case "hotSectors": {
      const d = await tryJson<{ list?: unknown[] }>(HOT_SECTORS_PATH);
      return { available: !!d, count: d?.list?.length ?? 0 };
    }
    case "tvStrategies": {
      const d = await tryJson<{ list?: unknown[] }>(TV_STRATEGIES_PATH);
      return { available: !!d, count: d?.list?.length ?? 0 };
    }
  }
}

const FILE_BY_ID: Record<SyncSourceId, string> = {
  serenity: POSTS_PATH,
  hotRank: HOT_RANK_PATH,
  industrySectors: SECTORS_META_PATH,
  sectorStocks: SECTOR_STOCKS_PATH,
  hotSectors: HOT_SECTORS_PATH,
  tvStrategies: TV_STRATEGIES_PATH,
};

/** 返回所有数据源的当前落盘状态（数量 + 上次同步时间 + 版本号）。 */
export async function getSyncStatus(): Promise<SyncSourceStatus[]> {
  const manifest = await loadManifest();
  return Promise.all(
    SYNC_SOURCES.map(async (meta) => {
      const { available, count } = await readCount(meta);
      const ver = manifest[meta.id]?.current;
      const lastSyncAt = ver?.syncedAt ?? (await statFile(FILE_BY_ID[meta.id]));
      const base: SyncSourceStatus = { ...meta, available, count, lastSyncAt, version: ver?.version ?? 0 };
      if (meta.id === "serenity") {
        const [remote, local] = await Promise.all([fetchSerenityRemoteState(), loadSerenityRemoteState()]);
        const remoteUpdatedAt = remote?.last_update_time ?? null;
        const localRemoteUpdatedAt = local?.last_update_time ?? null;
        base.remoteUpdatedAt = remoteUpdatedAt;
        base.localRemoteUpdatedAt = localRemoteUpdatedAt;
        base.upToDate = !!remoteUpdatedAt && remoteUpdatedAt === localRemoteUpdatedAt;
      }
      return base;
    })
  );
}
