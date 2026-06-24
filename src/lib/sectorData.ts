import { promises as fs } from "fs";
import path from "path";
import { filterUniverse, getUniverseConfig } from "./universe";

/**
 * 本地板块元数据 / 成分股映射的读取与「主板纯净化」过滤（服务端）。
 * 数据来自 data/sectors_metadata.json 与 data/sector_stocks_map.json，
 * 由数据同步流程维护；这里只做读取 + universe 口径过滤，供行业轮动复用。
 */

export interface SectorMeta {
  code: string;
  name: string;
}

export interface SectorWithStocks extends SectorMeta {
  stocks: Array<{ code: string; name: string }>;
}

const DATA_DIR = path.join(process.cwd(), "data");

/** 读取板块元数据（BK 代码 + 名称）。 */
export async function loadSectorMeta(): Promise<SectorMeta[]> {
  const raw = await fs.readFile(path.join(DATA_DIR, "sectors_metadata.json"), "utf8");
  return JSON.parse(raw) as SectorMeta[];
}

/** 读取「板块 → 成分股」映射。 */
async function loadSectorStocksMap(): Promise<Record<string, Array<{ code: string; name: string }>>> {
  const raw = await fs.readFile(path.join(DATA_DIR, "sector_stocks_map.json"), "utf8");
  return JSON.parse(raw) as Record<string, Array<{ code: string; name: string }>>;
}

/**
 * 取板块 + 成分股（按主板口径过滤），可选只取部分板块、并限制单板块成分股数。
 * @param opts.codes 仅取这些 BK 板块（缺省取全部有成分股的板块）。
 * @param opts.maxStocksPerSector 单板块最多保留多少只（缺省不限）。
 */
export async function loadSectorsWithStocks(
  opts: { codes?: string[]; maxStocksPerSector?: number } = {},
): Promise<SectorWithStocks[]> {
  const [meta, map] = await Promise.all([loadSectorMeta(), loadSectorStocksMap()]);
  const cfg = getUniverseConfig();
  const wanted = opts.codes && opts.codes.length > 0 ? new Set(opts.codes) : null;
  const out: SectorWithStocks[] = [];
  for (const m of meta) {
    if (wanted && !wanted.has(m.code)) continue;
    const raw = map[m.code] ?? [];
    let stocks = filterUniverse(raw, cfg);
    if (opts.maxStocksPerSector && opts.maxStocksPerSector > 0) {
      stocks = stocks.slice(0, opts.maxStocksPerSector);
    }
    if (stocks.length > 0) out.push({ code: m.code, name: m.name, stocks });
  }
  return out;
}
