/**
 * 数据缓存策略配置：按「数据类别 × 交易时段」分别设定 TTL。
 *
 * 设计目标：
 *   - 不同数据的实时性诉求不同（实时行情要秒级新鲜、财务季度更新可长存），
 *     因此每个类别给「盘中(active)」「休市(inactive)」两套 TTL。
 *   - 提供默认值；用户可在 /settings 覆盖，持久化到 .data/cache-config.json
 *     （与 LLM 配置同一套 .data 持久化机制）。
 *   - 热路径（getOrCreate 取 TTL）是同步调用，故内存缓存一份配置，
 *     首次同步读盘、保存时刷新，避免每次取数都异步读文件。
 */
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import path from "path";

export type CacheCategory =
  | "quote"
  | "kline"
  | "hotRank"
  | "sectors"
  | "sectorStocks"
  | "financials"
  | "profile"
  | "analyst"
  | "search"
  // ↓ LLM 推理结果的持久化缓存（落盘到 .data/llm-cache，默认按「周」计）。
  // 这些是相对固定、一周内几乎不变的"静态层"分析，单独长缓存以省时省费。
  | "analysisFundamental"
  | "sectorFundamental"
  | "trendMap";

/** 走持久化 LLM 缓存（.data/llm-cache）而非内存缓存的类别。 */
export const LLM_CACHE_CATEGORIES = [
  "analysisFundamental",
  "sectorFundamental",
  "trendMap",
] as const satisfies readonly CacheCategory[];

export interface TTLPair {
  /** 交易时段（盘中）TTL，毫秒 */
  active: number;
  /** 非交易时段（休市）TTL，毫秒 */
  inactive: number;
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

/** 各类别默认 TTL（毫秒）。 */
export const CACHE_DEFAULTS: Record<CacheCategory, TTLPair> = {
  quote: { active: 8 * S, inactive: 1 * H },
  kline: { active: 15 * M, inactive: 6 * H },
  hotRank: { active: 3 * M, inactive: 2 * H },
  sectors: { active: 15 * S, inactive: 1 * H },
  sectorStocks: { active: 30 * S, inactive: 1 * H },
  financials: { active: 6 * H, inactive: 24 * H },
  profile: { active: 10 * M, inactive: 6 * H },
  analyst: { active: 6 * H, inactive: 24 * H },
  search: { active: 5 * M, inactive: 30 * M },
  // 基本面/产业链推理一周内几乎不变，盘中/休市同为 7 天。
  analysisFundamental: { active: 7 * D, inactive: 7 * D },
  sectorFundamental: { active: 7 * D, inactive: 7 * D },
  trendMap: { active: 7 * D, inactive: 7 * D },
};

/** 各类别的中文标签与说明（用于设置界面）。 */
export const CACHE_LABELS: Record<CacheCategory, { label: string; desc: string }> = {
  quote: { label: "实时行情", desc: "个股最新价/涨跌幅，含批量行情" },
  kline: { label: "K 线", desc: "日/周/月 K 线历史" },
  hotRank: { label: "人气榜", desc: "东财股吧人气榜单" },
  sectors: { label: "板块列表", desc: "行业板块涨跌幅排序" },
  sectorStocks: { label: "板块成分股", desc: "某板块下的成分个股行情" },
  financials: { label: "财务指标", desc: "营收/净利/ROE 等，季度更新" },
  profile: { label: "个股基本面", desc: "PE/PB/市值等基本面字段" },
  analyst: { label: "卖方一致预期", desc: "研报看多占比/一致 EPS/目标价，日级更新" },
  search: { label: "搜索", desc: "股票代码/名称搜索结果" },
  analysisFundamental: { label: "个股基本面推理（LLM）", desc: "瓶颈点/护城河/产业链等静态层 AI 推理，一周不变长缓存" },
  sectorFundamental: { label: "板块基本面推理（LLM）", desc: "行业瓶颈/产业链结构等静态层 AI 推理，长缓存" },
  trendMap: { label: "趋势产业链图谱（LLM）", desc: "趋势→供应链→BOM 卡位图谱，几乎全静态，长缓存" },
};

export const CACHE_CATEGORIES = Object.keys(CACHE_DEFAULTS) as CacheCategory[];

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "cache-config.json");

type Overrides = Partial<Record<CacheCategory, Partial<TTLPair>>>;

/** 内存中缓存的用户覆盖配置；null = 尚未从盘读取。 */
let overrides: Overrides | null = null;

function isValidTTL(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** 同步加载覆盖配置（首次读盘，之后走内存）。 */
function loadOverrides(): Overrides {
  if (overrides !== null) return overrides;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Overrides;
    overrides = sanitize(parsed);
  } catch {
    overrides = {};
  }
  return overrides;
}

/** 只保留合法类别与合法数值。 */
function sanitize(input: Overrides): Overrides {
  const clean: Overrides = {};
  for (const cat of CACHE_CATEGORIES) {
    const v = input[cat];
    if (!v || typeof v !== "object") continue;
    const entry: Partial<TTLPair> = {};
    if (isValidTTL(v.active)) entry.active = Math.round(v.active);
    if (isValidTTL(v.inactive)) entry.inactive = Math.round(v.inactive);
    if (Object.keys(entry).length > 0) clean[cat] = entry;
  }
  return clean;
}

/** 取某类别的「盘中/休市」TTL（毫秒），用户覆盖优先，缺省回落默认值。 */
export function getTTLPair(cat: CacheCategory): TTLPair {
  const o = loadOverrides()[cat] ?? {};
  const d = CACHE_DEFAULTS[cat];
  return {
    active: o.active ?? d.active,
    inactive: o.inactive ?? d.inactive,
  };
}

/** 取某类别在指定时段的 TTL（毫秒）。 */
export function getCacheTTL(cat: CacheCategory, active: boolean): number {
  const p = getTTLPair(cat);
  return active ? p.active : p.inactive;
}

/** 供设置界面展示：每个类别的标签/说明/默认值/当前值（毫秒）。 */
export function getCacheSettingsView() {
  return CACHE_CATEGORIES.map((cat) => ({
    category: cat,
    label: CACHE_LABELS[cat].label,
    desc: CACHE_LABELS[cat].desc,
    default: CACHE_DEFAULTS[cat],
    current: getTTLPair(cat),
  }));
}

/** 保存用户覆盖（仅持久化与默认值不同的项），并刷新内存。 */
export async function saveCacheSettings(input: Overrides): Promise<void> {
  const clean = sanitize(input);
  // 与默认值相同的项不落盘，保持配置文件精简、便于「跟随默认值」演进。
  const diff: Overrides = {};
  for (const cat of CACHE_CATEGORIES) {
    const v = clean[cat];
    if (!v) continue;
    const d = CACHE_DEFAULTS[cat];
    const entry: Partial<TTLPair> = {};
    if (v.active !== undefined && v.active !== d.active) entry.active = v.active;
    if (v.inactive !== undefined && v.inactive !== d.inactive) entry.inactive = v.inactive;
    if (Object.keys(entry).length > 0) diff[cat] = entry;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(diff, null, 2), "utf8");
  overrides = diff;
}

/** 恢复全部默认值（删除覆盖文件）。 */
export async function resetCacheSettings(): Promise<void> {
  try {
    await fs.unlink(CONFIG_PATH);
  } catch {
    // 文件不存在即已是默认
  }
  overrides = {};
}
