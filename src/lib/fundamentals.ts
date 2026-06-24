/**
 * 基本面质量打分（纯函数，零依赖）。
 *
 * 透明加权：把最新一期主要财务指标 + 估值映射成 0~1 分因子，按权重合成 0~100 质量分，
 * 给出 A/B/C/D 评级。所有阈值显式写死、可解释，仅用单只个股自身指标，不做同业对标，
 * 也不预测未来——仅供研究、非投资建议。
 */

import type { StockFinancials } from "./types";

export interface FundamentalFactor {
  key: string;
  label: string;
  /** 原始指标值（百分比类即 %、倍数类即倍），缺失为 null。 */
  value: number | null;
  /** 归一后 0~1 子分，缺失为 null（不计入合成）。 */
  score: number | null;
  /** 该因子在合成中的权重（0~1）。 */
  weight: number;
  /** 简短解读。 */
  hint: string;
}

export interface FundamentalScore {
  score: number; // 0~100
  grade: "A" | "B" | "C" | "D";
  stars: number; // 1~5
  factors: FundamentalFactor[];
  /** 实际纳入合成的因子数（非缺失）。 */
  coverage: number;
}

export interface ValuationInput {
  pe: number | null;
  pb: number | null;
}

/** 线性映射到 [0,1]，越大越好。x<=lo→0，x>=hi→1。 */
function rampUp(x: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5;
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
}

/** 线性映射到 [0,1]，越小越好。x<=lo→1，x>=hi→0。 */
function rampDown(x: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5;
  return Math.max(0, Math.min(1, (hi - x) / (hi - lo)));
}

/** PE 估值合理性：亏损/异常低分，低 PE 高分，高 PE 递减。 */
function peScore(pe: number | null): number | null {
  if (pe == null || !Number.isFinite(pe)) return null;
  if (pe <= 0) return 0.2; // 亏损或异常
  if (pe <= 15) return 1;
  if (pe <= 30) return 1 - ((pe - 15) / 15) * 0.4; // 1 → 0.6
  if (pe <= 60) return 0.6 - ((pe - 30) / 30) * 0.4; // 0.6 → 0.2
  return 0.15;
}

/**
 * PEG = PE / 净利同比增速(%)。仅在 PE>0 且增速>0 时有意义，否则 null。
 */
export function pegRatio(pe: number | null, netProfitYoy: number | null): number | null {
  if (pe == null || netProfitYoy == null) return null;
  if (!Number.isFinite(pe) || !Number.isFinite(netProfitYoy)) return null;
  if (pe <= 0 || netProfitYoy <= 0) return null;
  return Number((pe / netProfitYoy).toFixed(2));
}

/**
 * 合成基本面质量分。fin 缺失时仅用估值因子（覆盖很低，分数仅供参考）。
 */
export function scoreFundamentals(
  fin: StockFinancials | null,
  valuation: ValuationInput,
): FundamentalScore {
  const factors: FundamentalFactor[] = [
    {
      key: "roe",
      label: "ROE",
      value: fin?.roe ?? null,
      score: fin?.roe != null ? rampUp(fin.roe, 0, 20) : null,
      weight: 0.25,
      hint: "净资产收益率，>15% 优",
    },
    {
      key: "netMargin",
      label: "净利率",
      value: fin?.netMargin ?? null,
      score: fin?.netMargin != null ? rampUp(fin.netMargin, 0, 25) : null,
      weight: 0.15,
      hint: "销售净利率，越高盈利质量越好",
    },
    {
      key: "revenueYoy",
      label: "营收增速",
      value: fin?.revenueYoy ?? null,
      score: fin?.revenueYoy != null ? rampUp(fin.revenueYoy, -10, 30) : null,
      weight: 0.15,
      hint: "营收同比，成长性",
    },
    {
      key: "netProfitYoy",
      label: "净利增速",
      value: fin?.netProfitYoy ?? null,
      score: fin?.netProfitYoy != null ? rampUp(fin.netProfitYoy, -20, 40) : null,
      weight: 0.2,
      hint: "归母净利同比，盈利成长",
    },
    {
      key: "debtRatio",
      label: "资产负债率",
      value: fin?.debtRatio ?? null,
      score: fin?.debtRatio != null ? rampDown(fin.debtRatio, 30, 80) : null,
      weight: 0.15,
      hint: "越低财务越稳健（逆向）",
    },
    {
      key: "valuation",
      label: "估值",
      value: valuation.pe ?? null,
      score: peScore(valuation.pe),
      weight: 0.1,
      hint: "PE-TTM，越低越便宜（亏损降权）",
    },
  ];

  let wSum = 0;
  let acc = 0;
  let coverage = 0;
  for (const f of factors) {
    if (f.score == null) continue;
    acc += f.score * f.weight;
    wSum += f.weight;
    coverage += 1;
  }
  const score = wSum > 0 ? Number(((acc / wSum) * 100).toFixed(1)) : 0;
  const grade: FundamentalScore["grade"] =
    score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";
  const stars = Math.max(1, Math.min(5, Math.round(score / 20)));
  return { score, grade, stars, factors, coverage };
}
