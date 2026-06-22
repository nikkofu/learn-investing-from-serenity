// Shared types for the Serenity investing toolkit.

/** OpenAI-compatible LLM configuration, supplied by the user via the Settings page. */
export interface LLMConfig {
  provider: string; // free-form label, e.g. "deepseek", "openai", "moonshot"
  baseURL: string; // OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1
  model: string; // e.g. "deepseek-chat", "gpt-4o"
  apiKey: string; // stored server-side only, never sent to the browser
  filters?: string; // comma-separated keywords to filter models
  providers?: Record<string, { baseURL: string; apiKey: string; model?: string; filters?: string }>;
}

/** Config as exposed to the browser — apiKey is redacted. */
export interface PublicLLMConfig {
  provider: string;
  baseURL: string;
  model: string;
  hasApiKey: boolean;
  filters?: string;
  providers?: Record<string, { baseURL: string; hasApiKey: boolean; model?: string; filters?: string }>;
}

/** A single A-share security returned by the search endpoint. */
export interface StockSearchResult {
  code: string; // 6-digit code, e.g. "600519"
  name: string;
  market: "SH" | "SZ" | "BJ";
  secid: string; // eastmoney secid, e.g. "1.600519"
}

/** Realtime quote + headline fundamentals for an A-share. */
export interface StockQuote {
  code: string;
  name: string;
  market: "SH" | "SZ" | "BJ";
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number; // 手
  amount: number; // 元
  turnoverPct: number;
  amplitudePct: number;
  pe: number | null; // TTM
  pb: number | null;
  floatMarketCap: number; // 元 (流通市值)
  totalMarketCap: number; // 元 (总市值)
  time: string; // ISO-ish timestamp
}

/** One OHLC candle. */
export interface Candle {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  changePct: number;
  turnoverPct: number;
}

/** The five factors of Serenity's Chokepoint (瓶颈点) investing method. */
export type ChokepointFactorKey =
  | "demand"
  | "supply"
  | "attention"
  | "valueCapture"
  | "catalyst";

export interface ChokepointFactor {
  key: ChokepointFactorKey;
  /** 0-5 score assigned by the model. */
  score: number;
  /** One-line justification grounded in data / Serenity's framework. */
  rationale: string;
  /** 该打分引用的具体数据点（强制证据：引用行情/财务/区间等字段）。无支撑时为「无直接数据支撑」。 */
  evidence?: string;
}

/** 批判者（Critic / Reflection 模式）针对某个判断提出的反证点。 */
export interface CritiquePoint {
  /** 该反证主要针对的因子（可选）。 */
  factorKey?: ChokepointFactorKey;
  /** 反向/证伪性的问题描述。 */
  issue: string;
  severity: "high" | "medium" | "low";
  /** 建议的打分调整量（负数=下调），裁判会参考。 */
  suggestedScoreDelta?: number;
}

/** 批判者输出：找未被证据支撑的论断、反证、过拟合风险，并给出置信度折扣。 */
export interface CritiqueReport {
  /** 缺乏数据支撑的论断（生成器“自信但没依据”的地方）。 */
  unsupportedClaims: string[];
  /** 反证 / 证伪性证据。 */
  disconfirming: CritiquePoint[];
  /** 过拟合 / 反身性 / 幸存者偏差等元层面警告。 */
  overfitWarnings: string[];
  /** 对总体置信度的折扣，0-1（0=无折扣，1=完全推翻）。 */
  confidenceHaircut: number;
  summary: string;
}

/** 胜率口径信息：明确来源（回测/样本外，而非 LLM 自报），含样本量与诚实备注。 */
export interface WinRateInfo {
  /** 胜率 %。 */
  value: number;
  /** 来源：walkforward=样本外滚动命中率（首选）；backtest=样本内回测；na=样本不足。 */
  source: "walkforward" | "backtest" | "na";
  /** 样本量（walk-forward=触发信号数；backtest=完成交易笔数）。 */
  sampleSize: number;
  note: string;
  /** walk-forward 的前瞻评估天数。 */
  horizon?: number;
  /** walk-forward 命中样本的平均前瞻收益 %。 */
  avgForwardPct?: number;
  /** 样本内回测口径胜率，作为对照（通常偏高）。 */
  inSample?: { value: number; sampleSize: number };
  /** 单只对比基准 + 显著性（A1）：策略 vs 同期买入持有、胜率 z 检验与诚实结论。 */
  benchmark?: {
    /** 策略累计收益率 %。 */
    strategyReturnPct: number;
    /** 同期买入持有收益率 %（基准）。 */
    buyHoldReturnPct: number;
    /** 超额 = 策略 − 买入持有（百分点）。 */
    excessPct: number;
    /** 完成交易笔数（样本量）。 */
    sampleSize: number;
    /** 胜率对 50% 的单比例 z 值。 */
    zVsCoin: number;
    /** 是否统计显著（样本≥30 且 z>1.96）。 */
    significant: boolean;
    /** 一句话诚实结论。 */
    note: string;
  };
}

