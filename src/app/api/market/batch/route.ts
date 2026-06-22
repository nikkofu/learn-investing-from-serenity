import { NextResponse } from "next/server";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";
import { getQuotesFailover } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const codesParam = searchParams.get("codes")?.trim() || "";

    if (!codesParam) {
      return NextResponse.json({ list: [] });
    }

    // 解析并去重符合格式的 6 位 A 股代码
    const codeArr = Array.from(
      new Set(
        codesParam
          .split(",")
          .map((c) => c.trim())
          .filter((c) => /^\d{6}$/.test(c))
      )
    );

    if (codeArr.length === 0) {
      return NextResponse.json({ list: [] });
    }

    const cacheKey = `market:batch:${codeArr.join(",")}`;
    const ttl = getAdaptiveTTL("quote"); // 与个股行情缓存时效一致

    const list = await globalCache.getOrCreate(
      cacheKey,
      async () => {
        // 统一批量行情接口（腾讯批量 → 东财 push2 逐只兜底，不封 IP），
        // 替代原先直连被封的 push2 ulist。
        const quoteMap = await getQuotesFailover(codeArr);

        return codeArr.map((code, idx) => {
          const q = quoteMap[code];
          const head = code[0];

          let market: "SH" | "SZ" | "BJ" = "SZ";
          if (head === "6" || head === "9" || head === "5") {
            market = "SH";
          } else if (head === "8" || head === "4") {
            market = "BJ";
          }

          return {
            rank: idx + 1, // 自定义列表按顺序排名
            code,
            name: q?.name || `证券${code}`,
            price: q?.price ?? 0,
            changePct: q?.changePct ?? 0,
            turnoverPct: q?.turnoverPct ?? 0,
            market: q?.market ?? market,
          };
        });
      },
      ttl
    );

    return NextResponse.json({ list });
  } catch (error) {
    console.error("批量获取个股实时行情错误:", error);
    return NextResponse.json(
      { error: `批量获取行情失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
