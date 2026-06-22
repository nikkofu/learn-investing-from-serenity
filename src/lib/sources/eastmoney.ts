/**
 * 东财独有数据（V3.2「末位」源）——别处拿不到、必须走东财的接口。
 * 全部通过 http.ts 的 emFetch()/push2Json() 走串行限流 + push2 多 host 兜底，避免封 IP。
 *
 *   datacenter-web: 龙虎榜 / 全市场龙虎榜 / 限售解禁 / 融资融券 / 大宗交易 / 股东户数 / 分红
 *   push2(delay):   个股基本面 stock/get / 板块归属 slist / 行业排名 clist / 分钟资金流 fflow
 *   push2his:       120 日日级资金流
 *   reportapi:      研报列表（+ PDF URL）
 *   search/np:      个股新闻 / 全球资讯
 */

import { classifyCode } from "../market";
import type { StockQuote } from "../types";
import { num, toNum, toStr, qs, emFetch, push2Json, emDatacenter } from "./http";
import type {
  BlockTradeItem,
  ConceptBlocks,
  DailyDragonTigerStock,
  DividendItem,
  DragonTigerBoard,
  DragonTigerRecord,
  DragonTigerSeat,
  EmReport,
  EmStockInfo,
  FundFlowPoint,
  HolderNumItem,
  IndustryComparison,
  IndustryRankItem,
  LockupExpiry,
  LockupItem,
  MarginItem,
  NewsItem,
} from "./types";

type Row = Record<string, unknown>;
const wan = (v: unknown) => Math.round((num(v) / 10000) * 10) / 10; // 元 -> 万(1位小数)

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 龙虎榜 ────────────────────────────────────────────────────────────
export async function getDragonTigerBoard(
  code: string,
  tradeDate: string,
  lookBack = 30,
): Promise<DragonTigerBoard> {
  const startStr = addDays(tradeDate, -lookBack);

  const recRows = await emDatacenter({
    reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
    filter: `(TRADE_DATE>='${startStr}')(TRADE_DATE<='${tradeDate}')(SECURITY_CODE="${code}")`,
    pageSize: 50,
    sortColumns: "TRADE_DATE",
    sortTypes: "-1",
  });
  const records: DragonTigerRecord[] = recRows.map((r) => ({
    date: toStr(r.TRADE_DATE).slice(0, 10),
    reason: toStr(r.EXPLANATION),
    netBuyWan: wan(r.BILLBOARD_NET_AMT),
    turnoverPct: Math.round(num(r.TURNOVERRATE) * 100) / 100,
  }));

  const seats: { buy: DragonTigerSeat[]; sell: DragonTigerSeat[] } = { buy: [], sell: [] };
  let buyData: Row[] = [];
  let sellData: Row[] = [];

  if (records.length) {
    const latestDate = records[0].date;
    [buyData, sellData] = await Promise.all([
      emDatacenter({
        reportName: "RPT_BILLBOARD_DAILYDETAILSBUY",
        filter: `(TRADE_DATE='${latestDate}')(SECURITY_CODE="${code}")`,
        pageSize: 10,
        sortColumns: "BUY",
        sortTypes: "-1",
      }),
      emDatacenter({
        reportName: "RPT_BILLBOARD_DAILYDETAILSSELL",
        filter: `(TRADE_DATE='${latestDate}')(SECURITY_CODE="${code}")`,
        pageSize: 10,
        sortColumns: "SELL",
        sortTypes: "-1",
      }),
    ]);
    const toSeat = (r: Row): DragonTigerSeat => ({
      name: toStr(r.OPERATEDEPT_NAME),
      buyAmtWan: wan(r.BUY),
      sellAmtWan: wan(r.SELL),
      netWan: wan(r.NET),
    });
    seats.buy = buyData.slice(0, 5).map(toSeat);
    seats.sell = sellData.slice(0, 5).map(toSeat);
  }

  // 机构专用席位（OPERATEDEPT_CODE="0"）
  let instBuy = 0;
  let instSell = 0;
  for (const r of buyData) if (toStr(r.OPERATEDEPT_CODE) === "0") instBuy += num(r.BUY);
  for (const r of sellData) if (toStr(r.OPERATEDEPT_CODE) === "0") instSell += num(r.SELL);
  const buyAmtWan = Math.round((instBuy / 10000) * 10) / 10;
  const sellAmtWan = Math.round((instSell / 10000) * 10) / 10;

  return {
    records,
    seats,
    institution: { buyAmtWan, sellAmtWan, netAmtWan: Math.round((buyAmtWan - sellAmtWan) * 10) / 10 },
  };
}

