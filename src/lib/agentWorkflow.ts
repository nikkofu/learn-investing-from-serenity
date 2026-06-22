import { chatJson, type JsonSchemaSpec } from "./llm";
import { buildCriticPrompt, buildJudgePrompt, buildVotePrompt } from "./serenity";
import { computeTotalScore } from "./chokepoint";
import type { deriveStats } from "./market";
import type { BacktestResult, WalkForwardWinRate } from "./quant";
import type {
  ChokepointAssessment,
  ChokepointFactor,
  ChokepointFactorKey,
  CritiqueReport,
  CritiquePoint,
  SelfConsistencyInfo,
  StockQuote,
  WinRateInfo,
} from "./types";

const FACTOR_KEYS: ChokepointFactorKey[] = ["demand", "supply", "attention", "valueCapture", "catalyst"];

// ── B2: 结构化输出强约束（json_schema）。strict 模式要求每个属性都在 required 内、
// additionalProperties:false，从源头杜绝字段漂移；provider 不支持时 chatJson 会自动降级。
const VOTE_SCHEMA: JsonSchemaSpec = {
  name: "factor_scores",
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
            key: { type: "string", enum: FACTOR_KEYS },
            score: { type: "number" },
            evidence: { type: "string" },
          },
          required: ["key", "score", "evidence"],
        },
      },
    },
    required: ["factors"],
  },
};

const CRITIQUE_SCHEMA: JsonSchemaSpec = {
  name: "critique_report",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      unsupportedClaims: { type: "array", items: { type: "string" } },
      disconfirming: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            factorKey: { type: ["string", "null"] },
            issue: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            suggestedScoreDelta: { type: ["number", "null"] },
          },
          required: ["factorKey", "issue", "severity", "suggestedScoreDelta"],
        },
      },
      overfitWarnings: { type: "array", items: { type: "string" } },
      confidenceHaircut: { type: "number" },
      summary: { type: "string" },
    },
    required: ["unsupportedClaims", "disconfirming", "overfitWarnings", "confidenceHaircut", "summary"],
  },
};

