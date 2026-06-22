import { NextResponse } from "next/server";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";
import { getStockRankList, getQuotesFailover } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cacheKey = "market:hot-rank";
    const ttl = getAdaptiveTTL("hot-rank");

    const list = await globalCache.getOrCreate(
      cacheKey,
      async () => {
        // 1. 东方财富股吧人气榜前 100（统一 emappdata 接口，走限流）
        const rank = await getStockRankList(100);
        if (rank.length === 0) return [];

        // 2. 批量补行情：统一行情接口（腾讯批量 → 东财 push2 兜底，全球可达、不封 IP），
        //    替代被海外封锁的 push2 ulist。停市时返回当日收盘值。整体失败时退化为仅榜单。
        const quoteMap = await getQuotesFailover(rank.map((r) => r.code));

        // 3. 将热榜排名与行情数据组装
        return rank.map((item) => {
          const q = quoteMap[item.code];
          return {
            rank: item.rank,
            code: item.code,
            name: q?.name || item.sc, // 兜底使用原始证券代号
            price: q?.price ?? 0,
            changePct: q?.changePct ?? 0,
            turnoverPct: q?.turnoverPct ?? 0,
            market: item.market,
          };
        });
      },
      ttl
    );

    return NextResponse.json({ list });
  } catch (error) {
    console.error("获取实时热门股错误:", error);
    return NextResponse.json(
      { error: `获取实时热门股失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