// ── 全市场龙虎榜 ──────────────────────────────────────────────────────
export async function getDailyDragonTiger(
  tradeDate: string,
  minNetBuyWan?: number,
): Promise<{ date: string; total: number; stocks: DailyDragonTigerStock[] }> {
  const rows = await emDatacenter({
    reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
    filter: `(TRADE_DATE>='${tradeDate}')(TRADE_DATE<='${tradeDate}')`,
    pageSize: 500,
    sortColumns: "BILLBOARD_NET_AMT",
    sortTypes: "-1",
  });
  if (!rows.length) return { date: tradeDate, total: 0, stocks: [] };
  const actualDate = toStr(rows[0].TRADE_DATE).slice(0, 10) || tradeDate;
  const stocks: DailyDragonTigerStock[] = [];
  for (const r of rows) {
    const netBuyWan = wan(r.BILLBOARD_NET_AMT);
    if (minNetBuyWan !== undefined && netBuyWan < minNetBuyWan) continue;
    stocks.push({
      code: toStr(r.SECURITY_CODE),
      name: toStr(r.SECURITY_NAME_ABBR),
      reason: toStr(r.EXPLANATION),
      close: num(r.CLOSE_PRICE),
      changePct: Math.round(num(r.CHANGE_RATE) * 100) / 100,
      netBuyWan,
      buyWan: wan(r.BILLBOARD_BUY_AMT),
      sellWan: wan(r.BILLBOARD_SELL_AMT),
      turnoverPct: Math.round(num(r.TURNOVERRATE) * 100) / 100,
    });
  }
  return { date: actualDate, total: stocks.length, stocks };
}

// ── 限售解禁 ──────────────────────────────────────────────────────────
export async function getLockupExpiry(
  code: string,
  tradeDate: string,
  forwardDays = 90,
): Promise<LockupExpiry> {
  const toItem = (r: Row): LockupItem => ({
    date: toStr(r.FREE_DATE).slice(0, 10),
    type: toStr(r.LIMITED_STOCK_TYPE),
    shares: num(r.FREE_SHARES_NUM),
    ratio: num(r.FREE_RATIO),
  });
  const [historyRows, upcomingRows] = await Promise.all([
    emDatacenter({
      reportName: "RPT_LIFT_STAGE",
      filter: `(SECURITY_CODE="${code}")`,
      pageSize: 15,
      sortColumns: "FREE_DATE",
      sortTypes: "-1",
    }),
    emDatacenter({
      reportName: "RPT_LIFT_STAGE",
      filter: `(SECURITY_CODE="${code}")(FREE_DATE>='${tradeDate}')(FREE_DATE<='${addDays(tradeDate, forwardDays)}')`,
      pageSize: 20,
      sortColumns: "FREE_DATE",
      sortTypes: "1",
    }),
  ]);
  return { history: historyRows.map(toItem), upcoming: upcomingRows.map(toItem) };
}

// ── 融资融券 ──────────────────────────────────────────────────────────
export async function getMarginTrading(code: string, pageSize = 30): Promise<MarginItem[]> {
  const rows = await emDatacenter({
    reportName: "RPTA_WEB_RZRQ_GGMX",
    filter: `(SCODE="${code}")`,
    pageSize,
    sortColumns: "DATE",
    sortTypes: "-1",
  });
  return rows.map((r) => ({
    date: toStr(r.DATE).slice(0, 10),
    rzye: num(r.RZYE),
    rzmre: num(r.RZMRE),
    rzche: num(r.RZCHE),
    rqye: num(r.RQYE),
    rqmcl: num(r.RQMCL),
    rqchl: num(r.RQCHL),
    rzrqye: num(r.RZRQYE),
  }));
}

