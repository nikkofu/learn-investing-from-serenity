import { promises as fs } from "fs";
import path from "path";

/**
 * v0.37 多标的横向对比 / 布局持久化。
 *
 * 复用项目既有「.data/ JSON 落盘」机制（同 watchlist.ts / paperTrades.ts），零新依赖：
 * 把任意一组标的拉到同一张表里横向对比（行情 + 横截面动量因子，按截面百分位着色），
 * 并把「对比了哪些标的 + 显示哪些列 + 列序 + 排序」沉淀成命名「对比视图」，可一键复原 / 分享。
 *
 * 与 momentum 截面打分共用 computeMomentumFactors / scoreCrossSection，口径一致；
 * 列目录（COMPARE_COLUMNS）服务端与前端共享，避免两边漂移。
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "compare-views.json");

const CODE_RE = /^\d{6}$/;

/** 单元格数值单位（决定格式化与默认色判向）。 */
export type CompareUnit = "price" | "pct" | "num" | "score";

/** 一列对比指标的元信息。 */
export interface CompareColumn {
  key: string;
  label: string;
  unit: CompareUnit;
  /** 横截面着色方向：1=越大越好（绿），-1=越小越好（绿），0=中性不着色。 */
  better: 1 | -1 | 0;
}

/**
 * 可对比的指标列目录（服务端按此算值，前端按此渲染/选列）。
 * 行情类（price/changePct/turnoverPct）取自实时行情；其余为横截面动量因子。
 */
export const COMPARE_COLUMNS: CompareColumn[] = [
  { key: "price", label: "现价", unit: "price", better: 0 },
  { key: "changePct", label: "今日涨跌", unit: "pct", better: 1 },
  { key: "turnoverPct", label: "换手率", unit: "pct", better: 0 },
  { key: "r1m", label: "近1月", unit: "pct", better: 1 },
  { key: "r3m", label: "近3月", unit: "pct", better: 1 },
  { key: "r6m", label: "近6月", unit: "pct", better: 1 },
  { key: "skip", label: "12-1动量", unit: "pct", better: 1 },
  { key: "vol", label: "年化波动", unit: "pct", better: -1 },
  { key: "riskAdj", label: "风险调整", unit: "num", better: 1 },
  { key: "trend", label: "趋势(vsMA60)", unit: "pct", better: 1 },
  { key: "composite", label: "合成动量分", unit: "score", better: 1 },
];

const COLUMN_KEYS = new Set(COMPARE_COLUMNS.map((c) => c.key));

/** 默认显示的列（可被视图覆盖）。 */
export const DEFAULT_COLUMN_KEYS = ["price", "changePct", "r1m", "r3m", "r6m", "vol", "composite"];

/** 把任意列键输入规整为合法、去重、保序的列键列表（空则回退默认）。 */
export function normalizeColumns(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const k = String(raw);
    if (COLUMN_KEYS.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_COLUMN_KEYS];
}

/** 把任意输入规整为去重、保序的合法 6 位代码列表。 */
export function normalizeCodes(input: string[] | string | undefined): string[] {
  const arr = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\s,，、]+/)
      : [];
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

// ── 持久化：命名对比视图 ──────────────────────────────────────────────────────

/** 一个对比视图（= 对比哪些标的 + 布局：显示哪些列 / 列序 / 排序）。 */
export interface CompareView {
  id: string;
  name: string;
  /** 对比的 6 位代码（保序）。 */
  codes: string[];
  /** 显示的列键（保序，即列布局）。 */
  columns: string[];
  /** 排序列键（须在 columns 内，否则前端回退）。 */
  sortKey: string;
  sortDir: "asc" | "desc";
  createdAt: string;
  updatedAt: string;
}

interface CompareStore {
  views: CompareView[];
}

function emptyStore(): CompareStore {
  return { views: [] };
}

export async function loadStore(): Promise<CompareStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CompareStore>;
    return { views: Array.isArray(parsed.views) ? parsed.views : [] };
  } catch {
    return emptyStore();
  }
}

async function saveStore(store: CompareStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function genId(): string {
  return `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

export async function listViews(): Promise<CompareView[]> {
  const list = (await loadStore()).views;
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface SaveViewInput {
  name?: string;
  codes: string[] | string;
  columns?: unknown;
  sortKey?: string;
  sortDir?: string;
}

function sanitizeLayout(input: SaveViewInput): Pick<CompareView, "codes" | "columns" | "sortKey" | "sortDir"> {
  const codes = normalizeCodes(input.codes);
  if (codes.length === 0) throw new Error("对比视图至少需要 1 个合法的 6 位代码");
  const columns = normalizeColumns(input.columns);
  const sortKey = typeof input.sortKey === "string" && COLUMN_KEYS.has(input.sortKey) ? input.sortKey : "composite";
  const sortDir: "asc" | "desc" = input.sortDir === "asc" ? "asc" : "desc";
  return { codes, columns, sortKey, sortDir };
}

export async function createView(input: SaveViewInput): Promise<CompareView> {
  const store = await loadStore();
  const ts = nowIso();
  const view: CompareView = {
    id: genId(),
    name: input.name?.trim() || `对比视图 ${store.views.length + 1}`,
    ...sanitizeLayout(input),
    createdAt: ts,
    updatedAt: ts,
  };
  store.views = [view, ...store.views];
  await saveStore(store);
  return view;
}

export async function updateView(id: string, input: SaveViewInput): Promise<CompareView | null> {
  const store = await loadStore();
  const view = store.views.find((v) => v.id === id);
  if (!view) return null;
  const layout = sanitizeLayout(input);
  view.codes = layout.codes;
  view.columns = layout.columns;
  view.sortKey = layout.sortKey;
  view.sortDir = layout.sortDir;
  if (input.name !== undefined) view.name = input.name.trim() || view.name;
  view.updatedAt = nowIso();
  await saveStore(store);
  return view;
}

export async function deleteView(id: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.views.length;
  store.views = store.views.filter((v) => v.id !== id);
  if (store.views.length === before) return false;
  await saveStore(store);
  return true;
}

// ── 横截面百分位（着色用） ────────────────────────────────────────────────────

/**
 * 把一组数映射到 [0,1] 截面百分位（并列取平均名次，null 记 null 不着色）。
 * better=-1 时反向（越小百分位越高），better=0 返回全 null（中性列不着色）。
 */
export function percentile(values: Array<number | null>, better: 1 | -1 | 0): Array<number | null> {
  if (better === 0) return values.map(() => null);
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  const out = new Array<number | null>(values.length).fill(null);
  if (valid.length <= 1) {
    for (const x of valid) out[x.i] = 0.5;
    return out;
  }
  valid.sort((a, b) => a.v - b.v);
  let start = 0;
  for (let i = 1; i <= valid.length; i++) {
    if (i === valid.length || valid[i].v !== valid[start].v) {
      const avgRank = (start + i - 1) / 2;
      const norm = avgRank / (valid.length - 1);
      for (let j = start; j < i; j++) out[valid[j].i] = better === -1 ? 1 - norm : norm;
      start = i;
    }
  }
  return out;
}
