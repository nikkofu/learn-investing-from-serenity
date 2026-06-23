/**
 * 行情历史「起始日期」配置：
 *
 *   - 默认从 2000-01-01 开始拉取全量日线（覆盖 A 股绝大多数个股的完整上市以来历史）；
 *   - 若某数据源有更晚的硬性起点（拿不到 2000 的早期数据），则以该源能给的最早为准，
 *     起始日期只作为"最早希望从哪天拉起"的目标；
 *   - 可在 /settings 覆盖并持久化到 .data/market-config.json（与 LLM / 缓存配置同套机制）；
 *   - klineStore 在热路径同步读取，首次落盘后内存复用，避免每次取数都读文件。
 */
import { promises as fs, readFileSync } from "fs";
import path from "path";

/** 行情历史默认起始日期（无更晚的数据源硬限制时一律从此日拉起）。 */
export const DEFAULT_HISTORY_START = "2000-01-01";

/**
 * 全量历史最多保留 / 返回的日线条数。
 * 2000-01-01 至今约 26 年 × ~243 交易日 ≈ 6300 根，取 8000 作上限留足余量，
 * 即"按起始日期拉到今天、几乎不截断"。
 */
export const HISTORY_MAX_BARS = 8000;

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "market-config.json");

export interface MarketConfig {
  /** 行情历史起始日期，格式 YYYY-MM-DD。 */
  historyStart: string;
}

/** 内存中的配置；null = 尚未从磁盘读过。 */
let cached: MarketConfig | null = null;

function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** 同步加载配置（首次落盘之后走内存）。 */
function loadConfigSync(): MarketConfig {
  if (cached !== null) return cached;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MarketConfig>;
    cached = { historyStart: isValidDate(parsed.historyStart) ? parsed.historyStart : DEFAULT_HISTORY_START };
  } catch {
    cached = { historyStart: DEFAULT_HISTORY_START };
  }
  return cached;
}

/** 取配置的历史起始日期（YYYY-MM-DD）。 */
export function getHistoryStart(): string {
  return loadConfigSync().historyStart;
}

/** 更新历史起始日期并落盘（设置页用）；非法日期抛错，空串还原默认值。 */
export async function setHistoryStart(date: string): Promise<MarketConfig> {
  const next: MarketConfig = { historyStart: date ? date : DEFAULT_HISTORY_START };
  if (!isValidDate(next.historyStart)) throw new Error("非法日期，需 YYYY-MM-DD 格式");
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  cached = next;
  return next;
}

/** 设置页展示用视图（当前值 + 默认值）。 */
export function getMarketSettingsView() {
  return { historyStart: getHistoryStart(), defaultHistoryStart: DEFAULT_HISTORY_START };
}