const JUDGE_SCHEMA: JsonSchemaSpec = {
  name: "judge_verdict",
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
            key: { type: "string", enum: FACTOR_KEYS },
            score: { type: "number" },
            rationale: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["key", "score", "rationale", "evidence"],
        },
      },
      verdict: { type: "string" },
      recommendedBuy: { type: "boolean" },
      buyPriceRange: { type: "string" },
      sellPriceRange: { type: "string" },
      finalConfidence: { type: "number" },
      adjustmentNote: { type: "string" },
    },
    required: [
      "factors",
      "verdict",
      "recommendedBuy",
      "buyPriceRange",
      "sellPriceRange",
      "finalConfidence",
      "adjustmentNote",
    ],
  },
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/** Normalize whatever the critic model returned into a safe CritiqueReport. */
function normalizeCritique(raw: Partial<CritiqueReport>): CritiqueReport {
  const disconfirming: CritiquePoint[] = Array.isArray(raw.disconfirming)
    ? raw.disconfirming
        .filter((d): d is CritiquePoint => !!d && typeof d.issue === "string")
        .map((d) => ({
          factorKey: FACTOR_KEYS.includes(d.factorKey as ChokepointFactorKey) ? d.factorKey : undefined,
          issue: d.issue,
          severity: d.severity === "high" || d.severity === "low" ? d.severity : "medium",
          suggestedScoreDelta:
            typeof d.suggestedScoreDelta === "number" ? clamp(d.suggestedScoreDelta, -5, 5) : undefined,
        }))
    : [];
  return {
    unsupportedClaims: Array.isArray(raw.unsupportedClaims) ? raw.unsupportedClaims.filter((s) => typeof s === "string") : [],
    disconfirming,
    overfitWarnings: Array.isArray(raw.overfitWarnings) ? raw.overfitWarnings.filter((s) => typeof s === "string") : [],
    confidenceHaircut: clamp(Number(raw.confidenceHaircut) || 0, 0, 1),
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

/** Base confidence from the composite score (0-1). */
function baseConfidence(totalScore: number): number {
  return clamp(totalScore / 100, 0, 1);
}

/** Whether the critique contains a severe, actionable objection. */
function hasHighSeverity(c: CritiqueReport): boolean {
  return c.disconfirming.some((d) => d.severity === "high");
}

/**
 * Deterministic reconciliation used as a fallback when the judge LLM call
 * fails. Applies the critic's suggested per-factor deltas and confidence
 * haircut without any further model call — fully unit-testable offline.
 */
export function reconcileDeterministic(
  assessment: ChokepointAssessment,
  critique: CritiqueReport,
): {
  factors: ChokepointFactor[];
  totalScore: number;
  finalConfidence: number;
  recommendedBuy: boolean;
} {
  const deltaByKey = new Map<ChokepointFactorKey, number>();
  for (const d of critique.disconfirming) {
    if (!d.factorKey || typeof d.suggestedScoreDelta !== "number") continue;
    deltaByKey.set(d.factorKey, (deltaByKey.get(d.factorKey) ?? 0) + d.suggestedScoreDelta);
  }
  const factors = assessment.factors.map((f) => ({
    ...f,
    score: Math.round(clamp(f.score + (deltaByKey.get(f.key) ?? 0), 0, 5) * 10) / 10,
  }));
  const totalScore = computeTotalScore(factors);
  const finalConfidence = Math.round(clamp(baseConfidence(totalScore) - critique.confidenceHaircut, 0, 1) * 100) / 100;
  const recommendedBuy = (assessment.recommendedBuy ?? false) && finalConfidence >= 0.5 && !hasHighSeverity(critique);
  return { factors, totalScore, finalConfidence, recommendedBuy };
}

/**
 * Derive an honest win rate, never LLM-stated. Prefers the out-of-sample
 * walk-forward hit rate (no lookahead); falls back to the in-sample backtest,
 * then to "na". Always attaches the in-sample figure for comparison.
 */
export function deriveWinRate(wf: WalkForwardWinRate, bt: BacktestResult): WinRateInfo {
  const btSamples = bt.trades.filter((t) => t.type === "sell").length;
  const inSample = btSamples >= 3 ? { value: bt.winRate, sampleSize: btSamples } : undefined;
  const benchmark = buildSingleStockBenchmark(bt, btSamples);

  if (wf.sampleSize >= 5) {
    return {
      value: wf.winRate,
      source: "walkforward",
      sampleSize: wf.sampleSize,
      horizon: wf.horizon,
      avgForwardPct: wf.avgForwardPct,
      inSample,
      benchmark,
      note: `样本外滚动命中率（仅用信号当日之前数据，留出尾段统计 ${wf.horizon} 日前瞻收益，${wf.sampleSize} 次信号），非 AI 自报；比样本内回测更接近真实成功率`,
    };
  }
  if (inSample) {
    return {
      value: bt.winRate,
      source: "backtest",
      sampleSize: btSamples,
      inSample,
      benchmark,
      note: `回测口径（样本内，瓶颈点动量策略，${btSamples} 笔完成交易），非 AI 自报；样本外信号不足，样本内结果通常高估，仅供横向比较`,
    };
  }
  return { value: 0, source: "na", sampleSize: Math.max(wf.sampleSize, btSamples), benchmark, note: "样本不足，胜率不可参考" };
}

/**
 * A1：单只回测的对比基准 + 显著性。把「策略累计收益」与「同期买入持有」并排，
 * 并对胜率做单比例 z 检验（对照 50%）。单只样本通常很小，这里诚实标注「样本不足」。
 */
function buildSingleStockBenchmark(bt: BacktestResult, sampleSize: number): WinRateInfo["benchmark"] {
  const excess = bt.strategyReturn - bt.stockReturn;
  const pHat = sampleSize > 0 ? bt.winRate / 100 : 0;
  const z = sampleSize > 0 ? (pHat - 0.5) / Math.sqrt(0.25 / sampleSize) : 0;
  const significant = sampleSize >= 30 && z > 1.96;
  let note: string;
  if (sampleSize < 30) {
    note = `单只仅 ${sampleSize} 笔完成交易（<30），不具统计显著性；策略 ${fmtSigned(bt.strategyReturn)}% vs 买入持有 ${fmtSigned(bt.stockReturn)}%（超额 ${fmtSigned(excess)}pp）仅供参考。要证明胜率请用「建议忠实回测」跑多股票池。`;
  } else if (significant && excess > 0) {
    note = `胜率 ${bt.winRate}% 显著高于掷硬币（z=${z.toFixed(2)}）且跑赢同期买入持有（超额 ${fmtSigned(excess)}pp）。仍属历史回测，非未来保证。`;
  } else if (significant) {
    note = `胜率 ${bt.winRate}% 显著高于 50%（z=${z.toFixed(2)}），但未跑赢同期买入持有（超额 ${fmtSigned(excess)}pp）。`;
  } else {
    note = `胜率 ${bt.winRate}% 对 50% 不显著（z=${z.toFixed(2)}）；策略 ${fmtSigned(bt.strategyReturn)}% vs 买入持有 ${fmtSigned(bt.stockReturn)}%。`;
  }
  return {
    strategyReturnPct: bt.strategyReturn,
    buyHoldReturnPct: bt.stockReturn,
    excessPct: Number(excess.toFixed(2)),
    sampleSize,
    zVsCoin: Number(z.toFixed(2)),
    significant,
    note,
  };
}

function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface VoteOutput {
  factors?: { key: ChokepointFactorKey; score: number; evidence?: string }[];
}

export interface SelfConsistencyResult {
  factors: ChokepointFactor[];
  totalScore: number;
  info: SelfConsistencyInfo;
}

/**
 * B1 自洽投票（Google self-consistency 模式）：在主趟打分之外再独立采样 `extraRuns`
 * 次（并行、非流式），把每个因子的多次打分取**中位数**作为共识分，压低单趟 LLM 方差。
 * 任意采样失败都安全降级（沿用已得样本，最差退回主趟原分）。保留主趟的 rationale/evidence。
 */
export async function runSelfConsistencyVote(args: {
  quote: StockQuote;
  stats: ReturnType<typeof deriveStats>;
  assessment: ChokepointAssessment;
  extraRuns?: number;
}): Promise<SelfConsistencyResult> {
  const { quote, stats, assessment } = args;
  const extraRuns = clamp(args.extraRuns ?? 2, 0, 5);

  // 每个因子的打分样本，先放入主趟分。
  const samples = new Map<ChokepointFactorKey, number[]>();
  for (const f of assessment.factors) samples.set(f.key, [f.score]);

  let okSamples = 0;
  if (extraRuns > 0) {
    const { system, user } = buildVotePrompt({ quote, stats });
    const settled = await Promise.allSettled(
      Array.from({ length: extraRuns }, () => chatJson<VoteOutput>(system, user, { schema: VOTE_SCHEMA })),
    );
    for (const s of settled) {
      if (s.status !== "fulfilled" || !Array.isArray(s.value.factors)) continue;
      let used = false;
      for (const vf of s.value.factors) {
        if (!FACTOR_KEYS.includes(vf.key)) continue;
        const sc = clamp(Number(vf.score), 0, 5);
        if (!Number.isFinite(sc)) continue;
        samples.get(vf.key)?.push(Math.round(sc * 10) / 10);
        used = true;
      }
      if (used) okSamples++;
    }
  }

  const factors: ChokepointFactor[] = assessment.factors.map((f) => ({
    ...f,
    score: Math.round(median(samples.get(f.key) ?? [f.score]) * 10) / 10,
  }));
  const totalScore = computeTotalScore(factors);

  const infoFactors = assessment.factors.map((f) => {
    const arr = samples.get(f.key) ?? [f.score];
    return {
      key: f.key,
      primary: f.score,
      consensus: Math.round(median(arr) * 10) / 10,
      spread: Number((Math.max(...arr) - Math.min(...arr)).toFixed(1)),
    };
  });
  const maxSpread = Number(Math.max(0, ...infoFactors.map((x) => x.spread)).toFixed(1));
  const runs = okSamples + 1;
  const info: SelfConsistencyInfo = {
    runs,
    method: "median",
    factors: infoFactors,
    maxSpread,
    note:
      okSamples === 0
        ? "二次采样未成功，沿用单趟打分（未做自洽整合）"
        : `对 ${runs} 次独立打分取每因子中位数以降方差；当前最大因子分歧 ${maxSpread.toFixed(1)} 分`,
  };
  return { factors, totalScore, info };
}

interface JudgeFactor {
  key: ChokepointFactorKey;
  score: number;
  rationale?: string;
  evidence?: string;
}
interface JudgeOutput {
  factors?: JudgeFactor[];
  verdict?: string;
  recommendedBuy?: boolean;
  buyPriceRange?: string;
  sellPriceRange?: string;
  finalConfidence?: number;
  adjustmentNote?: string;
}

export interface ReviewResult {
  factors: ChokepointFactor[];
  totalScore: number;
  verdict: string;
  recommendedBuy: boolean;
  buyPriceRange?: string;
  sellPriceRange?: string;
  finalConfidence: number;
  critique: CritiqueReport;
  adjusted: boolean;
}

/** Run the Critic pass (Reflection): returns a structured critique. */
export async function runCriticReview(args: {
  quote: StockQuote;
  stats: ReturnType<typeof deriveStats>;
  assessment: ChokepointAssessment;
}): Promise<CritiqueReport> {
  const { system, user } = buildCriticPrompt(args);
  const raw = await chatJson<Partial<CritiqueReport>>(system, user, { schema: CRITIQUE_SCHEMA });
  return normalizeCritique(raw);
}

/**
 * Full Generator→Critic→Judge review. Returns the reconciled assessment
 * fields. If the judge call fails, falls back to deterministic reconciliation
 * driven purely by the critique.
 */
export async function runChokepointReview(args: {
  quote: StockQuote;
  stats: ReturnType<typeof deriveStats>;
  assessment: ChokepointAssessment;
  critique: CritiqueReport;
}): Promise<ReviewResult> {
  const { quote, stats, assessment, critique } = args;

  const merge = (
    factors: ChokepointFactor[],
    totalScore: number,
    finalConfidence: number,
    recommendedBuy: boolean,
    verdict: string,
    buyPriceRange: string | undefined,
    sellPriceRange: string | undefined,
    adjusted: boolean,
  ): ReviewResult => ({
    factors,
    totalScore,
    verdict,
    recommendedBuy,
    buyPriceRange,
    sellPriceRange,
    finalConfidence,
    critique,
    adjusted,
  });

  try {
    const { system, user } = buildJudgePrompt({ quote, stats, assessment, critique });
    const j = await chatJson<JudgeOutput>(system, user, { schema: JUDGE_SCHEMA });

    const byKey = new Map<ChokepointFactorKey, JudgeFactor>();
    for (const f of j.factors ?? []) {
      if (FACTOR_KEYS.includes(f.key)) byKey.set(f.key, f);
    }
    // Keep all five canonical factors; take judge's adjusted values where present.
    const factors: ChokepointFactor[] = assessment.factors.map((orig) => {
      const jf = byKey.get(orig.key);
      if (!jf) return orig;
      return {
        key: orig.key,
        score: Math.round(clamp(Number(jf.score), 0, 5) * 10) / 10,
        rationale: jf.rationale || orig.rationale,
        evidence: jf.evidence ?? orig.evidence ?? "",
      };
    });
    const totalScore = computeTotalScore(factors);
    const finalConfidence =
      typeof j.finalConfidence === "number"
        ? Math.round(clamp(j.finalConfidence, 0, 1) * 100) / 100
        : reconcileDeterministic(assessment, critique).finalConfidence;
    const recommendedBuy = (j.recommendedBuy ?? assessment.recommendedBuy ?? false) && finalConfidence >= 0.5;
    const adjusted =
      totalScore !== assessment.totalScore ||
      recommendedBuy !== (assessment.recommendedBuy ?? false) ||
      (j.verdict ? j.verdict !== assessment.verdict : false);
    return merge(
      factors,
      totalScore,
      finalConfidence,
      recommendedBuy,
      j.verdict || assessment.verdict,
      j.buyPriceRange ?? assessment.buyPriceRange,
      j.sellPriceRange ?? assessment.sellPriceRange,
      adjusted,
    );
  } catch {
    // Judge unavailable → deterministic reconciliation from the critique alone.
    const r = reconcileDeterministic(assessment, critique);
    return merge(
      r.factors,
      r.totalScore,
      r.finalConfidence,
      r.recommendedBuy,
      assessment.verdict,
      assessment.buyPriceRange,
      assessment.sellPriceRange,
      r.totalScore !== assessment.totalScore || r.recommendedBuy !== (assessment.recommendedBuy ?? false),
    );
  }
}
