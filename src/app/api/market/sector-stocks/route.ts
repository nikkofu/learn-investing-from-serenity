import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithRetry(url: string, options: RequestInit, retries = 2, delay = 800): Promise<Response> {
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
    const code = searchParams.get("code")?.trim() || "";

    if (!code || !/^BK\d+$/.test(code)) {
      return NextResponse.json({ error: "请提供有效的板块代码，如 BK1465" }, { status: 400 });
    }

    const cacheKey = `market:sector-stocks:${code}`;
    const ttl = getAdaptiveTTL("quote");

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
        // 如果本地有成分股映射，采用 ulist 批量极速行情接口补全实时字段
        if (localStocks.length > 0) {
          const secids = localStocks
            .map((s) => {
              const head = s.code[0];
              if (head === "6" || head === "9" || head === "5") {
                return `1.${s.code}`;
              }
              return `0.${s.code}`;
            })
            .join(",");

          try {
            // f2: 最新价, f3: 涨跌幅, f12: 代码, f14: 股票名称, f24: 换手率
            const quoteUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=f057cbcbce2a86e2866ab8877db1d059&fltt=2&invt=2&fields=f2,f3,f12,f14,f24&secids=${secids}`;
            const res = await fetchWithRetry(quoteUrl, {
              headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
              cache: "no-store",
            });
            const json = await res.json();
            const diffList = json.data?.diff ?? [];

            const quoteMap = new Map<string, any>();
            diffList.forEach((q: any) => {
              if (q && q.f12) quoteMap.set(q.f12, q);
            });

            return localStocks.map((s) => {
              const q = quoteMap.get(s.code);
              const changePct = q?.f3 != null && q.f3 !== "-" ? Number(q.f3) : 0;
              const price = q?.f2 != null && q.f2 !== "-" ? Number(q.f2) : 0;
              const turnoverPct = q?.f24 != null && q.f24 !== "-" ? Number(q.f24) : 0;

              const head = s.code[0];
              let market: "SH" | "SZ" | "BJ" = "SZ";
              if (head === "6" || head === "9" || head === "5") {
                market = "SH";
              } else if (head === "8" || head === "4") {
                market = "BJ";
              }

              return {
                code: s.code,
                name: s.name || q?.f14 || "未命名个股",
                price,
                changePct,
                turnoverPct,
                market,
              };
            });
          } catch (err) {
            console.error(`批量获取成分股行情失败，将返回静态配置:`, err);
            // 批量拉取网络报错时，降级使用静态元配置数据（行情指标置空）
            return localStocks.map((s) => {
              const head = s.code[0];
              const market = (head === "6" || head === "9" || head === "5") ? "SH" : (head === "8" || head === "4") ? "BJ" : "SZ";
              return {
                code: s.code,
                name: s.name,
                price: 0,
                changePct: 0,
                turnoverPct: 0,
                market,
              };
            });
          }
        }

        // 2. 兜底方案：本地无配置映射关系，回退到老逻辑，全量动态拉取 clist 并解析
        const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${code}&fields=f2,f3,f12,f14,f24`;
        const res = await fetchWithRetry(url, {
          headers: {
            "User-Agent": UA,
            "Referer": "https://quote.eastmoney.com/",
          },
          cache: "no-store",
        });

        const json = await res.json();
        const rawList = json.data?.diff ?? [];

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
