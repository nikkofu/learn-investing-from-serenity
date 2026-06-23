/**
 * 多数据源统一出口（a-stock-data 数据源优先级 V3.2，按封 IP 风险重排）。
 *
 * 优先级（原则：行情/K线/实时价/市值/财务 优先 mootdx/腾讯，东财只用于其独有数据且全部限流）：
 *   1. mootdx（通达信 TCP）   —— Node 不支持该二进制协议，未接入；其覆盖用以下 HTTP 源替代
 *   2. 腾讯 qt.gtimg.cn       —— getTencentQuotes（实时价/估值/市值/涨跌停，不封 IP）
 *   3. 同花顺/新浪/巨潮/百度   —— 热点归因/北向/一致预期/财报三表/公告/带均线K线
 *   末位. 东财（全部走 emFetch 限流 + push2 多 host 兜底）—— 龙虎榜/解禁/两融/大宗/
 *         股东户数/分红/资金流/板块归属/行业排名/个股基本面/研报/新闻
 */

export * from "./types";
export {
  UA,
  num,
  toNum,
  toStr,
  fetchRetry,
  emFetch,
  push2Json,
  emDatacenter,
} from "./http";

// 腾讯（行情/估值）
export { getTencentQuotes, getTencentQuote } from "./tencent";
// 百度（带均线 K 线）
export { getBaiduKline } from "./baidu";
// 新浪（财报三表）
export { getSinaFinancialReport } from "./sina";
// 同花顺（热点归因 / 北向 / 一致预期）
export { getThsHotReason, getNorthboundFlow, getThsEpsForecast } from "./ths";
// 巨潮（公告）
export { getCninfoAnnouncements } from "./cninfo";
// 东财（独有数据，全部限流 + push2 兜底）
export {
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
  getEmStockInfo,
  getEmAnalystConsensus,
  getEmReports,
  getEmStockNews,
  getEmGlobalNews,
  getEmQuote,
  emClist,
  getStockRankList,
} from "./eastmoney";
export type { StockRankItem, EmAnalystConsensus } from "./eastmoney";
// iwencai（可选，需 API key）
export { iwencaiSearch, dedupArticles, iwencaiConfigured } from "./iwencai";
// 统一接口 + 优先级 + 自动互备
export {
  getRealtimeQuote,
  getRealtimeQuotes,
  getQuoteFailover,
  getQuotesFailover,
  getDailyKline,
  getKlineFailover,
  getHfqDailyHistory,
  getMainFinancials,
  getStockProfile,
  getAnalystConsensus,
  getKlinesBatch,
} from "./unified";
export type { AnalystConsensus, KlineBatchItem } from "./unified";
// 日 K「全量落盘 + 增量更新」本地行情库
export { getDailyHistory, HISTORY_LIMIT } from "./klineStore";
export type { FqMode } from "./klineStore";
// 低层工具/搜索（保留在 market.ts，统一从本出口转出，外围只 import "@/lib/sources"）
export { searchStocks, deriveStats, classifyCode, getKlineName } from "../market";
