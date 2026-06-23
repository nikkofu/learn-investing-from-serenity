/**
 * 个股分析的"静态层 / 动态层"拆分与合并。
 *
 * - 静态层（StaticAnalysis）：基本面/产业链/护城河/瓶颈定位等一周内几乎不变的
 *   推理结果，由完整管线（主推理 + 自洽投票 + Critic + Judge）算出后落盘缓存。
 * - 动态层（DynamicOverlay）：与当日行情强相关的 attention/catalyst 因子 + 买卖
 *   区间 + 区位点评，每次请求用一次轻量 LLM 调用实时刷新。
 *
 * 合并后得到完整的 ChokepointAssessment 返回给前端。
 */
import { chatJson, type JsonSchemaSpec } from "./llm";
import { buildDynamicAnalyzePrompt } from "./serenity";
import { computeTotalScore } from "./chokepoint";
import type { deriveStats } from "./market";
import type {
  ChokepointAssessment,
  ChokepointFactor,
  ChokepointFactorKey,
  CritiqueReport,
  StockQuote,
} from "./types";

/** 当前静态提示词/管线版本。改动静态提示词或缓存结构时 +1 以让旧缓存自然失效。 */
export const STATIC_PROMPT_VERSION = 1;

const STATIC_KEYS: ChokepointFactorKey[] = ["demand", "supply", "valueCapture"];
const DYNAMIC_KEYS: ChokepointFactorKey[] = ["attention", "catalyst"];

/** 落盘缓存的静态层载荷（不含任何与当日价格强相关的字段）。 */
export interface StaticAnalysis {
  promptVersion: number;
  /** 仅 demand/supply/valueCapture 三个静态因子。 */
  factors: ChokepointFactor[];
  thesis: string;
  verdict: string;
  risks: string[];
  catalysts: string[];
  bomPosition: { nodeName: string; bomRatio: string; role: string } | null;
  workflowSteps: { step: number; title: string; content: string }[];
  /** 主推理阶段流式产生的自然语言叙事，用于命中缓存时秒级回放给前端。 */
  narrative: string;
  themeName?: string;
  critique?: CritiqueReport;
}

interface DynamicOverlay {
  factors: { key: ChokepointFactorKey; score: number; rationale: string; evidence: string }[];
  recommendedBuy: boolean;
  buyPriceRange: string;
  sellPriceRange: string;
  positioning: string;
}

const DYNAMIC_SCHEMA: JsonSchemaSpec = {
  name: "dynamic_overlay",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      factors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string", enum: DYNAMIC_KEYS },
            score: { type: "number" },
            rationale: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["key", "score", "rationale", "evidence"],
        },
      },
      recommendedBuy: { type: "boolean" },
      buyPriceRange: { type: "string" },
      sellPriceRange: { type: "string" },
      positioning: { type: "string" },
    },
    required: ["factors", "recommendedBuy", "buyPriceRange", "sellPriceRange", "positioning"],
  },
};

function clamp01to5(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(5, n)) * 10) / 10;
}

/** 从完整评估中抽取"静态层"，连同流式叙事一起作为缓存载荷。 */
export function extractStatic(
  assessment: ChokepointAssessment,
  narrative: string,
  themeName?: string,
): StaticAnalysis {
  const staticFactors = assessment.factors
    .filter((f) => STATIC_KEYS.includes(f.key))
    .map((f) => ({ ...f }));
  return {
    promptVersion: STATIC_PROMPT_VERSION,
    factors: staticFactors,
    thesis: assessment.thesis,
    verdict: assessment.verdict,
    risks: assessment.risks,
    catalysts: assessment.catalysts,
    bomPosition: assessment.bomPosition ?? null,
    workflowSteps: assessment.workflowSteps ?? [],
    narrative,
    themeName,
    critique: assessment.critique,
  };
}

/** 把静态层压缩成动态提示词所需的摘要。 */
function toStaticDigest(s: StaticAnalysis) {
  return {
    thesis: s.thesis,
    verdict: s.verdict,
    staticFactors: s.factors.map((f) => ({ key: f.key, score: f.score, rationale: f.rationale })),
    bomPosition: s.bomPosition,
    themeName: s.themeName,
  };
}