export interface ChokepointAssessment {
  factors: ChokepointFactor[];
  /** Weighted 0-100 composite. */
  totalScore: number;
  /** "Hidden champion" / "Watch" / "Avoid" style verdict. */
  verdict: string;
  thesis: string; // Serenity-style narrative
  risks: string[];
  catalysts: string[];
  recommendedBuy?: boolean;
  buyPriceRange?: string;
  sellPriceRange?: string;
  bomPosition?: {
    nodeName: string; // 对应产业链环节的名称，如“高速光模块”
    bomRatio: string; // 对应 BOM 成本占比，如“约 8%”
    role: string;     // 在 BOM 链条中的具体作用
  } | null;
  workflowSteps?: {
    step: number;     // 1 到 6
    title: string;    // 工作流步骤的简短标题
    content: string;  // 针对该股票的具体分析论述
  }[];
  /** 批判者复核报告（Generator→Critic→Judge 工作流的中间产物）。 */
  critique?: CritiqueReport;
  /** 裁判调和后的最终置信度，0-1。 */
  finalConfidence?: number;
  /** 裁判是否对生成器的原始打分/结论做了调整。 */
  adjusted?: boolean;
  /** 胜率（回测口径，非 LLM 自报）。 */
  winRate?: WinRateInfo;
  /** 自洽投票（self-consistency）整合信息：多次独立打分取中位以降方差。 */
  selfConsistency?: SelfConsistencyInfo;
}

/** 自洽投票（Google self-consistency 模式）：多次独立打分取中位，降低单趟 LLM 方差。 */
export interface SelfConsistencyInfo {
  /** 参与整合的打分样本数（含主趟）。 */
  runs: number;
  /** 整合方式（每因子取中位数）。 */
  method: "median";
  /** 每因子：主趟分、整合后中位分、样本极差（分歧度）。 */
  factors: { key: ChokepointFactorKey; primary: number; consensus: number; spread: number }[];
  /** 各因子中最大极差（方差/分歧指示）。 */
  maxSpread: number;
  note: string;
}

/** A node in a trend → supply-chain map. */
export interface SupplyChainNode {
  layer: string; // e.g. "下游终端", "光通信", "上游材料"
  role: string; // why this layer matters
  isChokepoint: boolean;
  chokepointReason?: string;
  tickers: { code: string; name: string; note: string }[];
  bomRatio?: string; // 成本占比，例如 "15% - 20%"
  bomDetail?: string; // 精细物料拆解描述，例如 "激光芯片占 35%，外壳占 10%"
}

export interface SupplyChainMap {
  trend: string;
  summary: string;
  nodes: SupplyChainNode[];
  disclaimer: string;
}

/** A captured Serenity post for the knowledge base. */
export interface KnowledgePost {
  id: string;
  source: "x" | "reddit";
  url: string;
  date: string;
  text: string;
  tickers: string[];
  metrics?: { likes?: number; reposts?: number; views?: number };
}

/**
 * 最新一期主要财务指标（market.ts getFinancials 的返回类型）。
 * 06-19 market.ts 引入了该类型但 types.ts 漏定义，导致 type-check 失败；此处补齐。
 */
export interface StockFinancials {
  reportName: string;
  revenue: number; // 营业总收入(元)
  revenueYoy: number | null; // 营收同比%
  netProfit: number; // 归母净利润(元)
  netProfitYoy: number | null; // 净利同比%
  grossMargin: number | null; // 毛利率%
  netMargin: number | null; // 净利率%
  roe: number | null; // 净资产收益率%
  debtRatio: number | null; // 资产负债率%
  eps: number | null; // 每股收益
}
