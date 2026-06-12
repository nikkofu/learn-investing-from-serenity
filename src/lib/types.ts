// Shared types for the Serenity investing toolkit.

/** OpenAI-compatible LLM configuration, supplied by the user via the Settings page. */
export interface LLMConfig {
  provider: string; // free-form label, e.g. "deepseek", "openai", "moonshot"
  baseURL: string; // OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1
  model: string; // e.g. "deepseek-chat", "gpt-4o"
  apiKey: string; // stored server-side only, never sent to the browser
}

/** Config as exposed to the browser — apiKey is redacted. */
export interface PublicLLMConfig {
  provider: string;
  baseURL: string;
  model: string;
  hasApiKey: boolean;
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
