import { promises as fs } from "fs";
import path from "path";

/**
 * v0.32 自选 / 收藏 / 自定义股票池 持久化层。
 *
 * 复用项目既有「.data/ JSON 落盘」机制（同 config.ts / calibration.ts），零新依赖：
 *  - 收藏个股（favorites）：跨页面统一的「★ 收藏」清单。
 *  - 自定义股票池（pools）：用户自建的 6 位代码列表，scanner / arb / momentum 通用，
 *    亦即「配对池」——套利雷达按池内成分两两组合。
 *  - 保存的筛选（screens）：命名的参数集（arb 阈值 / momentum 参数等），可一键回填重跑。
 *
 * 所有写操作走「读出整份 → 改 → 整份写回」，文件小、并发低，简单可靠。
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "watchlist.json");

/** 收藏的个股。 */
export interface FavoriteStock {
  /** 6 位 A 股代码。 */
  code: string;
  /** 名称（收藏时的快照，缺失则回退代码）。 */
  name: string;
  /** 用户备注（可选）。 */
  note?: string;
  /** 收藏时间（ISO）。 */
  addedAt: string;
}

/** 自定义股票池（即「配对池」，套利雷达按成分两两组合）。 */
export interface StockPool {
  id: string;
  name: string;
  /** 去重后的 6 位代码列表。 */
  codes: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** 保存的筛选适用范围。 */
export type ScreenScope = "scanner" | "momentum" | "arb";

/** 保存的筛选：命名的参数集，可深链回填到对应页面重跑。 */
export interface SavedScreen {
  id: string;
  name: string;
  scope: ScreenScope;
  /** 参数集（仅原始标量，便于落盘与拼 query）。 */
  params: Record<string, string | number | boolean>;
  createdAt: string;
}

interface WatchlistStore {
  favorites: FavoriteStock[];
  pools: StockPool[];
  screens: SavedScreen[];
}

function emptyStore(): WatchlistStore {
  return { favorites: [], pools: [], screens: [] };
}

/** 读出整份存档（缺字段补默认，损坏则回退空档）。 */
export async function loadStore(): Promise<WatchlistStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WatchlistStore>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      pools: Array.isArray(parsed.pools) ? parsed.pools : [],
      screens: Array.isArray(parsed.screens) ? parsed.screens : [],
    };
  } catch {
    return emptyStore();
  }
}

async function saveStore(store: WatchlistStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

const CODE_RE = /^\d{6}$/;

/** 把任意输入规整为去重、保序的合法 6 位代码列表。 */
export function normalizeCodes(input: string[] | string | undefined): string[] {
  const arr = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,，、]+/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const c = String(raw).trim();
    if (CODE_RE.test(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

// ── 收藏个股 ────────────────────────────────────────────────────────────────

export async function listFavorites(): Promise<FavoriteStock[]> {
  return (await loadStore()).favorites;
}

/** 收藏（按 code upsert：已存在则更新名称/备注，保留原收藏时间）。 */
export async function addFavorite(input: { code: string; name?: string; note?: string }): Promise<FavoriteStock> {
  const code = input.code.trim();
  if (!CODE_RE.test(code)) throw new Error("请提供 6 位股票代码");
  const store = await loadStore();
  const existing = store.favorites.find((f) => f.code === code);
  const fav: FavoriteStock = {
    code,
    name: input.name?.trim() || existing?.name || code,
    note: input.note?.trim() || existing?.note,
    addedAt: existing?.addedAt ?? nowIso(),
  };
  store.favorites = existing
    ? store.favorites.map((f) => (f.code === code ? fav : f))
    : [fav, ...store.favorites];
  await saveStore(store);
  return fav;
}

export async function removeFavorite(code: string): Promise<void> {
  const store = await loadStore();
  store.favorites = store.favorites.filter((f) => f.code !== code);
  await saveStore(store);
}

// ── 自定义股票池 ──────────────────────────────────────────────────────────────

export async function listPools(): Promise<StockPool[]> {
  return (await loadStore()).pools;
}

export async function createPool(input: { name?: string; codes: string[] | string; note?: string }): Promise<StockPool> {
  const codes = normalizeCodes(input.codes);
  if (codes.length === 0) throw new Error("股票池至少需要 1 个合法的 6 位代码");
  const store = await loadStore();
  const ts = nowIso();
  const pool: StockPool = {
    id: genId("pool"),
    name: input.name?.trim() || `股票池 ${store.pools.length + 1}`,
    codes,
    note: input.note?.trim() || undefined,
    createdAt: ts,
    updatedAt: ts,
  };
  store.pools = [pool, ...store.pools];
  await saveStore(store);
  return pool;
}

export async function updatePool(
  id: string,
  patch: { name?: string; codes?: string[] | string; note?: string },
): Promise<StockPool | null> {
  const store = await loadStore();
  const pool = store.pools.find((p) => p.id === id);
  if (!pool) return null;
  if (patch.name !== undefined) pool.name = patch.name.trim() || pool.name;
  if (patch.codes !== undefined) {
    const codes = normalizeCodes(patch.codes);
    if (codes.length === 0) throw new Error("股票池至少需要 1 个合法的 6 位代码");
    pool.codes = codes;
  }
  if (patch.note !== undefined) pool.note = patch.note.trim() || undefined;
  pool.updatedAt = nowIso();
  await saveStore(store);
  return pool;
}

export async function deletePool(id: string): Promise<void> {
  const store = await loadStore();
  store.pools = store.pools.filter((p) => p.id !== id);
  await saveStore(store);
}

// ── 保存的筛选 ────────────────────────────────────────────────────────────────

const SCREEN_SCOPES: ScreenScope[] = ["scanner", "momentum", "arb"];

export async function listScreens(): Promise<SavedScreen[]> {
  return (await loadStore()).screens;
}

export async function createScreen(input: {
  name?: string;
  scope: string;
  params: Record<string, unknown>;
}): Promise<SavedScreen> {
  if (!SCREEN_SCOPES.includes(input.scope as ScreenScope)) {
    throw new Error(`scope 仅支持 ${SCREEN_SCOPES.join(" / ")}`);
  }
  // 只保留原始标量，避免落盘嵌套对象 / 不可序列化值。
  const params: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") params[k] = v;
  }
  const store = await loadStore();
  const screen: SavedScreen = {
    id: genId("screen"),
    name: input.name?.trim() || `筛选 ${store.screens.length + 1}`,
    scope: input.scope as ScreenScope,
    params,
    createdAt: nowIso(),
  };
  store.screens = [screen, ...store.screens];
  await saveStore(store);
  return screen;
}

export async function deleteScreen(id: string): Promise<void> {
  const store = await loadStore();
  store.screens = store.screens.filter((s) => s.id !== id);
  await saveStore(store);
}
