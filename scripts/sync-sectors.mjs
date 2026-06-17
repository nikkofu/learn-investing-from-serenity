import { promises as fs } from "fs";
import path from "path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithRetry(url, options = {}, retries = 3, delay = 800) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
  }
  throw lastError || new Error("请求失败");
}

async function run() {
  console.log("=== 开始同步东方财富行业板块与成分股元数据 ===");
  const tStart = Date.now();

  try {
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });

    // 1. 获取行业板块列表 (前 120 个)
    const listUrl = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=120&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!2&fields=f12,f14";
    console.log("正在获取热门行业板块列表...");
    const listRes = await fetchWithRetry(listUrl, {
      headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" }
    });
    const listJson = await listRes.json();
    const rawSectors = listJson.data?.diff ?? [];

    if (rawSectors.length === 0) {
      throw new Error("未能获取到任何行业板块数据");
    }

    const sectorsMetadata = [];
    const sectorStocksMap = {};

    console.log(`成功获取 ${rawSectors.length} 个板块。开始同步每个板块的成分股...`);

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
          headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" }
        });
        const stocksJson = await stocksRes.json();
        const rawStocks = stocksJson.data?.diff ?? [];

        const stocksList = rawStocks
          .map((s) => ({
            code: s.f12,
            name: s.f14
          }))
          .filter((s) => s.code && s.name);

        sectorStocksMap[code] = stocksList;
        console.log(`[${i + 1}/${rawSectors.length}] 同步 ${name} (${code}) 完成，共 ${stocksList.length} 只个股`);
      } catch (err) {
        console.error(`[${i + 1}/${rawSectors.length}] 同步 ${name} (${code}) 失败:`, err.message);
        sectorStocksMap[code] = [];
      }

      // 防抖延迟，避免给东财服务器造成过大压力
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // 2. 将数据写入磁盘 JSON 文件
    const metadataPath = path.join(dataDir, "sectors_metadata.json");
    const mapPath = path.join(dataDir, "sector_stocks_map.json");

    await fs.writeFile(metadataPath, JSON.stringify(sectorsMetadata, null, 2), "utf8");
    await fs.writeFile(mapPath, JSON.stringify(sectorStocksMap, null, 2), "utf8");

    const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`\n=== 同步成功！总耗时 ${elapsed} 秒 ===`);
    console.log(`- 板块列表已保存至: ${metadataPath} (共 ${sectorsMetadata.length} 个板块)`);
    console.log(`- 成分股映射已保存至: ${mapPath}`);
  } catch (err) {
    console.error("\n❌ 同步元数据发生严重错误:", err);
    process.exit(1);
  }
}

run();
