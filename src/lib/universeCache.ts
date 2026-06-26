import { promises as fs } from "fs";
import path from "path";
import type { MiningCandidate } from "./mining";

/**
 * 全市场候选池快照缓存（按时段自适应 TTL）。
 *
 * 「开始挖掘 / 生成今日股票池」的全市场全量候选池需逐页串行限流拉取东财 clist
 * （约 50 页、数分钟）。但板块成分当日基本不变，逐页字段（成交额/换手/量比）仅盘中
 * 变化。故按 Asia/Shanghai 时段给快照设定不同有效期，TTL 内重复扫描直接复用、免去
 * 逐页重拉：
 *   - 盘中（交易日 09:30–11:30 / 13:00–15:00）：5 分钟（实时字段时效高，保证粗筛新鲜）
 *   - 午间休市（交易日 11:30–13:00）：30 分钟
 *   - 盘后 / 盘前 / 夜间凌晨（交易日非交易时段）：6 小时（收盘数据已定，长缓存）
 *   - 周末（周六/周日；法定节假日按非交易日近似，落入此档或盘后档）：12 小时
 *
 * 内存为主、落盘为辅（`data/universe_cache.json`，dev server 重启后仍可复用）。
 * 缓存键为板块段标识（随「股票池纯净化」配置变化，配置变更即自动失效）。
 */

export interface UniverseSnapshot {
  /** 板块段标识（缓存键，随股票池纯净化配置变化）。 */
  segments: string;
  /** 拉取完成时间（epoch ms）。 */
  fetchedAt: number;
  /** 拉取页数。 */
  pages: number;
  candidates: MiningCandidate[];
  /**
   * 是否完整拉完全市场（翻到末页）。提前终止（按成交额倒序集齐 top-N 即停）得到的
   * 是「部分快照」，complete=false。完整快照可服务任意粗筛口径；部分快照仅当粗筛
   * 签名一致时可复用（其前缀恰为该口径所需的 top-N）。缺省（旧快照）按完整处理。
   */
  complete?: boolean;
  /** 粗筛签名（部分快照复用判定用）；完整快照可忽略。 */
  prefilterSig?: string;
}

export type UniversePhase = "盘中" | "午间休市" | "盘后/盘前" | "周末";

const CACHE_PATH = path.join(process.cwd(), "data", "universe_cache.json");
let mem: UniverseSnapshot | null = null;

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Asia/Shanghai 的「是否周末」与「当日分钟数」。 */
function shanghaiClock(now: Date): { weekend: boolean; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  const hh = Number(get("hour")) || 0;
  const mm = Number(get("minute")) || 0;
  return { weekend: wd === "Sat" || wd === "Sun", minutes: hh * 60 + mm };
}

/** 当前时段标签（用于日志展示与 TTL 决策）。 */
export function universePhase(now: Date = new Date()): UniversePhase {
  const { weekend, minutes } = shanghaiClock(now);
  if (weekend) return "周末";
  const am = minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30;
  const pm = minutes >= 13 * 60 && minutes < 15 * 60;
  if (am || pm) return "盘中";
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) return "午间休市";
  return "盘后/盘前";
}

/** 按时段返回快照有效期（毫秒）。 */
export function universeTtlMs(now: Date = new Date()): number {
  switch (universePhase(now)) {
    case "盘中":
      return 5 * MIN;
    case "午间休市":
      return 30 * MIN;
    case "周末":
      return 12 * HOUR;
    default:
      return 6 * HOUR; // 盘后/盘前/夜间凌晨
  }
}

/** 读取仍在有效期内的快照（先内存后磁盘）；过期或键不匹配返回 null。 */
export async function getCachedUniverse(
  segments: string,
  now: Date = new Date(),
): Promise<UniverseSnapshot | null> {
  const ttl = universeTtlMs(now);
  const fresh = (s: UniverseSnapshot | null): s is UniverseSnapshot =>
    !!s && s.segments === segments && now.getTime() - s.fetchedAt < ttl && s.candidates.length > 0;
  if (fresh(mem)) return mem;
  // 内存未命中：尝试磁盘（dev server 重启后仍可复用）。
  try {
    const disk = JSON.parse(await fs.readFile(CACHE_PATH, "utf8")) as UniverseSnapshot;
    if (fresh(disk)) {
      mem = disk;
      return disk;
    }
  } catch {
    /* 无磁盘缓存或已损坏，忽略 */
  }
  return null;
}

/** 写入快照（内存 + 落盘，落盘失败不影响内存缓存）。 */
export async function setCachedUniverse(snapshot: UniverseSnapshot): Promise<void> {
  mem = snapshot;
  try {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const tmp = `${CACHE_PATH}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(snapshot), "utf8");
    await fs.rename(tmp, CACHE_PATH);
  } catch {
    /* 落盘失败不影响内存缓存 */
  }
}
