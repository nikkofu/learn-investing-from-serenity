import { CHOKEPOINT_FACTORS } from "./serenity";
import type { ChokepointAssessment, ChokepointFactor } from "./types";

/** Compute the weighted 0-100 composite from per-factor 0-5 scores. */
export function computeTotalScore(factors: ChokepointFactor[]): number {
  const byKey = new Map(factors.map((f) => [f.key, f]));
  let acc = 0;
  let usedWeight = 0;
  for (const def of CHOKEPOINT_FACTORS) {
    const f = byKey.get(def.key);
    if (!f) continue;
    const clamped = Math.max(0, Math.min(5, f.score));
    acc += (clamped / 5) * def.weight;
    usedWeight += def.weight;
  }
  if (usedWeight === 0) return 0;
  return Math.round((acc / usedWeight) * 100);
}

/** Normalize a raw LLM assessment into a complete, score-consistent object. */
export function finalizeAssessment(
  raw: Partial<ChokepointAssessment>
): ChokepointAssessment {
  // Index whatever valid factors the model returned.
  const provided = new Map(
    (raw.factors ?? [])
      .filter((f) => CHOKEPOINT_FACTORS.some((d) => d.key === f.key))
      .map((f) => [
        f.key,
        {
          key: f.key,
          score: Math.max(0, Math.min(5, Number(f.score) || 0)),
          rationale: f.rationale || "",
          evidence: f.evidence || "",
        } satisfies ChokepointFactor,
      ])
  );
  // Always emit all five canonical factors (in canonical order) so the radar
  // chart + bars always render a complete shape, even if the model omitted some.
  const factors: ChokepointFactor[] = CHOKEPOINT_FACTORS.map(
    (d) => provided.get(d.key) ?? { key: d.key, score: 0, rationale: "（模型未提供该项评分）", evidence: "" }
  );
  // Score over only the factors the model actually rated, so missing factors
  // don't unfairly drag the composite down to zero.
  const totalScore = computeTotalScore([...provided.values()]);
  return {
    factors,
    totalScore,
    verdict: raw.verdict || autoVerdict(totalScore),
    thesis: raw.thesis || "",
    risks: raw.risks ?? [],
    catalysts: raw.catalysts ?? [],
    recommendedBuy: raw.recommendedBuy ?? false,
    buyPriceRange: raw.buyPriceRange || "",
    sellPriceRange: raw.sellPriceRange || "",
  };
}

function autoVerdict(score: number): string {
  if (score >= 75) return "隐形冠军 — 强瓶颈点特征";
  if (score >= 55) return "值得跟踪 — 部分瓶颈特征";
  if (score >= 35) return "一般 — 瓶颈属性偏弱";
  return "回避 — 不符合瓶颈点逻辑";
}
