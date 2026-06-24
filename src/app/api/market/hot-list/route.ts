import { NextResponse } from "next/server";
import { getStockRankList } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/market/hot-list?n=50
 * 东财人气榜（emappdata 实时人气排行）前 N 只代码——作为回测/研究的「最近热门」股票池来源。
 * 只返回 6 位代码清单（含人气名次），名称/行情由调用方按需补齐。仅供研究，不构成投资建议。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Math.min(Math.max(Number(url.searchParams.get("n")) || 50, 1), 200);
  try {
    const list = await getStockRankList(n);
    const items = list.slice(0, n).map((it) => ({ code: it.code, rank: it.rank, market: it.market }));
    return NextResponse.json({
      asOf: new Date().toISOString(),
      count: items.length,
      codes: items.map((it) => it.code),
      items,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
