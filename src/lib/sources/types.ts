/** 新增多数据源（a-stock-data V3.2）的返回类型。 */

/** 腾讯批量行情（含估值 / 涨跌停 / 量比，可用于个股、指数、ETF）。 */
export interface TencentQuote {
  code: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number; // 成交量(手)
  amountWan: number; // 成交额(万)
  time: string; // 行情时间 ISO-ish
  turnoverPct: number;
  peTtm: number | null;
  peStatic: number | null;
  pb: number | null;
  amplitudePct: number;
  totalMarketCapYi: number; // 总市值(亿)
  floatMarketCapYi: number; // 流通市值(亿)
  limitUp: number;
  limitDown: number;
  volRatio: number; // 量比
}

/** 百度股市通 K线（自带 MA5/10/20）。 */
export interface BaiduCandle {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  turnoverPct: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
}

/** 新浪财报三表的一期记录：报告期 + 任意科目字符串值。 */
export interface SinaReportPeriod {
  period: string; // YYYY-MM-DD
  items: Record<string, string>; // 科目 -> 值（含 "<科目>_同比"）
}
export type SinaReportType = "fzb" | "lrb" | "llb"; // 资产负债表/利润表/现金流量表

/** 同花顺当日强势股（含题材归因 reason）。 */
export interface ThsHotStock {
  code: string;
  name: string;
  reason: string; // 题材归因 tags，如 "算力租赁+Token工厂"
  changePct: number;
  turnoverPct: number;
  amount: number;
  close: number;
  market: string;
}

/** 同花顺/和讯北向资金分钟流向（单位：亿元）。 */
export interface NorthboundPoint {
  time: string;
  hgtYi: number | null; // 沪股通累计净买入
  sgtYi: number | null; // 深股通累计净买入
}

/** 巨潮公告。 */
export interface CninfoAnnouncement {
  title: string;
  type: string;
  date: string;
  url: string;
}

/** 东财研报。 */
export interface EmReport {
  title: string;
  publishDate: string;
  org: string; // 机构简称
  infoCode: string;
  pdfUrl: string;
  rating: string;
  industry: string;
  epsThisYear: number | null;
  epsNextYear: number | null;
}

/** 个股所属板块（行业 + 概念 + 地域混合）。 */
export interface ConceptBlock {
  name: string;
  code: string; // BK 码
  changePct: number;
  leadStock: string;
}
export interface ConceptBlocks {
  total: number;
  boards: ConceptBlock[];
  conceptTags: string[];
}

/** 个股资金流（分钟/日级，单位：元）。 */
export interface FundFlowPoint {
  time: string; // 分钟级为时间，日级为日期
  mainNet: number;
  smallNet: number;
  midNet: number;
  largeNet: number;
  superNet: number;
}

/** 龙虎榜聚合。 */
export interface DragonTigerSeat {
  name: string;
  buyAmtWan: number;
  sellAmtWan: number;
  netWan: number;
}
export interface DragonTigerRecord {
  date: string;
  reason: string;
  netBuyWan: number;
  turnoverPct: number;
}
export interface DragonTigerBoard {
  records: DragonTigerRecord[];
  seats: { buy: DragonTigerSeat[]; sell: DragonTigerSeat[] };
  institution: { buyAmtWan: number; sellAmtWan: number; netAmtWan: number };
}

/** 全市场龙虎榜一条记录。 */
export interface DailyDragonTigerStock {
  code: string;
  name: string;
  reason: string;
  close: number;
  changePct: number;
  netBuyWan: number;
  buyWan: number;
  sellWan: number;
  turnoverPct: number;
}

/** 限售解禁。 */
export interface LockupItem {
  date: string;
  type: string;
  shares: number;
  ratio: number;
}
export interface LockupExpiry {
  history: LockupItem[];
  upcoming: LockupItem[];
}

/** 融资融券明细（单位：元）。 */
export interface MarginItem {
  date: string;
  rzye: number; // 融资余额
  rzmre: number; // 融资买入
  rzche: number; // 融资偿还
  rqye: number; // 融券余额
  rqmcl: number; // 融券卖出量
  rqchl: number; // 融券偿还量
  rzrqye: number; // 融资融券余额合计
}

/** 大宗交易。 */
export interface BlockTradeItem {
  date: string;
  price: number;
  close: number;
  premiumPct: number;
  volume: number;
  amount: number;
  buyer: string;
  seller: string;
}

/** 股东户数变化。 */
export interface HolderNumItem {
  date: string;
  holderNum: number;
  changeNum: number;
  changeRatio: number; // 环比%
  avgShares: number; // 户均持股
}

/** 分红送转。 */
export interface DividendItem {
  date: string;
  bonusRmb: number; // 每股派息(税前)
  transferRatio: number; // 每10股转增
  bonusRatio: number; // 每10股送股
  plan: string;
}

/** 行业板块排名。 */
export interface IndustryRankItem {
  rank: number;
  name: string;
  code: string;
  changePct: number;
  upCount: number;
  downCount: number;
  leader: string;
  leaderChange: number;
}
export interface IndustryComparison {
  top: IndustryRankItem[];
  bottom: IndustryRankItem[];
  total: number;
}

/** 东财个股基本面（push2 stock/get）。 */
export interface EmStockInfo {
  code: string;
  name: string;
  industry: string;
  totalShares: number; // 总股本(股)
  floatShares: number; // 流通股(股)
  marketCap: number; // 总市值(元)
  floatMarketCap: number; // 流通市值(元)
  listDate: string; // YYYYMMDD
  price: number;
}

/** 新闻/资讯。 */
export interface NewsItem {
  title: string;
  content: string;
  time: string;
  source: string;
  url: string;
}

/** 统一接口的失败转移结果：data + 实际命中源 + 每个源的尝试记录。 */
export interface SourceAttempt {
  source: string;
  ok: boolean;
  error?: string;
}
export interface Sourced<T> {
  data: T;
  source: string;
  attempts: SourceAttempt[];
}

/** 失败转移的候选源：source 名 + 取数函数 + 可选的「结果是否可接受」判定。 */
export interface Candidate<T> {
  source: string;
  run: () => Promise<T>;
  accept?: (v: T) => boolean;
}
