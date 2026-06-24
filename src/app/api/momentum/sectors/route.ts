import { NextResponse } from "next/server";
import { getKlinesBatch } from "@/lib/sources";
import {
  rankSectors,
  DEFAULT_MOMENTUM_WEIGHTS,
  type SectorConstituents,
  type MomentumWeights,
} from "@/lib/momentum";
import { loadSectorsWithStocks } from "@/lib/sectorData";
import { NFA } from "@/lib/disclaimers";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface SectorsBody {
  /** 仅评估这些 BK 板块（缺省评估全部本地板块）。 */
  sectors?: string[];
  /** 单板块最多取多少只成分股参与（缺省 15）。 */
  maxStocksPerSector?: number;
  /** 单只取 K 根数，默认 280。 */
  limit?: number;
  /** 因子权重（缺省用默认权重）。 */
  weights?: Partial<MomentumWeights>;
  /** 只返回动量最强的前 N 个板块，默认全部。 */
  topN?: number;
}

/**
 * 行业轮动信号：把所有板块成分股放入同一截面打分，再按板块聚合（均值合成分 +
 * 宽度 + 近 3 月收益均值），返回从强到弱排序。仅供研究，不构成投资建议。
 */
async function compute(body: SectorsBody) {
  const maxStocksPerSector = Math.max(1, Math.min(80, body.maxStocksPerSector ?? 15));
  const limit = Math.max(70, Math.min(400, body.limit ?? 280));
  const weights: MomentumWeights = { ...DEFAULT_MOMENTUM_WEIGHTS, ...(body.weights ?? {}) };

  const sectors = await loadSectorsWithStocks({ codes: body.sectors, maxStocksPerSector });
  if (sectors.length === 0) {
    return NextResponse.json({ error: "无可用板块成分股数据" }, { status: 502 });
  }

  // 全板块成分股去重后批量取日 K。
  const allCodes = Array.from(new Set(sectors.flatMap((s) => s.stocks.map((x) => x.code))));
  const klineMap = await getKlinesBatch(allCodes, limit, "baidu-first");
  const historyByCode = new Map<string, Candle[]>();
  for (const code of allCodes) {
    const item = klineMap.get(code);
    if (!item) continue;
    const clean = item.candles
      .filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (clean.length >= 30) historyByCode.set(code, clean);
  }

  const constituents: SectorConstituents[] = sectors.map((sec) => ({
    code: sec.code,
    name: sec.name,
    stocks: sec.stocks
      .map((s) => ({ code: s.code, name: s.name, history: historyByCode.get(s.code) }))
      .filter((s): s is { code: string; name: string; history: Candle[] } => s.history !== undefined),
  }));

  let ranked = rankSectors(constituents, weights);
  if (body.topN && body.topN > 0) ranked = ranked.slice(0, body.topN);

  return NextResponse.json({
    weights,
    sectorCount: ranked.length,
    sectors: ranked,
    note: "行业轮动信号：板块合成动量 = 成分股截面动量分均值；宽度=近 3 月正收益占比。" + NFA,
  });
}

export async function POST(req: Request) {
  let body: SectorsBody = {};
  try {
    body = (await req.json()) as SectorsBody;
  } catch {
    /* 允许空 body */
  }
  try {
    return await compute(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `行业轮动打分失败: ${msg}` }, { status: 502 });
  }
}

export async function GET() {
  try {
    return await compute({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `行业轮动打分失败: ${msg}` }, { status: 502 });
  }
}