// ── 大宗交易 ──────────────────────────────────────────────────────────
export async function getBlockTrade(code: string, pageSize = 20): Promise<BlockTradeItem[]> {
  const rows = await emDatacenter({
    reportName: "RPT_DATA_BLOCKTRADE",
    filter: `(SECURITY_CODE="${code}")`,
    pageSize,
    sortColumns: "TRADE_DATE",
    sortTypes: "-1",
  });
  return rows.map((r) => {
    const close = num(r.CLOSE_PRICE);
    const price = num(r.DEAL_PRICE);
    return {
      date: toStr(r.TRADE_DATE).slice(0, 10),
      price,
      close,
      premiumPct: close ? Math.round((price / close - 1) * 100 * 100) / 100 : 0,
      volume: num(r.DEAL_VOLUME),
      amount: num(r.DEAL_AMT),
      buyer: toStr(r.BUYER_NAME),
      seller: toStr(r.SELLER_NAME),
    };
  });
}

// ── 股东户数 ──────────────────────────────────────────────────────────
export async function getHolderNumChange(code: string, pageSize = 10): Promise<HolderNumItem[]> {
  const rows = await emDatacenter({
    reportName: "RPT_HOLDERNUMLATEST",
    filter: `(SECURITY_CODE="${code}")`,
    pageSize,
    sortColumns: "END_DATE",
    sortTypes: "-1",
  });
  return rows.map((r) => ({
    date: toStr(r.END_DATE).slice(0, 10),
    holderNum: num(r.HOLDER_NUM),
    changeNum: num(r.HOLDER_NUM_CHANGE),
    changeRatio: num(r.HOLDER_NUM_RATIO),
    avgShares: num(r.AVG_FREE_SHARES),
  }));
}

// ── 分红送转 ──────────────────────────────────────────────────────────
export async function getDividendHistory(code: string, pageSize = 20): Promise<DividendItem[]> {
  const rows = await emDatacenter({
    reportName: "RPT_SHAREBONUS_DET",
    filter: `(SECURITY_CODE="${code}")`,
    pageSize,
    sortColumns: "EX_DIVIDEND_DATE",
    sortTypes: "-1",
  });
  return rows.map((r) => ({
    date: toStr(r.EX_DIVIDEND_DATE).slice(0, 10),
    bonusRmb: num(r.PRETAX_BONUS_RMB),
    transferRatio: num(r.TRANSFER_RATIO),
    bonusRatio: num(r.BONUS_RATIO),
    plan: toStr(r.ASSIGN_PROGRESS),
  }));
}

// ── 个股资金流（push2 系，单位：元）─────────────────────────────────────
interface FflowResp {
  data?: { klines?: string[] };
}
function parseFflow(klines: string[]): FundFlowPoint[] {
  const out: FundFlowPoint[] = [];
  for (const line of klines) {
    const p = line.split(",");
    if (p.length < 6) continue;
    out.push({
      time: p[0],
      mainNet: num(p[1]),
      smallNet: num(p[2]),
      midNet: num(p[3]),
      largeNet: num(p[4]),
      superNet: num(p[5]),
    });
  }
  return out;
}

/** 分钟级资金流（当日盘中，klt=1）。 */
export async function getFundFlowMinute(code: string): Promise<FundFlowPoint[]> {
  const { secid } = classifyCode(code);
  const d = await push2Json<FflowResp>("/api/qt/stock/fflow/kline/get", {
    secid,
    klt: 1,
    fields1: "f1,f2,f3,f7",
    fields2: "f51,f52,f53,f54,f55,f56,f57",
  });
  return parseFflow(d.data?.klines ?? []);
}

/** 120 日日级资金流（push2his，host 固定）。 */
export async function getStockFundFlow120d(code: string): Promise<FundFlowPoint[]> {
  const { secid } = classifyCode(code);
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?" +
    qs({
      secid,
      fields1: "f1,f2,f3,f7",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
      lmt: "120",
    });
  const res = await emFetch(url, { headers: { Referer: "https://quote.eastmoney.com/" } });
  const d = (await res.json()) as FflowResp;
  return parseFflow(d.data?.klines ?? []);
}

