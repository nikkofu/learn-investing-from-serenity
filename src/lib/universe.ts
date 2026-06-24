/**
 * 股票池「纯净化」过滤 —— 全站统一口径（套利雷达 / 智能挖掘等共用）。
 *
 * 设计目标：把原先散落在 miningScan.ts 的 isStarCode / isRiskyName / includeBJ
 * 等硬编码规则收敛到一处，并做成 /settings 可配置、落盘持久化（与 LLM / 缓存 /
 * 行情起始日期同套机制：.data/universe-config.json）。
 *
 * 约束背景：聚焦 A 股主板个股，默认剔除科创板、北交所、ST/*ST/退、B 股；
 * 创业板默认保留（仅在需要时由设置页关闭）。所有规则可在设置页单独开关。
 *
 * 纯判定函数不发起网络请求；配置读取走同步内存缓存（首次落盘后复用）。
 */
import { promises as fs, readFileSync } from "fs";
import path from "path";

export interface UniverseConfig {
  /** 剔除科创板（688/689，含科创板 CDR）。 */
  excludeStar: boolean;
  /** 剔除北交所（8/4 开头、920 新代码段）。 */
  excludeBeijing: boolean;
  /** 剔除创业板（300/301）。默认保留。 */
  excludeChiNext: boolean;
  /** 剔除 ST/*ST/退市整理/PT 等风险或非正常交易股（按名称判定）。 */
  excludeST: boolean;
  /** 剔除 B 股（沪 900xxx / 深 200xxx）。 */
  excludeB: boolean;
}

/** 默认口径：剔除科创/北交所/ST/B 股，保留主板 + 中小板 + 创业板。 */
export const DEFAULT_UNIVERSE_CONFIG: UniverseConfig = {
  excludeStar: true,
  excludeBeijing: true,
  excludeChiNext: false,
  excludeST: true,
  excludeB: true,
};

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "universe-config.json");

let cached: UniverseConfig | null = null;

function sanitize(raw: Partial<UniverseConfig> | null | undefined): UniverseConfig {
  const r = raw ?? {};
  return {
    excludeStar: typeof r.excludeStar === "boolean" ? r.excludeStar : DEFAULT_UNIVERSE_CONFIG.excludeStar,
    excludeBeijing: typeof r.excludeBeijing === "boolean" ? r.excludeBeijing : DEFAULT_UNIVERSE_CONFIG.excludeBeijing,
    excludeChiNext: typeof r.excludeChiNext === "boolean" ? r.excludeChiNext : DEFAULT_UNIVERSE_CONFIG.excludeChiNext,
    excludeST: typeof r.excludeST === "boolean" ? r.excludeST : DEFAULT_UNIVERSE_CONFIG.excludeST,
    excludeB: typeof r.excludeB === "boolean" ? r.excludeB : DEFAULT_UNIVERSE_CONFIG.excludeB,
  };
}

/** 同步加载配置（首次落盘之后走内存）。 */
export function getUniverseConfig(): UniverseConfig {
  if (cached !== null) return cached;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<UniverseConfig>;
    cached = sanitize(parsed);
  } catch {
    cached = { ...DEFAULT_UNIVERSE_CONFIG };
  }
  return cached;
}

/** 更新配置并落盘（设置页用）；返回归一化后的完整配置。 */
export async function setUniverseConfig(patch: Partial<UniverseConfig>): Promise<UniverseConfig> {
  const next = sanitize({ ...getUniverseConfig(), ...patch });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  cached = next;
  return next;
}

/** 科创板（含科创板 CDR）代码。 */
export function isStarCode(code: string): boolean {
  return code.startsWith("688") || code.startsWith("689");
}

/** 北交所代码（8/4 开头老代码段 + 920 新代码段）。 */
export function isBeijingCode(code: string): boolean {
  return code.startsWith("8") || code.startsWith("4") || code.startsWith("920");
}

/** 创业板代码（300/301）。 */
export function isChiNextCode(code: string): boolean {
  return code.startsWith("300") || code.startsWith("301");
}

/** B 股代码（沪 900xxx / 深 200xxx）。 */
export function isBShareCode(code: string): boolean {
  return code.startsWith("900") || code.startsWith("200");
}

/** ST/*ST/退市整理/PT 等风险或非正常交易股（按名称判定，名称缺失视为非风险）。 */
export function isRiskyName(name: string | undefined): boolean {
  if (!name) return false;
  const upper = name.toUpperCase();
  return upper.includes("ST") || name.includes("退") || name.includes("*") || upper.startsWith("PT");
}

/**
 * 按给定配置判断一只票是否应被「剔除」。
 * @param code 6 位代码
 * @param name 证券名称（用于 ST 判定，可缺省）
 * @param cfg  口径配置（缺省读取持久化配置）
 */
export function isExcluded(code: string, name?: string, cfg: UniverseConfig = getUniverseConfig()): boolean {
  if (!/^\d{6}$/.test(code)) return true; // 非 6 位 A 股代码一律排除
  if (cfg.excludeStar && isStarCode(code)) return true;
  if (cfg.excludeBeijing && isBeijingCode(code)) return true;
  if (cfg.excludeChiNext && isChiNextCode(code)) return true;
  if (cfg.excludeB && isBShareCode(code)) return true;
  if (cfg.excludeST && isRiskyName(name)) return true;
  return false;
}

/** 取反：是否为「可纳入」的标的。 */
export function isAllowed(code: string, name?: string, cfg?: UniverseConfig): boolean {
  return !isExcluded(code, name, cfg);
}

/**
 * 过滤一批带 code/name 的对象，剔除不符合口径的项。
 * 泛型保持调用方原类型，便于直接替换现有 .filter 链。
 */
export function filterUniverse<T extends { code: string; name?: string }>(
  items: T[],
  cfg: UniverseConfig = getUniverseConfig(),
): T[] {
  return items.filter((it) => !isExcluded(it.code, it.name, cfg));
}

/** 设置页展示用视图（当前值 + 默认值）。 */
export function getUniverseSettingsView() {
  return { config: getUniverseConfig(), defaults: DEFAULT_UNIVERSE_CONFIG };
}