/**
 * 动态层：基于缓存的静态结论 + 当日行情，一次轻量 LLM 调用刷新 attention/catalyst
 * 因子与买卖区间。任何失败都安全降级为中性占位，绝不阻断主流程。
 */
export async function runDynamicOverlay(args: {
  quote: StockQuote;
  stats: ReturnType<typeof deriveStats>;
  staticAnalysis: StaticAnalysis;
}): Promise<DynamicOverlay> {
  const { quote, stats, staticAnalysis } = args;
  const { system, user } = buildDynamicAnalyzePrompt({
    quote,
    stats,
    staticDigest: toStaticDigest(staticAnalysis),
  });
  try {
    const raw = await chatJson<Partial<DynamicOverlay>>(system, user, { schema: DYNAMIC_SCHEMA });
    const factors = (Array.isArray(raw.factors) ? raw.factors : [])
      .filter((f) => f && DYNAMIC_KEYS.includes(f.key))
      .map((f) => ({
        key: f.key,
        score: clamp01to5(Number(f.score)),
        rationale: f.rationale || "",
        evidence: f.evidence || "",
      }));
    return {
      factors,
      recommendedBuy: Boolean(raw.recommendedBuy),
      buyPriceRange: typeof raw.buyPriceRange === "string" ? raw.buyPriceRange : "",
      sellPriceRange: typeof raw.sellPriceRange === "string" ? raw.sellPriceRange : "",
      positioning: typeof raw.positioning === "string" ? raw.positioning : "",
    };
  } catch {
    return neutralOverlay();
  }
}

/** 动态层失败时的中性兜底（不改变静态结论，动态因子给 0 并标注无数据）。 */
function neutralOverlay(): DynamicOverlay {
  return {
    factors: DYNAMIC_KEYS.map((key) => ({
      key,
      score: 0,
      rationale: "（动态层推理不可用，已沿用静态结论）",
      evidence: "无直接数据支撑",
    })),
    recommendedBuy: false,
    buyPriceRange: "",
    sellPriceRange: "",
    positioning: "",
  };
}

/**
 * 合并静态层 + 动态层为完整评估。五个因子按规范顺序排列，totalScore 重新计算，
 * finalConfidence 在命中缓存路径下由综合分直接推出（不再跑 Judge）。
 */
export function mergeStaticDynamic(
  staticAnalysis: StaticAnalysis,
  overlay: DynamicOverlay,
): { assessment: ChokepointAssessment; positioning: string } {
  const byKey = new Map<ChokepointFactorKey, ChokepointFactor>();
  for (const f of staticAnalysis.factors) byKey.set(f.key, f);
  for (const f of overlay.factors) byKey.set(f.key, { key: f.key, score: f.score, rationale: f.rationale, evidence: f.evidence });

  // 规范顺序输出五因子，缺失的给 0 占位（雷达图/条形图始终完整）。
  const order: ChokepointFactorKey[] = ["demand", "supply", "attention", "valueCapture", "catalyst"];
  const factors: ChokepointFactor[] = order.map(
    (k) => byKey.get(k) ?? { key: k, score: 0, rationale: "（模型未提供该项评分）", evidence: "" },
  );

  const totalScore = computeTotalScore(factors);
  const finalConfidence = Math.round((totalScore / 100) * 100) / 100;
  const recommendedBuy = overlay.recommendedBuy && finalConfidence >= 0.5;

  const assessment: ChokepointAssessment = {
    factors,
    totalScore,
    verdict: staticAnalysis.verdict,
    thesis: staticAnalysis.thesis,
    risks: staticAnalysis.risks,
    catalysts: staticAnalysis.catalysts,
    recommendedBuy,
    buyPriceRange: overlay.buyPriceRange,
    sellPriceRange: overlay.sellPriceRange,
    bomPosition: staticAnalysis.bomPosition,
    workflowSteps: staticAnalysis.workflowSteps,
    critique: staticAnalysis.critique,
    finalConfidence,
    adjusted: false,
  };
  return { assessment, positioning: overlay.positioning };
}