// ── 板块归属 slist（push2 系）───────────────────────────────────────────
interface SlistResp {
  data?: { diff?: Record<string, Row> | Row[] };
}
export async function getConceptBlocks(code: string): Promise<ConceptBlocks> {
  const { secid } = classifyCode(code);
  const d = await push2Json<SlistResp>("/api/qt/slist/get", {
    fltt: "2",
    invt: "2",
    secid,
    spt: "3",
    pi: "0",
    pz: "200",
    po: "1",
    fields: "f12,f14,f3,f128",
  });
  const diff = d.data?.diff ?? {};
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  const boards = items.map((it) => ({
    name: toStr(it.f14),
    code: toStr(it.f12),
    changePct: num(it.f3),
    leadStock: toStr(it.f128),
  }));
  return { total: boards.length, boards, conceptTags: boards.map((b) => b.name) };
}

// ── 行业板块排名 clist（push2 系）───────────────────────────────────────
interface ClistResp {
  data?: { diff?: Record<string, Row> | Row[] };
}
export async function getIndustryComparison(topN = 20): Promise<IndustryComparison> {
  const d = await push2Json<ClistResp>("/api/qt/clist/get", {
    pn: "1",
    pz: "100",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fs: "m:90 t:2",
    fields: "f2,f3,f4,f12,f13,f14,f104,f105,f128,f136,f140,f141,f207",
  });
  const diff = d.data?.diff ?? {};
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  if (!items.length) return { top: [], bottom: [], total: 0 };
  const rows: IndustryRankItem[] = items.map((it, i) => ({
    rank: i + 1,
    name: toStr(it.f14),
    code: toStr(it.f12),
    changePct: num(it.f3),
    upCount: num(it.f104),
    downCount: num(it.f105),
    leader: toStr(it.f140),
    leaderChange: num(it.f136),
  }));
  return { top: rows.slice(0, topN), bottom: rows.slice(-topN), total: rows.length };
}

/**
 * 通用板块/排序列表 clist（push2 系，多 host 兜底 + 限流）。
 * 行业板块列表、板块成分股、全市场排序候选池等统一走它，
 * 替代各路由里散落的裸 fetch（避免直连 push2 被封、无限流）。
 * 返回归一化后的 diff 行数组（兼容 diff 为对象或数组两种形态）。
 */
export async function emClist(
  params: Record<string, string | number | undefined>,
): Promise<Row[]> {
  const d = await push2Json<ClistResp>("/api/qt/clist/get", params);
  const diff = d.data?.diff ?? {};
  return Array.isArray(diff) ? diff : Object.values(diff);
}

// ── 东财人气榜 emappdata（东财独有；走 emFetch 限流）─────────────────────
interface StockRankRaw {
  sc?: string;
  rk?: number | string;
}
export interface StockRankItem {
  code: string;
  sc: string;
  rank: number;
  market: "SH" | "SZ" | "BJ";
}
export async function getStockRankList(pageSize = 100): Promise<StockRankItem[]> {
  const res = await emFetch("https://emappdata.eastmoney.com/stockrank/getAllCurrentList", {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: "https://guba.eastmoney.com/" },
    body: JSON.stringify({
      appId: "appId01",
      globalId: "786e4c21-70dc-435a-93bb-38",
      marketType: "",
      pageNo: 1,
      pageSize,
    }),
  });
  const j = (await res.json()) as { data?: StockRankRaw[] };
  const out: StockRankItem[] = [];
  for (const it of j.data ?? []) {
    const sc = toStr(it.sc);
    const code = sc.replace(/^(SZ|SH|BJ)/, "");
    if (!/^\d{6}$/.test(code)) continue;
    const market = sc.startsWith("SH") ? "SH" : sc.startsWith("BJ") ? "BJ" : "SZ";
    out.push({ code, sc, rank: num(it.rk), market });
  }
  return out;
}

