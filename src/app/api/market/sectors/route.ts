import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";
import { emClist } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cacheKey = "market:sectors";
    const ttl = getAdaptiveTTL("sectors");

    // 1. 读取本地静态板块元数据
    let localMeta: Array<{ code: string; name: string }> = [];
    try {
      const metadataPath = path.join(process.cwd(), "data", "sectors_metadata.json");
      const raw = await fs.readFile(metadataPath, "utf8");
      localMeta = JSON.parse(raw);
    } catch {
      console.warn("未能找到本地 sectors_metadata.json 元数据，将采用动态拉取兜底。");
    }

    const list = await globalCache.getOrCreate(
      cacheKey,
      async () => {
        let rawList: any[] = [];
        try {
          // f2: 板块点数, f3: 涨跌幅, f12: 板块代码, f14: 板块名称, f62: 主力净流入
          // f104: 上涨数, f105: 下跌数, f128: 领涨个股, f140: 领涨个股代码, f141: 领涨个股涨跌幅
          // 统一 clist 接口（push2delay 兜底 + 限流），替代直连 push2。
          rawList = await emClist({
            pn: 1, pz: 150, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
            fs: "m:90 t:2 f:!2",
            fields: "f2,f3,f12,f14,f62,f104,f105,f128,f140,f141",
          });
        } catch (err) {
          console.error("动态拉取东财板块列表实时行情失败:", err);
          // 如果拉取失败，且本地也没有元数据，才抛出错误
          if (localMeta.length === 0) {
            throw err;
          }
        }

        // 以实时行情优先。如果拉取失败或为空，直接以本地静态数据配合平盘状态返回
        if (rawList.length === 0) {
          return localMeta.map((item) => ({
            code: item.code,
            name: item.name,
            changePct: 0,
            price: 0,
            netInflow: 0,
            riseCount: 0,
            fallCount: 0,
            leadStockName: "-",
            leadStockCode: "",
            leadStockChangePct: 0,
          }));
        }

        // 如果既有本地配置，又有实时数据，我们可以根据本地配置过滤并校正名称，保证只显示同步的、关注的行业板块
        const liveMap = new Map<string, any>();
        rawList.forEach((r) => {
          if (r && r.f12) liveMap.set(r.f12, r);
        });

        // 优先使用本地板块元数据，使得列表干净并符合分类
        const baseList = localMeta.length > 0 ? localMeta : rawList.map(r => ({ code: r.f12, name: r.f14 }));

        return baseList.map((meta) => {
          const liveItem = liveMap.get(meta.code);
          const changePct = liveItem?.f3 != null && liveItem?.f3 !== "-" ? Number(liveItem.f3) : 0;
          const price = liveItem?.f2 != null && liveItem?.f2 !== "-" ? Number(liveItem.f2) : 0;
          const netInflow = liveItem?.f62 != null && liveItem?.f62 !== "-" ? Number(liveItem.f62) : 0;
          const riseCount = liveItem?.f104 != null ? Number(liveItem.f104) : 0;
          const fallCount = liveItem?.f105 != null ? Number(liveItem.f105) : 0;

          return {
            code: meta.code,
            name: meta.name || liveItem?.f14 || "未知板块",
            changePct,
            price,
            netInflow,
            riseCount,
            fallCount,
            leadStockName: liveItem?.f128 || "-",
            leadStockCode: liveItem?.f140 || "",
            leadStockChangePct: liveItem?.f141 != null && liveItem?.f141 !== "-" ? Number(liveItem.f141) : 0,
          };
        });
      },
      ttl
    );

    return NextResponse.json({ list });
  } catch (error) {
    console.error("获取板块列表错误:", error);
    return NextResponse.json(
      { error: `获取板块列表失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
