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

// ── 各数据类型的「隐藏」默认口径（隐藏参数可见化 Phase 3）。
// 这些 limit/num/topN/lookBack/pageSize 此前散落在各分支的 `?? 字面量` 里——前端不传、
// 响应不回显，用户拿到数据后无从得知本次到底取了多少条/回看多少天。现统一提取为具名
// 常量，并在每个响应里回显本次「生效口径」（params），不带 type 调用还会回显完整默认目录。
// 口径数值完全不变，纯属可见化。
const DEFAULTS = {
  klineLimit: 120, // 日K线根数
  financialsReport: "lrb" as SinaReportType, // 财务三表默认表（lrb=利润表）
  financialsNum: 8, // 财务三表期数
  industryTopN: 20, // 行业对比 TopN
  dragonLookBack: 30, // 龙虎榜回看天数
  marginPageSize: 30, // 两融历史条数
  blockTradePageSize: 20, // 大宗交易条数
  holderPageSize: 10, // 股东人数变动期数
  dividendPageSize: 20, // 分红送配条数
  lockupForwardDays: 90, // 解禁前瞻天数
  reportsMaxPages: 5, // 研报抓取页数
  newsPageSize: 20, // 个股新闻条数
  globalNewsPageSize: 50, // 全球资讯条数
  announcementsPageSize: 30, // 公告条数
  iwencaiChannel: "report" as "report" | "announcement" | "news", // 问财频道
  iwencaiSize: 50, // 问财结果条数
} as const;

interface ResolvedParam {
  value: number | string;
  default: number | string;
  fromUrl: boolean; // true=本次由 URL 显式传入，false=套用服务端默认
  label: string;
}

/** 解析查询参数并记录「本次生效口径」（含默认值与是否来自 URL），供响应回显。 */
function makeParamReader(searchParams: URLSearchParams) {
  const resolved: Record<string, ResolvedParam> = {};
  const num = (name: string, fallback: number, label: string): number => {
    const raw = searchParams.get(name);
    const fromUrl = raw != null;
    const value = fromUrl ? Number(raw) : fallback;
    resolved[name] = { value, default: fallback, fromUrl, label };
    return value;
  };
  const str = <T extends string>(name: string, fallback: T, label: string): T => {
    const raw = searchParams.get(name)?.trim();
    const fromUrl = !!raw;
    const value = (fromUrl ? raw : fallback) as T;
    resolved[name] = { value, default: fallback, fromUrl, label };
    return value;
  };
  const date = (label = "查询日期（Asia/Shanghai）"): string => {
    const raw = searchParams.get("date")?.trim();
    const fromUrl = !!raw;
    const value = fromUrl ? raw! : today();
    resolved["date"] = { value, default: "今日", fromUrl, label };
    return value;
  };
  const manual = (
    name: string,
    value: number | string,
    fallback: number | string,
    fromUrl: boolean,
    label: string,
  ): void => {
    resolved[name] = { value, default: fallback, fromUrl, label };
  };
  return { num, str, date, manual, resolved };
}