// ── 实时行情 stock/get（push2 系，腾讯的兜底源；境外走 push2delay）──────────
export async function getEmQuote(code: string): Promise<StockQuote> {
  const { secid, market } = classifyCode(code);
  const d = await push2Json<StockGetResp>("/api/qt/stock/get", {
    fltt: "2",
    invt: "2",
    fields: "f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f116,f117,f162,f167,f168,f169,f170,f171",
    secid,
  });
  const r = d.data;
  if (!r) throw new Error(`东财无行情: ${code}`);
  const ts = num(r.f86);
  return {
    code: toStr(r.f57) || code,
    name: toStr(r.f58),
    market,
    price: num(r.f43),
    prevClose: num(r.f60),
    open: num(r.f46),
    high: num(r.f44),
    low: num(r.f45),
    change: num(r.f169),
    changePct: num(r.f170),
    volume: num(r.f47),
    amount: num(r.f48),
    turnoverPct: num(r.f168),
    amplitudePct: num(r.f171),
    pe: toNum(r.f162),
    pb: toNum(r.f167),
    floatMarketCap: num(r.f117),
    totalMarketCap: num(r.f116),
    time: ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
  };
}

// ── 个股基本面 stock/get（push2 系）─────────────────────────────────────
interface StockGetResp {
  data?: Row;
}
export async function getEmStockInfo(code: string): Promise<EmStockInfo | null> {
  const { secid } = classifyCode(code);
  const d = await push2Json<StockGetResp>("/api/qt/stock/get", {
    fltt: "2",
    invt: "2",
    fields: "f57,f58,f84,f85,f127,f116,f117,f189,f43",
    secid,
  });
  const r = d.data;
  if (!r) return null;
  return {
    code: toStr(r.f57),
    name: toStr(r.f58),
    industry: toStr(r.f127),
    totalShares: num(r.f84),
    floatShares: num(r.f85),
    marketCap: num(r.f116),
    floatMarketCap: num(r.f117),
    listDate: toStr(r.f189),
    price: num(r.f43),
  };
}

// ── 研报列表（reportapi）────────────────────────────────────────────────
interface ReportListResp {
  data?: Array<Row>;
  TotalPage?: number;
}
export async function getEmReports(code: string, maxPages = 5): Promise<EmReport[]> {
  const all: EmReport[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      "https://reportapi.eastmoney.com/report/list?" +
      qs({
        industryCode: "*",
        pageSize: "100",
        industry: "*",
        rating: "*",
        ratingChange: "*",
        beginTime: "2000-01-01",
        endTime: "2030-01-01",
        pageNo: String(page),
        fields: "",
        qType: "0",
        orgCode: "",
        code,
        rcode: "",
        p: String(page),
        pageNum: String(page),
        pageNumber: String(page),
      });
    const res = await emFetch(url, { headers: { Referer: "https://data.eastmoney.com/" }, timeoutMs: 30000 });
    const d = (await res.json()) as ReportListResp;
    const rows = d.data ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      const infoCode = toStr(r.infoCode);
      all.push({
        title: toStr(r.title),
        publishDate: toStr(r.publishDate).slice(0, 10),
        org: toStr(r.orgSName),
        infoCode,
        pdfUrl: infoCode ? `https://pdf.dfcfw.com/pdf/H3_${infoCode}_1.pdf` : "",
        rating: toStr(r.emRatingName),
        industry: toStr(r.indvInduName),
        epsThisYear: toNum(r.predictThisYearEps),
        epsNextYear: toNum(r.predictNextYearEps),
      });
    }
    if (page >= (d.TotalPage ?? 1)) break;
  }
  return all;
}

// ── 卖方一致预期（基于研报列表聚合）─────────────────────────────────────
export interface EmAnalystConsensus {
  /** 纳入统计的研报数（近 lookbackDays 天，无则回退最近 N 篇）。 */
  reportCount: number;
  /** 看多评级（买入/增持/推荐/强烈推荐等）研报数。 */
  buyCount: number;
  /** 看多占比 0–1。 */
  buyRatio: number | null;
  /** 一致预测今年 EPS（中位数）。 */
  consensusEpsThisYear: number | null;
  /** 一致预测明年 EPS（中位数）。 */
  consensusEpsNextYear: number | null;
  /** 最新一篇研报日期。 */
  latestReportDate: string | null;
}

