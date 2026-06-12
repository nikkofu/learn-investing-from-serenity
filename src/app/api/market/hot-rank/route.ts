import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function GET() {
  try {
    // 1. 获取东方财富股吧人气榜前 100 列表
    const rankUrl = "https://emappdata.eastmoney.com/stockrank/getAllCurrentList";
    const rankPayload = {
      appId: "appId01",
      globalId: "786e4c21-70dc-435a-93bb-38",
      marketType: "",
      pageNo: 1,
      pageSize: 100,
    };

    const rankRes = await fetch(rankUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Referer: "https://guba.eastmoney.com/",
      },
      body: JSON.stringify(rankPayload),
      cache: "no-store",
    });

    if (!rankRes.ok) {
      throw new Error(`东财热度榜获取失败: ${rankRes.status}`);
    }

    const rankJson = await rankRes.json();
    const rawList = rankJson.data ?? [];

    if (rawList.length === 0) {
      return NextResponse.json({ list: [] });
    }

    // 2. 构造东财行情接口所需的 secids 列表
    // A股代码分类规则：SZ 以 0. 开头，SH 以 1. 开头
    const secids = rawList
      .map((item: any) => {
        const sc = item.sc || "";
        const code = sc.replace(/^(SZ|SH|BJ)/, "");
        if (sc.startsWith("SH")) {
          return `1.${code}`;
        }
        return `0.${code}`;
      })
      .join(",");

    // 3. 批量拉取实时行情数据
    // f2: 最新价, f3: 涨跌幅, f12: 代码, f14: 股票名称, f24: 换手率
    const quoteUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=f057cbcbce2a86e2866ab8877db1d059&fltt=2&invt=2&fields=f2,f3,f12,f14,f24&secids=${secids}`;

    const quoteRes = await fetch(quoteUrl, {
      headers: {
        "User-Agent": UA,
        Referer: "https://quote.eastmoney.com/",
      },
      cache: "no-store",
    });

    if (!quoteRes.ok) {
      throw new Error(`东财行情列表获取失败: ${quoteRes.status}`);
    }

    const quoteJson = await quoteRes.json();
    const diffList = quoteJson.data?.diff ?? [];

    // 4. 将热榜排名与行情数据完美组装
    // 由于 ulist 返回顺序与 secids 一致，我们直接按代码匹配以确保安全
    const quoteMap = new Map<string, any>();
    diffList.forEach((q: any) => {
      if (q && q.f12) {
        quoteMap.set(q.f12, q);
      }
    });

    const list = rawList.map((item: any) => {
      const sc = item.sc || "";
      const code = sc.replace(/^(SZ|SH|BJ)/, "");
      const q = quoteMap.get(code);

      // 计算市场标识
      let market = "SZ";
      if (sc.startsWith("SH")) market = "SH";
      else if (sc.startsWith("BJ")) market = "BJ";

      return {
        rank: Number(item.rk) || 0,
        code,
        name: q?.f14 || item.sc, // 兜底使用原始证券代号
        price: q?.f2 != null && q.f2 !== "-" ? Number(q.f2) : 0,
        changePct: q?.f3 != null && q.f3 !== "-" ? Number(q.f3) : 0,
        turnoverPct: q?.f24 != null && q.f24 !== "-" ? Number(q.f24) : 0,
        market,
      };
    });

    return NextResponse.json({ list });
  } catch (error) {
    console.error("获取实时热门股错误:", error);
    return NextResponse.json(
      { error: `获取实时热门股失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