const needCode = (code: string | null): code is string => !!code && /^\d{6}$/.test(code);
const today = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type")?.trim() ?? "";
  const code = searchParams.get("code")?.trim() ?? null;
  const p = makeParamReader(searchParams);

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
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, params: p.resolved, data: r.data });
      }
      // ── 日K线（东财 push2his → 百度带均线 互备）──
      case "kline": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const r = await getDailyKline(code, p.num("limit", DEFAULTS.klineLimit, "日K线根数"));
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, params: p.resolved, data: r.data });
      }
      // ── 主要财务指标（东财 datacenter → 新浪 互备）──
      case "financials-main": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const r = await getMainFinancials(code);
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, params: p.resolved, data: r.data });
      }
      // ── 原始行情/K线/财报（指定单一源，不走互备）──
      case "baidu-kline":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getBaiduKline(code, p.str("start", "", "起始日期（空=数据源默认）"));
        break;
      // ── 财务三表（新浪原始三表）──
      case "financials": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const rt = p.str<SinaReportType>("report", DEFAULTS.financialsReport, "财务三表（lrb 利润/cwbbzy 摘要/zcfzb 资产/xjllb 现金流）");
        data = await getSinaFinancialReport(code, rt, p.num("num", DEFAULTS.financialsNum, "财报期数"));
        break;
      }
      // ── 信号层 ──
      case "hot": {
        const raw = searchParams.get("date")?.trim();
        p.manual("date", raw || "(同花顺最新)", "(同花顺最新)", !!raw, "热点榜日期");
        data = await getThsHotReason(raw || undefined);
        break;
      }
      case "northbound":
        data = await getNorthboundFlow();
        break;
      case "eps-forecast":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getThsEpsForecast(code);
        break;
      case "industry":
        data = await getIndustryComparison(p.num("topN", DEFAULTS.industryTopN, "行业对比 TopN"));
        break;
      case "concept-blocks":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getConceptBlocks(code);
        break;
      // ── 龙虎榜 ──
      case "dragon-tiger":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getDragonTigerBoard(code, p.date(), p.num("lookBack", DEFAULTS.dragonLookBack, "龙虎榜回看天数"));
        break;
      case "daily-dragon-tiger": {
        const d = p.date();
        const minNet = searchParams.get("minNetWan");
        p.manual("minNetWan", minNet ? Number(minNet) : "(不过滤)", "(不过滤)", !!minNet, "最低净买额（万元）");
        data = await getDailyDragonTiger(d, minNet ? Number(minNet) : undefined);
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
        data = await getMarginTrading(code, p.num("pageSize", DEFAULTS.marginPageSize, "两融历史条数"));
        break;
      case "block-trade":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getBlockTrade(code, p.num("pageSize", DEFAULTS.blockTradePageSize, "大宗交易条数"));
        break;
      case "holders":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getHolderNumChange(code, p.num("pageSize", DEFAULTS.holderPageSize, "股东人数变动期数"));
        break;
      case "dividend":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getDividendHistory(code, p.num("pageSize", DEFAULTS.dividendPageSize, "分红送配条数"));
        break;
      case "lockup":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getLockupExpiry(code, p.date(), p.num("forwardDays", DEFAULTS.lockupForwardDays, "解禁前瞻天数"));
        break;
      // ── 基本面/研报/新闻 ──
      case "stock-info": {
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        const r = await getStockProfile(code);
        return NextResponse.json({ type, source: r.source, attempts: r.attempts, params: p.resolved, data: r.data });
      }
      case "reports":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getEmReports(code, p.num("maxPages", DEFAULTS.reportsMaxPages, "研报抓取页数"));
        break;
      case "news":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getEmStockNews(code, p.num("pageSize", DEFAULTS.newsPageSize, "个股新闻条数"));
        break;
      case "global-news":
        data = await getEmGlobalNews(p.num("pageSize", DEFAULTS.globalNewsPageSize, "全球资讯条数"));
        break;
      case "announcements":
        if (!needCode(code)) return NextResponse.json({ error: "需要 6 位 code" }, { status: 400 });
        data = await getCninfoAnnouncements(code, p.num("pageSize", DEFAULTS.announcementsPageSize, "公告条数"));
        break;
      // ── iwencai（可选，需 API key）──
      case "iwencai": {
        if (!iwencaiConfigured())
          return NextResponse.json({ error: "iwencai 未配置 IWENCAI_API_KEY" }, { status: 501 });
        const q = searchParams.get("q")?.trim();
        if (!q) return NextResponse.json({ error: "需要 q" }, { status: 400 });
        const channel = p.str<"report" | "announcement" | "news">("channel", DEFAULTS.iwencaiChannel, "问财频道（report/announcement/news）");
        data = dedupArticles(await iwencaiSearch(q, channel, p.num("size", DEFAULTS.iwencaiSize, "问财结果条数")));
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
            // 隐藏参数可见化：一次性回显各 type 的可调参数默认口径，便于发现并按需覆盖。
            defaults: DEFAULTS,
          },
          { status: 400 },
        );
    }
    return NextResponse.json({ type, params: p.resolved, data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "数据获取失败" },
      { status: 502 },
    );
  }
}
