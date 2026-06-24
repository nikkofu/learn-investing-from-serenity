import { promises as fs } from "fs";
import path from "path";
import type { MiningResult, MiningFilters } from "./mining";
import { runMiningScan, type MiningRequest, type ScanEvent, type ScanSummary, type Prefilter } from "./miningScan";

/**
 * 每日股票池：对全市场全量做一次「刚发出 B 信号」扫描，落盘成当日清单，供页面/程序秒读。
 *
 * 存储：data/mining_pool/<YYYY-MM-DD>.json（按北京时间），并维护 latest.json 指向最近一次。
 * 写入采用「先写 tmp 再 rename」原子操作；保留最近 RETAIN_DAYS 天，自动清理更早的。
 */

const POOL_DIR = path.join(process.cwd(), "data", "mining_pool");
const LATEST_PATH = path.join(POOL_DIR, "latest.json");
const RETAIN_DAYS = 30;

export interface DailyPoolMeta {
  date: string; // 北京时间 YYYY-MM-DD
  generatedAt: string; // ISO 时间戳
  universe: string;
  includeBJ: boolean;
  concurrency: number;
  retries: number;
  filters: MiningFilters;
  summary: ScanSummary;
}

export interface DailyPoolFile {
  meta: DailyPoolMeta;
  results: MiningResult[];
}

/** 当日扫描默认参数（可被调用方覆盖）。「刚发出 B 信号」是核心口径。 */
export const DAILY_DEFAULTS = {
  includeBJ: false, // 北交所默认剔除
  concurrency: 10,
  retries: 2,
  filters: {
    requireBSignal: true,
    maxBSignalAgeDays: 1, // 仅当日/隔日刚发出的 B 信号
    requireUptrend: false,
    minScore: 0,
  } as MiningFilters,
  // 保证全量覆盖：仅跳过停牌/零成交（反正拉不到 K 线），不设上限，
  // 不改变「每日全市场刚发出 B 信号」的实际命中范围。
  prefilter: { minAmount: 1 } as Prefilter,
};

/** 北京时间当日 YYYY-MM-DD。 */
export function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

function poolPath(date: string): string {
  return path.join(POOL_DIR, `${date}.json`);
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 读取指定日期（默认今天）的股票池；不存在返回 null。 */
export async function loadDailyPool(date?: string): Promise<DailyPoolFile | null> {
  return readJson<DailyPoolFile>(poolPath(date ?? todayStr()));
}

/** 读取最近一次生成的股票池（无论日期）。 */
export async function loadLatestPool(): Promise<DailyPoolFile | null> {
  return readJson<DailyPoolFile>(LATEST_PATH);
}

/** 列出已存盘的日期（倒序）。 */
export async function listPoolDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(POOL_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function pruneOld(): Promise<void> {
  const dates = await listPoolDates();
  const excess = dates.slice(RETAIN_DAYS);
  await Promise.all(excess.map((d) => fs.rm(poolPath(d), { force: true })));
}

async function savePool(file: DailyPoolFile): Promise<void> {
  const content = JSON.stringify(file, null, 2);
  await atomicWrite(poolPath(file.meta.date), content);
  await atomicWrite(LATEST_PATH, content);
  await pruneOld();
}

export interface GenerateOptions {
  includeBJ?: boolean;
  concurrency?: number;
  retries?: number;
  filters?: MiningFilters;
  /** 粗筛阈值（默认仅跳过停牌，保全量覆盖）；传 null 可完全关闭。 */
  prefilter?: Prefilter | null;
}

/**
 * 生成当日股票池：全市场全量「刚发出 B 信号」扫描 → 落盘。
 * `onEvent` 可选，用于流式进度。返回落盘后的文件内容。
 */
export async function generateDailyPool(
  opts: GenerateOptions = {},
  onEvent?: (ev: ScanEvent) => void,
): Promise<DailyPoolFile> {
  const includeBJ = opts.includeBJ ?? DAILY_DEFAULTS.includeBJ;
  const concurrency = opts.concurrency ?? DAILY_DEFAULTS.concurrency;
  const retries = opts.retries ?? DAILY_DEFAULTS.retries;
  const filters = opts.filters ?? DAILY_DEFAULTS.filters;
  const prefilter = opts.prefilter !== undefined ? opts.prefilter : DAILY_DEFAULTS.prefilter;

  // 北交所/科创/ST 等剔除已统一由「股票池纯净化」配置（/settings）治理，
  // includeBJ 仅保留于本地 DailyPoolFile 元信息以兼容历史快照格式。
  const req: MiningRequest = {
    universe: "full",
    concurrency,
    retries,
    filters,
    prefilter,
  };

  const { summary, results } = await runMiningScan(req, onEvent);

  const file: DailyPoolFile = {
    meta: {
      date: todayStr(),
      generatedAt: new Date().toISOString(),
      universe: "full",
      includeBJ,
      concurrency,
      retries,
      filters,
      summary,
    },
    results,
  };
  await savePool(file);
  return file;
}
