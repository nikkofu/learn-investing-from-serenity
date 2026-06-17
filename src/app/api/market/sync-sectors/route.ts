import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { globalCache } from "@/lib/cache";

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

export async function POST() {
  try {
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });

    // 1. 获取行业板块列表 (前 120 个)
    const listUrl = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=120&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!2&fields=f12,f14";
    const listRes = await fetchWithRetry(listUrl, {
      headers: {
        "User-Agent": UA,
        Referer: "https://quote.eastmoney.com/",
      },
      cache: "no-store",
    });
    
    const listJson = await listRes.json();
    const rawSectors = listJson.data?.diff ?? [];

    if (rawSectors.length === 0) {
      return NextResponse.json({ error: "东方财富行情返回空板块列表" }, { status: 502 });
    }

    const sectorsMetadata: Array<{ code: string; name: string }> = [];
    const sectorStocksMap: Record<string, Array<{ code: string; name: string }>> = {};

    console.log(`[API Sync] 开始同步 ${rawSectors.length} 个板块的成分股映射...`);

    for (let i = 0; i < rawSectors.length; i++) {
      const item = rawSectors[i];
      const code = item.f12;
      const name = item.f14;

      if (!code || !name) continue;

      sectorsMetadata.push({ code, name });

      // 获取当前板块的成分股 (前 80 只)
      const stocksUrl = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${code}&fields=f12,f14`;
      
      try {
        const stocksRes = await fetchWithRetry(stocksUrl, {
          headers: {
            "User-Agent": UA,
            Referer: "https://quote.eastmoney.com/",
          },
          cache: "no-store",
        });
        const stocksJson = await stocksRes.json();
        const rawStocks = stocksJson.data?.diff ?? [];

        const stocksList = rawStocks
          .map((s: any) => ({
            code: s.f12 || "",
            name: s.f14 || "",
          }))
          .filter((s: any) => s.code && s.name);

        sectorStocksMap[code] = stocksList;
      } catch (err) {
        console.error(`[API Sync] 同步板块 ${name}(${code}) 成分股失败:`, err);
        sectorStocksMap[code] = [];
      }

      // 控制频率
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // 2. 写入磁盘 JSON
    const metadataPath = path.join(dataDir, "sectors_metadata.json");
    const mapPath = path.join(dataDir, "sector_stocks_map.json");

    await fs.writeFile(metadataPath, JSON.stringify(sectorsMetadata, null, 2), "utf8");
    await fs.writeFile(mapPath, JSON.stringify(sectorStocksMap, null, 2), "utf8");

    // 3. 清理全量与局部的内存缓存，确保下一次查询时加载最新同步的数据
    globalCache.delete("market:sectors");
    globalCache.delete("market:sectors:all_raw");
    
    // 清理各个板块的成分股缓存
    sectorsMetadata.forEach((s) => {
      globalCache.delete(`market:sector-stocks:${s.code}`);
      globalCache.delete(`market:sector-stocks:top15:${s.code}`);
    });

    return NextResponse.json({
      success: true,
      sectorsCount: sectorsMetadata.length,
      message: "板块与成分股元数据同步成功",
    });
  } catch (error) {
    console.error("同步板块数据接口报错:", error);
    return NextResponse.json(
      { error: `同步失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