/** 看多类评级关键字（东财 emRatingName 取值）。 */
const BULLISH_RATINGS = ["买入", "增持", "推荐", "强烈推荐", "强推", "审慎增持", "谨慎增持", "跑赢"];

function median(values: number[]): number | null {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/**
 * 卖方一致预期：基于东财研报列表（reportapi）聚合，对标 SCS 的 `analyst` 能力，
 * 但不依赖 Python/akshare（akshare 底层即东财同源）。统计近 lookbackDays 天研报的
 * 看多占比与一致预测 EPS 中位数；研报不足则回退到最近 30 篇。失败返回 null。
 */
export async function getEmAnalystConsensus(
  code: string,
  lookbackDays = 180,
): Promise<EmAnalystConsensus | null> {
  const reports = await getEmReports(code, 3);
  if (!reports.length) return null;
  const cutoff = addDays(new Date().toISOString().slice(0, 10), -lookbackDays);
  const recent = reports.filter((r) => r.publishDate && r.publishDate >= cutoff);
  const pool = recent.length ? recent : reports.slice(0, 30);
  if (!pool.length) return null;

  let buyCount = 0;
  for (const r of pool) {
    if (r.rating && BULLISH_RATINGS.some((b) => r.rating.includes(b))) buyCount++;
  }
  const epsThis = median(pool.map((r) => r.epsThisYear).filter((v): v is number => v != null));
  const epsNext = median(pool.map((r) => r.epsNextYear).filter((v): v is number => v != null));
  const latest = pool.reduce<string | null>(
    (acc, r) => (r.publishDate && (!acc || r.publishDate > acc) ? r.publishDate : acc),
    null,
  );
  return {
    reportCount: pool.length,
    buyCount,
    buyRatio: pool.length ? Math.round((buyCount / pool.length) * 1000) / 1000 : null,
    consensusEpsThisYear: epsThis,
    consensusEpsNextYear: epsNext,
    latestReportDate: latest,
  };
}

// ── 个股新闻（search-api-web JSONP）─────────────────────────────────────
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
interface NewsResp {
  result?: { cmsArticleWebOld?: Array<Row> };
}
export async function getEmStockNews(code: string, pageSize = 20): Promise<NewsItem[]> {
  const inner = JSON.stringify({
    uid: "",
    keyword: code,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize,
        preTag: "",
        postTag: "",
      },
    },
  });
  const url =
    "https://search-api-web.eastmoney.com/search/jsonp?" + qs({ cb: "jQuery_news", param: inner });
  const res = await emFetch(url, { headers: { Referer: "https://so.eastmoney.com/" } });
  const text = await res.text();
  const json = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const d = JSON.parse(json) as NewsResp;
  return (d.result?.cmsArticleWebOld ?? []).map((a) => ({
    title: stripTags(toStr(a.title)),
    content: stripTags(toStr(a.content)).slice(0, 200),
    time: toStr(a.date),
    source: toStr(a.mediaName),
    url: toStr(a.url),
  }));
}

// ── 全球资讯 7x24（np-weblist）──────────────────────────────────────────
interface GlobalNewsResp {
  data?: { fastNewsList?: Array<Row> };
}
export async function getEmGlobalNews(pageSize = 50): Promise<NewsItem[]> {
  const url =
    "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?" +
    qs({
      client: "web",
      biz: "web_724",
      fastColumn: "102",
      sortEnd: "",
      pageSize: String(pageSize),
      req_trace: crypto.randomUUID(),
    });
  const res = await emFetch(url, { headers: { Referer: "https://kuaixun.eastmoney.com/" } });
  const d = (await res.json()) as GlobalNewsResp;
  return (d.data?.fastNewsList ?? []).map((a) => ({
    title: toStr(a.title),
    content: toStr(a.summary).slice(0, 200),
    time: toStr(a.showTime),
    source: "东方财富",
    url: "",
  }));
}
