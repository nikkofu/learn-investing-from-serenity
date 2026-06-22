import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";
import { emClist, getQuotesFailover } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim() || "";

    if (!code || !/^BK\d+$/.test(code)) {
      return NextResponse.json({ error: "请提供有效的板块代码，如 BK1465" }, { status: 400 });
    }

    const cacheKey = `market:sector-stocks:${code}`;
    const ttl = getAdaptiveTTL("sector-stocks");

    // 1. 尝试从本地加载板块-成分股映射元数据
    let localStocks: Array<{ code: string; name: string }> = [];
    try {
      const mapPath = path.join(process.cwd(), "data", "sector_stocks_map.json");
      const raw = await fs.readFile(mapPath, "utf8");
      const fullMap = JSON.parse(raw);
      localStocks = fullMap[code] ?? [];
    } catch {
      // 忽略本地读取错误，触发降级拉取
    }

    const list = await globalCache.getOrCreate(
      cacheKey,
      async () => {
        // 如果本地有成分股映射，用统一批量行情接口补全实时字段
        // （腾讯批量 → 东财 push2 兜底，不封 IP），替代直连 push2 ulist。
        if (localStocks.length > 0) {
          const quoteMap = await getQuotesFailover(localStocks.map((s) => s.code));

          return localStocks.map((s) => {
            const q = quoteMap[s.code];
            const head = s.code[0];
            let market: "SH" | "SZ" | "BJ" = "SZ";
            if (head === "6" || head === "9" || head === "5") {
              market = "SH";
            } else if (head === "8" || head === "4") {
              market = "BJ";
            }

            return {
              code: s.code,
              name: s.name || q?.name || "未命名个股",
              price: q?.price ?? 0,
              changePct: q?.changePct ?? 0,
              turnoverPct: q?.turnoverPct ?? 0,
              market: q?.market ?? market,
            };
          });
        }

        // 2. 兜底方案：本地无配置映射关系，回退到老逻辑，全量动态拉取 clist 并解析
        //    统一 clist 接口（push2delay 兜底 + 限流），替代直连 push2。
        const rawList = await emClist({
          pn: 1, pz: 50, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
          fs: `b:${code}`,
          fields: "f2,f3,f12,f14,f24",
        });

        return rawList.map((item: any) => {
          const changePct = item.f3 != null && item.f3 !== "-" ? Number(item.f3) : 0;
          const price = item.f2 != null && item.f2 !== "-" ? Number(item.f2) : 0;
          const turnoverPct = item.f24 != null && item.f24 !== "-" ? Number(item.f24) : 0;

          const stockCode = item.f12 || "";
          const head = stockCode[0];
          let market: "SH" | "SZ" | "BJ" = "SZ";
          if (head === "6" || head === "9" || head === "5") {
            market = "SH";
          } else if (head === "8" || head === "4") {
            market = "BJ";
          }

          return {
            code: stockCode,
            name: item.f14 || "",
            price,
            changePct,
            turnoverPct,
            market,
          };
        });
      },
      ttl
    );

    return NextResponse.json({ list });
  } catch (error) {
    console.error(`获取成分股列表失败 (${req.url}):`, error);
    return NextResponse.json(
      { error: `获取成分股列表失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
