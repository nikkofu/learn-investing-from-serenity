import { NextResponse } from "next/server";
import {
  getRealtimeQuote,
  getRealtimeQuotes,
  getDailyKline,
  getMainFinancials,
  getStockProfile,
  getTencentQuotes,
  getBaiduKline,
  getSinaFinancialReport,
  getThsHotReason,
  getNorthboundFlow,
  getThsEpsForecast,
  getCninfoAnnouncements,
  getDragonTigerBoard,
  getDailyDragonTiger,
  getLockupExpiry,
  getMarginTrading,
  getBlockTrade,
  getHolderNumChange,
  getDividendHistory,
  getFundFlowMinute,
  getStockFundFlow120d,
  getConceptBlocks,
  getIndustryComparison,
  getEmReports,
  getEmStockNews,
  getEmGlobalNews,
  iwencaiConfigured,
  iwencaiSearch,
  dedupArticles,
} from "@/lib/sources";
import type { SinaReportType } from "@/lib/sources";

/**
 * 统一数据源出口（a-stock-data V3.2 全量接入）。
 * GET /api/market/data?type=<数据类型>&code=<6位代码>&...
 *
 * 不需要 code 的：hot(同花顺热点)、northbound(北向)、industry(行业排名)、
 *                global-news(全球资讯)、daily-dragon-tiger(全市场龙虎榜,需 date)、
 *                iwencai(需 q)。
 */

const needCode = (code: string | null): code is string => !!code && /^\d{6}$/.test(code);
const today = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type")?.trim() ?? "";
  const code = searchParams.get("code")?.trim() ?? null;
  const date = searchParams.get("date")?.trim() || today();

  try {
    let data: unknown;
    // 统一接口（带优先级+自动互备）会返回 {data, source, attempts}，整体透传给前端。
    switch (type) {
      // ── 实时行情（腾讯 → 东财 push2delay 互备）──
      case "quote": {
        const codes = (searchParams.get("codes") || code || "")
          .split(",")
          .map((c) => c.trim())
          .filter((c) => /^\d{6}$/.test(c));
        if (!codes.length) return NextResponse.json({ error: "需要 code/codes" }, { status: 400 });
        const r =
          codes.length === 1
            ? await getRealtimeQuote(codes[0]).then((s) => ({ ...s, data: { [codes[0]]: s.data } }))
            : await getRealtimeQuotes(codes);
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, data: r.data });
      }
      // ── 日K线（东财 push2his → 百度带均线 互备）──
      case "kline": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const r = await getDailyKline(code, Number(searchParams.get("limit") ?? 120));
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, data: r.data });
      }
      // ── 主要财务指标（东财 datacenter → 新浪 互备）──
      case "financials-main": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const r = await getMainFinancials(code);
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, data: r.data });
      }
      // ── 原始行情/K线/财报（指定单一源，不走互备）──
      case "baidu-kline":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getBaiduKline(code, searchParams.get("start") ?? "");
        break;
      // ── 财务三表（新浪原始三表）──
      case "financials": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const rt = (searchParams.get("report") as SinaReportType) || "lrb";
        data = await getSinaFinancialReport(code, rt, Number(searchParams.get("num") ?? 8));
        break;
      }
      // ── 信号层 ──
      case "hot":
        data = await getThsHotReason(searchParams.get("date") ?? undefined);
        break;
      case "northbound":
        data = await getNorthboundFlow();
        break;
      case "eps-forecast":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getThsEpsForecast(code);
        break;
      case "industry":
        data = await getIndustryComparison(Number(searchParams.get("topN") ?? 20));
        break;
      case "concept-blocks":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getConceptBlocks(code);
        break;
      // ── 龙虎榜 ──
      case "dragon-tiger":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getDragonTigerBoard(code, date, Number(searchParams.get("lookBack") ?? 30));
        break;
      case "daily-dragon-tiger": {
        const minNet = searchParams.get("minNetWan");
        data = await getDailyDragonTiger(date, minNet ? Number(minNet) : undefined);
        break;
      }
      // ── 资金面/筹码 ──
      case "fund-flow-min":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getFundFlowMinute(code);
        break;
      case "fund-flow-120d":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getStockFundFlow120d(code);
        break;
      case "margin":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getMarginTrading(code, Number(searchParams.get("pageSize") ?? 30));
        break;
      case "block-trade":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getBlockTrade(code, Number(searchParams.get("pageSize") ?? 20));
        break;
      case "holders":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getHolderNumChange(code, Number(searchParams.get("pageSize") ?? 10));
        break;
      case "dividend":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getDividendHistory(code, Number(searchParams.get("pageSize") ?? 20));
        break;
      case "lockup":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getLockupExpiry(code, date, Number(searchParams.get("forwardDays") ?? 90));
        break;
      // ── 基本面/研报/新闻 ──
      case "stock-info": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const r = await getStockProfile(code);
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, data: r.data });
      }
      case "reports":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getEmReports(code, Number(searchParams.get("maxPages") ?? 5));
        break;
      case "news":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getEmStockNews(code, Number(searchParams.get("pageSize") ?? 20));
        break;
      case "global-news":
        data = await getEmGlobalNews(Number(searchParams.get("pageSize") ?? 50));
        break;
      case "announcements":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getCninfoAnnouncements(code, Number(searchParams.get("pageSize") ?? 30));
        break;
      // ── iwencai（可选，需 API key）──
      case "iwencai": {
        if (!iwencaiConfigured())
          return NextResponse.json({ error: "iwencai 未配置 IWENCAI_API_KEY" }, { status: 501 });
        const q = searchParams.get("q")?.trim();
        if (!q) return NextResponse.json({ error: "需要 q" }, { status: 400 });
        const channel = (searchParams.get("channel") as "report" | "announcement" | "news") || "report";
        data = dedupArticles(await iwencaiSearch(q, channel, Number(searchParams.get("size") ?? 50)));
        break;
      }
      default:
        return NextResponse.json(
          {
            error: `未知 type: ${type || "(空)"}`,
            available: [
              "quote", "kline", "financials-main", "baidu-kline", "financials", "hot", "northbound", "eps-forecast",
              "industry", "concept-blocks", "dragon-tiger", "daily-dragon-tiger",
              "fund-flow-min", "fund-flow-120d", "margin", "block-trade", "holders",
              "dividend", "lockup", "stock-info", "reports", "news", "global-news",
              "announcements", "iwencai",
            ],
          },
          { status: 400 },
        );
    }
    return NextResponse.json({ type, data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "数据获取失败" },
      { status: 502 },
    );
  }
}
