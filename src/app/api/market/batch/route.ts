import { NextResponse } from "next/server";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 1000): Promise<Response> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) {
        return res;
      }
      lastError = new Error(`HTTP 错误: ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
  }
  throw lastError || new Error("请求失败且已超过最大重试次数");
}

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
        // 构造东财 secids 列表
        // A股代码分类规则：6、9、5 开头为上海 (1.)，其余（如 00, 30, 83 等）为深圳/北京 (0.)
        const secids = codeArr
          .map((code) => {
            const head = code[0];
            if (head === "6" || head === "9" || head === "5") {
              return `1.${code}`;
            }
            return `0.${code}`;
          })
          .join(",");

        // 批量拉取实时行情数据
        // f2: 最新价, f3: 涨跌幅, f12: 代码, f14: 股票名称, f24: 换手率
        const quoteUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=f057cbcbce2a86e2866ab8877db1d059&fltt=2&invt=2&fields=f2,f3,f12,f14,f24&secids=${secids}`;

        const quoteRes = await fetchWithRetry(quoteUrl, {
          headers: {
            "User-Agent": UA,
            Referer: "https://quote.eastmoney.com/",
          },
          cache: "no-store",
        });

        const quoteJson = await quoteRes.json();
        const diffList = quoteJson.data?.diff ?? [];

        // 将行情数据按代码建档，确保返回结果的顺序一致
        const quoteMap = new Map<string, any>();
        diffList.forEach((q: any) => {
          if (q && q.f12) {
            quoteMap.set(q.f12, q);
          }
        });

        return codeArr.map((code, idx) => {
          const q = quoteMap.get(code);
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
            name: q?.f14 || `证券${code}`,
            price: q?.f2 != null && q.f2 !== "-" ? Number(q.f2) : 0,
            changePct: q?.f3 != null && q.f3 !== "-" ? Number(q.f3) : 0,
            turnoverPct: q?.f24 != null && q.f24 !== "-" ? Number(q.f24) : 0,
            market,
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
