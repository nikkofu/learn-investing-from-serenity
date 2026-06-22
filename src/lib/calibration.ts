import { promises as fs } from "fs";
import path from "path";

/**
 * B3 校准闭环（calibration loop）：把每次分析的预测落库，事后用真实涨跌结算，
 * 再用 Brier 分 + 可靠性曲线度量「置信度是否名副其实」。
 * 不度量就无法宣称「更准」——这是把准确性变成可观测指标的最后一环。
 */

export interface PredictionRecord {
  /** `${code}:${date}` 唯一键。 */
  id: string;
  code: string;
  name: string;
  /** 预测产生日期（YYYY-MM-DD）。 */
  date: string;
  totalScore: number;
  recommendedBuy: boolean;
  /** 模型最终置信度 0-1（裁判调和后）。 */
  confidence: number;
  /** 回测口径胜率 %（参考）。 */
  winRate?: number;
  createdAt: string;
  // ── 事后结算（resolve）后填充 ──
  /** 结算用的前瞻天数。 */
  horizonDays?: number;
  /** 实际前瞻收益 %。 */
  actualReturnPct?: number;
  /** 是否「命中」（实际收益 > 0，或对 recommendedBuy 的方向正确）。 */
  hit?: boolean;
  resolvedAt?: string;
}

export interface CalibrationBin {
  /** 置信度区间下界（含）。 */
  lo: number;
  /** 置信度区间上界（含末桶）。 */
  hi: number;
  count: number;
  /** 桶内平均预测置信度。 */
  avgConfidence: number;
  /** 桶内实际命中频率。 */
  observedFreq: number;
}

export interface CalibrationSummary {
  total: number;
  resolved: number;
  pending: number;
  /** Brier 分（0=完美，越低越好）；无已结算样本时为 null。 */
  brier: number | null;
  /** 已结算样本的整体命中率 %。 */
  hitRate: number | null;
  reliability: CalibrationBin[];
  note: string;
}

/** Brier 分：mean((confidence − outcome)^2)，outcome=命中?1:0。仅用已结算样本。 */
export function computeBrier(records: PredictionRecord[]): { brier: number | null; n: number } {
  const resolved = records.filter((r) => r.hit != null && typeof r.confidence === "number");
  if (resolved.length === 0) return { brier: null, n: 0 };
  const sum = resolved.reduce((acc, r) => {
    const outcome = r.hit ? 1 : 0;
    const diff = r.confidence - outcome;
    return acc + diff * diff;
  }, 0);
  return { brier: Number((sum / resolved.length).toFixed(4)), n: resolved.length };
}

/** 可靠性曲线：按置信度分桶，比较「平均置信度」与「实际命中频率」。 */
export function computeReliability(records: PredictionRecord[], bins = 5): CalibrationBin[] {
  const resolved = records.filter((r) => r.hit != null && typeof r.confidence === "number");
  const width = 1 / bins;
  const out: CalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b * width;
    const hi = b === bins - 1 ? 1 : (b + 1) * width;
    const inBin = resolved.filter((r) => {
      const c = clamp01(r.confidence);
      return b === bins - 1 ? c >= lo && c <= hi : c >= lo && c < hi;
    });
    const count = inBin.length;
    const avgConfidence = count ? inBin.reduce((a, r) => a + clamp01(r.confidence), 0) / count : 0;
    const observedFreq = count ? inBin.filter((r) => r.hit).length / count : 0;
    out.push({
      lo: Number(lo.toFixed(2)),
      hi: Number(hi.toFixed(2)),
      count,
      avgConfidence: Number(avgConfidence.toFixed(3)),
      observedFreq: Number(observedFreq.toFixed(3)),
    });
  }
  return out;
}

/** 把记录聚合成对外展示的校准摘要。 */
export function summarizeCalibration(records: PredictionRecord[]): CalibrationSummary {
  const resolvedRecs = records.filter((r) => r.hit != null);
  const { brier } = computeBrier(records);
  const hitRate = resolvedRecs.length
    ? Number(((resolvedRecs.filter((r) => r.hit).length / resolvedRecs.length) * 100).toFixed(1))
    : null;
  const note =
    resolvedRecs.length === 0
      ? `已记录 ${records.length} 条预测，尚无已结算样本；用 /api/calibration/record 回填真实涨跌后即可得到 Brier 分与可靠性曲线`
      : `${resolvedRecs.length} 条已结算 · Brier=${brier ?? "—"}（越低越准）· 实际命中率 ${hitRate}%`;
  return {
    total: records.length,
    resolved: resolvedRecs.length,
    pending: records.length - resolvedRecs.length,
    brier,
    hitRate,
    reliability: computeReliability(records),
    note,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ── 持久化（JSON 文件，零新依赖）──

function calibPath(): string {
  return path.join(process.cwd(), ".data", "calibration.json");
}

export async function loadPredictions(): Promise<PredictionRecord[]> {
  try {
    const raw = await fs.readFile(calibPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.records) ? (parsed.records as PredictionRecord[]) : [];
  } catch {
    return [];
  }
}

async function savePredictions(records: PredictionRecord[]): Promise<void> {
  const file = calibPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ records }, null, 2), "utf8");
}

/** 记录一条预测（按 id upsert：同日同股覆盖，保留已结算结果）。 */
export async function recordPrediction(
  p: Omit<PredictionRecord, "id" | "createdAt">,
): Promise<PredictionRecord> {
  const records = await loadPredictions();
  const id = `${p.code}:${p.date}`;
  const existing = records.find((r) => r.id === id);
  const rec: PredictionRecord = {
    id,
    createdAt: new Date().toISOString(),
    ...p,
    // 保留已结算字段，避免重复分析覆盖掉真实结果。
    horizonDays: existing?.horizonDays,
    actualReturnPct: existing?.actualReturnPct,
    hit: existing?.hit,
    resolvedAt: existing?.resolvedAt,
  };
  const next = existing ? records.map((r) => (r.id === id ? rec : r)) : [...records, rec];
  await savePredictions(next);
  return rec;
}

/** 事后用真实涨跌结算一条预测。hit 默认按「实际收益 > 0」判定。 */
export async function resolvePrediction(args: {
  code: string;
  date?: string;
  actualReturnPct: number;
  horizonDays?: number;
  hit?: boolean;
}): Promise<PredictionRecord | null> {
  const records = await loadPredictions();
  const candidates = records
    .filter((r) => r.code === args.code && (args.date ? r.date === args.date : true))
    .sort((a, b) => b.date.localeCompare(a.date));
  const target = candidates[0];
  if (!target) return null;
  target.actualReturnPct = Number(args.actualReturnPct);
  target.horizonDays = args.horizonDays;
  target.hit = args.hit ?? args.actualReturnPct > 0;
  target.resolvedAt = new Date().toISOString();
  await savePredictions(records);
  return target;
}

export async function getCalibrationSummary(): Promise<CalibrationSummary> {
  return summarizeCalibration(await loadPredictions());
}
