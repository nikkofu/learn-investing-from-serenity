/**
 * 股票数据缓存与请求合并（Request Collapsing）工具模块。
 * 使用进程内内存进行轻量级缓存，并针对高并发批量请求设计 Promise 共享机制，防止瞬间击穿外部 API。
 */

import { getCacheTTL, type CacheCategory } from "./cacheSettings";

interface CacheEntry<T> {
  value: T;
  expiry: number; // 过期时间戳 (ms)
}

/**
 * 判断当前北京时间是否处于 A 股交易活跃期。
 * 活跃期定义为：周一至周五，北京时间 09:15 至 15:30 之间。
 */
export function isAShareActiveTime(): boolean {
  try {
    const now = new Date();
    // 使用 Asia/Shanghai 时区格式化当前时间，以兼容多国服务器环境
    const bjStr = now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
    const bjDate = new Date(bjStr);

    const day = bjDate.getDay(); // 0 是周日，6 是周六
    if (day === 0 || day === 6) {
      return false; // 周末休市
    }

    const hours = bjDate.getHours();
    const minutes = bjDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // 09:15 (开盘前竞价) 到 15:30 (收盘清算结束)
    const startActive = 9 * 60 + 15;
    const endActive = 15 * 60 + 30;

    return totalMinutes >= startActive && totalMinutes <= endActive;
  } catch (e) {
    // 兜底策略：如果时区格式化失败，默认视为交易期以保证数据新鲜度
    return true;
  }
}

/** 路由/驱动里使用的数据类别别名 → cacheSettings 内部类别。 */
const TTL_ALIAS: Record<string, CacheCategory> = {
  quote: "quote",
  kline: "kline",
  "hot-rank": "hotRank",
  hotRank: "hotRank",
  sectors: "sectors",
  "sector-stocks": "sectorStocks",
  sectorStocks: "sectorStocks",
  financials: "financials",
  profile: "profile",
  analyst: "analyst",
  search: "search",
};

/**
 * 根据数据类别，获取自适应交易时间的 TTL 缓存时长（毫秒）。
 * TTL 默认值与用户覆盖统一来自 cacheSettings（可在 /settings 配置）。
 */
export function getAdaptiveTTL(
  dataType:
    | "quote"
    | "kline"
    | "hot-rank"
    | "sectors"
    | "sector-stocks"
    | "financials"
    | "profile"
    | "analyst"
    | "search",
): number {
  const cat = TTL_ALIAS[dataType] ?? "quote";
  return getCacheTTL(cat, isAShareActiveTime());
}

export class MemoryCacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private pendingRequests = new Map<string, Promise<any>>();

  /**
   * 直接从内存读取缓存（不发起异步加载）
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // 检查是否已过期
    if (Date.now() > entry.expiry) {
      this.cache.delete(key); // 惰性删除
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * 写入缓存
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttlMs,
    });
  }

  /**
   * 移除缓存
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空全部缓存
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * 当前缓存条目统计（含已过期但尚未惰性删除的条目；valid 为未过期数）。
   */
  stats(): { total: number; valid: number; pending: number } {
    const now = Date.now();
    let valid = 0;
    for (const entry of this.cache.values()) {
      if (now <= entry.expiry) valid++;
    }
    return { total: this.cache.size, valid, pending: this.pendingRequests.size };
  }

  /**
   * 带请求合并与自适应缓存的获取方法。
   * 如果缓存存在且未过期，直接返回；
   * 如果缓存失效但有正在进行的相同加载请求，则合并等待同一个 Promise；
   * 如果都没有，则触发 loader 执行并写入缓存。
   *
   * @param key 缓存键
   * @param loader 真实获取数据的异步函数
   * @param ttlMs 缓存时间（毫秒）
   */
  async getOrCreate<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number
  ): Promise<T> {
    // 1. 检查是否存在有效缓存
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    // 2. 检查是否有并发中的相同请求
    let promise = this.pendingRequests.get(key);
    if (promise) {
      // 存在进行中的请求，直接共享 Promise（合并并发请求）
      return promise;
    }

    // 3. 发起新的异步加载任务
    promise = (async () => {
      try {
        const result = await loader();
        // 成功获取数据后，写入缓存
        this.set(key, result, ttlMs);
        return result;
      } finally {
        // 执行完毕后，无论成功或失败，必须从进行中的请求队列中移除自身
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, promise);
    return promise;
  }
}

// 全局单例缓存管理器
export const globalCache = new MemoryCacheManager();
