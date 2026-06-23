/**
 * 持久化 LLM 推理缓存（落盘到 .data/llm-cache/<namespace>/<hash>.json）。
 *
 * 与 src/lib/cache.ts 的内存缓存不同：本模块把"相对固定、需要 LLM 推理"的
 * 静态分析结果长期落盘（默认 7 天），进程重启后依然命中，从而：
 *   - 一周内几乎不变的基本面/产业链推理只算一次，列表/详情秒级展示；
 *   - 把昂贵的多趟 LLM 调用（主推理 + 自洽投票 + Critic + Judge）省到只在
 *     "缓存未命中（即需要重算静态层）"时才跑。
 *
 * 仍带请求合并（request collapsing）：高并发同 key 只触发一次 loader。
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), ".data");
const CACHE_ROOT = path.join(DATA_DIR, "llm-cache");

interface DiskEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiry: number;
}

interface MemEntry<T> {
  value: T;
  createdAt: number;
  expiry: number;
}

// 内存热层：命中后避免反复读盘；与磁盘内容保持一致。
const memCache = new Map<string, MemEntry<unknown>>();
// 请求合并：同 key 进行中的 loader 共享同一个 Promise。
const pending = new Map<string, Promise<unknown>>();

/** 把任意 key 折算成稳定、文件系统安全的短哈希。 */
function hashKey(key: string): string {
  return crypto.createHash("sha1").update(key).digest("hex");
}

function fileFor(namespace: string, key: string): string {
  const safeNs = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(CACHE_ROOT, safeNs, `${hashKey(key)}.json`);
}

function memKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

export interface CacheHit<T> {
  value: T;
  /** 该条目写入时间戳（ms），用于在 UI 上展示"缓存生成于 N 天前"。 */
  createdAt: number;
  /** 距离过期还有多少毫秒。 */
  remainingMs: number;
}

/** 读取一条持久缓存；已过期或不存在返回 null。 */
export async function getPersistent<T>(namespace: string, key: string): Promise<CacheHit<T> | null> {
  const now = Date.now();
  const mk = memKey(namespace, key);

  const mem = memCache.get(mk) as MemEntry<T> | undefined;
  if (mem) {
    if (now <= mem.expiry) return { value: mem.value, createdAt: mem.createdAt, remainingMs: mem.expiry - now };
    memCache.delete(mk);
  }

  try {
    const raw = await fs.readFile(fileFor(namespace, key), "utf8");
    const entry = JSON.parse(raw) as DiskEntry<T>;
    if (typeof entry.expiry !== "number" || now > entry.expiry) return null;
    memCache.set(mk, { value: entry.value, createdAt: entry.createdAt, expiry: entry.expiry });
    return { value: entry.value, createdAt: entry.createdAt, remainingMs: entry.expiry - now };
  } catch {
    return null;
  }
}

/** 写入一条持久缓存（同时刷新内存热层）。 */
export async function setPersistent<T>(namespace: string, key: string, value: T, ttlMs: number): Promise<void> {
  const now = Date.now();
  const expiry = now + Math.max(0, ttlMs);
  const file = fileFor(namespace, key);
  const entry: DiskEntry<T> = { key, value, createdAt: now, expiry };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(entry), "utf8");
  memCache.set(memKey(namespace, key), { value, createdAt: now, expiry });
}

/**
 * 命中即返回；未命中则跑 loader 并落盘。带请求合并：高并发同 key 只会触发
 * 一次 loader，其余调用共享同一 Promise。`onHit` 用于在命中时（不跑 loader）
 * 做副作用（如把缓存的叙事回放给前端）。
 */
export async function getOrCreatePersistent<T>(
  namespace: string,
  key: string,
  loader: () => Promise<T>,
  ttlMs: number,
  onHit?: (hit: CacheHit<T>) => void,
): Promise<{ value: T; cached: boolean; createdAt: number }> {
  const hit = await getPersistent<T>(namespace, key);
  if (hit) {
    onHit?.(hit);
    return { value: hit.value, cached: true, createdAt: hit.createdAt };
  }

  const mk = memKey(namespace, key);
  const inflight = pending.get(mk) as Promise<T> | undefined;
  if (inflight) {
    const value = await inflight;
    return { value, cached: true, createdAt: Date.now() };
  }

  const p = (async () => {
    try {
      const value = await loader();
      await setPersistent(namespace, key, value, ttlMs);
      return value;
    } finally {
      pending.delete(mk);
    }
  })();
  pending.set(mk, p);
  const value = await p;
  return { value, cached: false, createdAt: Date.now() };
}

/** 删除某个 namespace 下的全部持久缓存（强制下次重算）。返回删除的文件数。 */
export async function clearNamespace(namespace: string): Promise<number> {
  for (const k of [...memCache.keys()]) {
    if (k.startsWith(`${namespace}::`)) memCache.delete(k);
  }
  const dir = path.join(CACHE_ROOT, namespace.replace(/[^a-zA-Z0-9_-]/g, "_"));
  let count = 0;
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          await fs.unlink(path.join(dir, f));
          count++;
        }),
    );
  } catch {
    // 目录不存在 = 没有可清理的缓存
  }
  return count;
}

/** 统计某 namespace 下的缓存条目（含已过期但尚未清理的，用于设置页展示）。 */
export async function namespaceStats(namespace: string): Promise<{ total: number; valid: number }> {
  const dir = path.join(CACHE_ROOT, namespace.replace(/[^a-zA-Z0-9_-]/g, "_"));
  const now = Date.now();
  let total = 0;
  let valid = 0;
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          total++;
          try {
            const raw = await fs.readFile(path.join(dir, f), "utf8");
            const entry = JSON.parse(raw) as DiskEntry<unknown>;
            if (typeof entry.expiry === "number" && now <= entry.expiry) valid++;
          } catch {
            // 损坏文件忽略
          }
        }),
    );
  } catch {
    // 没有目录
  }
  return { total, valid };
}

/** 为缓存 key 生成内容指纹（稳定、与字段顺序无关）。 */
export function fingerprint(input: unknown): string {
  return hashKey(stableStringify(input)).slice(0, 16);
}

/** 稳定序列化：对象按 key 排序，保证相同内容产生相同字符串。 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
