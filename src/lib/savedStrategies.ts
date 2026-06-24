import { promises as fs } from "fs";
import path from "path";
import type { Candle } from "@/lib/types";
import {
  calibratePair,
  currentArbSignal,
  type ArbSignal,
  type PairCandidate,
} from "@/lib/pairTrading";

/**
 * v0.34 信号 → 策略沉淀 持久化层。
 *
 * 复用项目既有「.data/ JSON 落盘」机制（同 watchlist.ts / alerts.ts），零新依赖：
 * 把 /arb 信号回测校准里「验证过的协整配对 + 参数」一键沉淀成一条可持久化、
 * 可复检、可分享（导出/导入 JSON）的「配对策略」，在「策略市场」单列展示。
 *
 * 与内置单票动量策略（strategies.ts，跑统一篮子算榜单）不同：沉淀策略是配对均值回归，
 * 指标口径（回归率 / 单边胜率 / 单边净收益 / 逆向 |z|）不可比，故在策略市场单开一区。
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "saved-strategies.json");

const CODE_RE = /^\d{6}$/;

/** 配对策略的一组校准战绩（沉淀时为快照，复检后刷新为最近一次）。 */
export interface PairTrackRecord {
  /** 历史触发的开口信号次数。 */
  signals: number;
  /** 价差回归兑现占比%。 */
  reversionRatePct: number;
  /** 已回归信号的平均持有天数。 */
  avgRevertDays: number;
  /** 单边买入腿平均净收益%。 */
  avgLegReturnPct: number;
  /** 单边买入腿胜率%。 */
  legWinRatePct: number;
  /** 持有期平均最大逆向 |z|。 */
  avgMaxAdverseZ: number;
  /** 协整破裂止损次数。 */
  stopouts: number;
  /** 超时未回归次数。 */
  timeouts: number;
  /** 回放数据截至日（最后交易日）。 */
  asOf: string | null;
}

/** 当前 live 开口快照（复检时附带，无开口为 null）。 */
export interface PairLiveSignal {
  z: number;
  side: "long-spread" | "short-spread";
  deviation: number;
  nearStop: boolean;
  expectedRevertDays: number;
  estNetPct: number;
  /** 单边可执行：相对被低估、对应逢低布局买入的那只。 */
  buyCode: string;
  /** 相对被高估、对应减仓/规避的那只。 */
  deRiskCode: string;
  asOf: string;
}

/** 策略评分（由校准战绩推出，A/B/C/D 评级）。 */
export interface StrategyScore {
  score: number;
  grade: "A" | "B" | "C" | "D";
  stars: number;
}

/** 一条沉淀策略。 */
export interface SavedStrategy {
  id: string;
  /** 展示名（默认「配对均值回归 · A↔B」，可改）。 */
  name: string;
  /** 当前仅 arb-pair（配对均值回归），预留扩展。 */
  kind: "arb-pair";
  /** 来源（如 arb-calibrate）。 */
  source: string;
  note?: string;
  /** 沉淀的协整配对（含 β / adfT / 半衰期，复检时复用 β 重算）。 */
  pair: {
    a: string;
    b: string;
    aName: string;
    bName: string;
    beta: number;
    adfT: number;
    halfLifeDays: number;
    correlation: number;
    n: number;
  };
  /** 交易参数。 */
  params: {
    lookback: number;
    entryZ: number;
    exitZ: number;
    stopZ: number;
    feeBps: number;
    maxHoldDays: number;
  };
  /** 沉淀时的校准战绩快照（不变，作为「沉淀依据」）。 */
  snapshot: PairTrackRecord;
  /** 沉淀时评分。 */
  score: StrategyScore;
  /** 最近一次复检战绩（含当前 live 信号），未复检为 null。 */
  latest: (PairTrackRecord & { live: PairLiveSignal | null; checkedAt: string }) | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedStrategiesStore {
  strategies: SavedStrategy[];
}

function emptyStore(): SavedStrategiesStore {
  return { strategies: [] };
}

/** 读出整份存档（损坏则回退空档）。 */
export async function loadStore(): Promise<SavedStrategiesStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SavedStrategiesStore>;
    return { strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [] };
  } catch {
    return emptyStore();
  }
}

async function saveStore(store: SavedStrategiesStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function genId(): string {
  return `strat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 由校准战绩给配对策略评分（0~100）。诚实口径，按价差均值回归该看的维度加权：
 *  回归率 30% + 单边胜率 25% + 单边净收益 20% + 逆向浅(低 |z|) 15% + 信号密度 10%。
 * 样本不足（signals<3）整体打折，避免少量样本虚高。
 */
export function scorePairStrategy(m: PairTrackRecord): StrategyScore {
  const reversion = clamp(m.reversionRatePct, 0, 100); // 0~100
  const winRate = clamp(m.legWinRatePct, 0, 100); // 0~100
  // 单边净收益：每笔 0% → 50 分，+3% → 100 分，-3% → 0 分（线性夹取）。
  const ret = clamp(50 + (m.avgLegReturnPct / 3) * 50, 0, 100);
  // 逆向浅：avgMaxAdverseZ 越接近 entry 越好；2.0 → 100，4.0 → 0。
  const shallow = clamp(100 - (m.avgMaxAdverseZ - 2) * 50, 0, 100);
  // 信号密度：样本越多越可信，8 笔封顶。
  const density = clamp((m.signals / 8) * 100, 0, 100);

  let score = reversion * 0.3 + winRate * 0.25 + ret * 0.2 + shallow * 0.15 + density * 0.1;
  if (m.signals < 3) score *= 0.7; // 样本过少打折

  const rounded = Number(score.toFixed(1));
  const grade: StrategyScore["grade"] = rounded >= 62 ? "A" : rounded >= 50 ? "B" : rounded >= 38 ? "C" : "D";
  const stars = clamp(Math.round(rounded / 20), 1, 5);
  return { score: rounded, grade, stars };
}

function trackFromCalibration(c: {
  signals: number;
  reversionRatePct: number;
  avgRevertDays: number;
  avgLegReturnPct: number;
  legWinRatePct: number;
  avgMaxAdverseZ: number;
  stopouts: number;
  timeouts: number;
}, asOf: string | null): PairTrackRecord {
  return {
    signals: c.signals,
    reversionRatePct: c.reversionRatePct,
    avgRevertDays: c.avgRevertDays,
    avgLegReturnPct: c.avgLegReturnPct,
    legWinRatePct: c.legWinRatePct,
    avgMaxAdverseZ: c.avgMaxAdverseZ,
    stopouts: c.stopouts,
    timeouts: c.timeouts,
    asOf,
  };
}

function liveFromSignal(s: ArbSignal | null): PairLiveSignal | null {
  if (!s) return null;
  return {
    z: s.z,
    side: s.side,
    deviation: s.deviation,
    nearStop: s.nearStop,
    expectedRevertDays: s.expectedRevertDays,
    estNetPct: s.estNetPct,
    buyCode: s.buyCode,
    deRiskCode: s.deRiskCode,
    asOf: s.asOf,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSavedStrategies(): Promise<SavedStrategy[]> {
  const list = (await loadStore()).strategies;
  // 评级降序，其次更新时间降序
  return [...list].sort((a, b) => b.score.score - a.score.score || b.updatedAt.localeCompare(a.updatedAt));
}

export async function getSavedStrategy(id: string): Promise<SavedStrategy | undefined> {
  return (await loadStore()).strategies.find((s) => s.id === id);
}

/** 沉淀输入：由 /arb 校准结果一行 + 当前参数构造。 */
export interface CreateSavedStrategyInput {
  pair: {
    a: string;
    b: string;
    aName?: string;
    bName?: string;
    beta: number;
    adfT: number;
    halfLifeDays: number;
    correlation: number;
    n: number;
  };
  params: {
    lookback?: number;
    entryZ?: number;
    exitZ?: number;
    stopZ?: number;
    feeBps?: number;
    maxHoldDays?: number;
  };
  /** 沉淀依据：来自校准的战绩快照。 */
  snapshot: PairTrackRecord;
  name?: string;
  note?: string;
  source?: string;
}

export async function createSavedStrategy(input: CreateSavedStrategyInput): Promise<SavedStrategy> {
  const { pair } = input;
  if (!CODE_RE.test(pair.a) || !CODE_RE.test(pair.b)) throw new Error("配对需为两只 6 位 A 股代码");
  const store = await loadStore();
  // 同配对 + 同入场阈视为重复，更新而非新增
  const entryZ = input.params.entryZ ?? 2.0;
  const dup = store.strategies.find(
    (s) => s.pair.a === pair.a && s.pair.b === pair.b && s.params.entryZ === entryZ,
  );
  const now = nowIso();
  const snapshot = input.snapshot;
  const strat: SavedStrategy = {
    id: dup?.id ?? genId(),
    name: input.name?.trim() || dup?.name || `配对均值回归 · ${pair.a}↔${pair.b}`,
    kind: "arb-pair",
    source: input.source ?? "arb-calibrate",
    note: input.note?.trim() || dup?.note,
    pair: {
      a: pair.a,
      b: pair.b,
      aName: pair.aName?.trim() || dup?.pair.aName || pair.a,
      bName: pair.bName?.trim() || dup?.pair.bName || pair.b,
      beta: pair.beta,
      adfT: pair.adfT,
      halfLifeDays: pair.halfLifeDays,
      correlation: pair.correlation,
      n: pair.n,
    },
    params: {
      lookback: input.params.lookback ?? 60,
      entryZ,
      exitZ: input.params.exitZ ?? 0.5,
      stopZ: input.params.stopZ ?? 3.5,
      feeBps: input.params.feeBps ?? 30,
      maxHoldDays: input.params.maxHoldDays ?? 120,
    },
    snapshot,
    score: scorePairStrategy(snapshot),
    latest: dup?.latest ?? null,
    createdAt: dup?.createdAt ?? now,
    updatedAt: now,
  };
  store.strategies = [strat, ...store.strategies.filter((s) => s.id !== strat.id)];
  await saveStore(store);
  return strat;
}

export async function deleteSavedStrategy(id: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.strategies.length;
  store.strategies = store.strategies.filter((s) => s.id !== id);
  if (store.strategies.length === before) return false;
  await saveStore(store);
  return true;
}

/** 导入：粘贴一份导出的策略 JSON（重新分配 id，避免与现有冲突）。 */
export async function importSavedStrategy(raw: unknown): Promise<SavedStrategy> {
  const obj = raw as Partial<SavedStrategy>;
  if (!obj || obj.kind !== "arb-pair" || !obj.pair || !obj.params || !obj.snapshot) {
    throw new Error("导入内容不是合法的沉淀策略 JSON");
  }
  return createSavedStrategy({
    pair: obj.pair,
    params: obj.params,
    snapshot: obj.snapshot,
    name: obj.name,
    note: obj.note,
    source: `import:${obj.source ?? "unknown"}`,
  });
}

/**
 * 复检一条策略：用存档的 β（协整关系）在最新 K 上重算校准战绩 + 当前 live 信号，
 * 刷新 latest（活战绩）。需要调用方传入两腿最新 K 线。
 */
export async function revalidateSavedStrategy(
  id: string,
  aCandles: Candle[],
  bCandles: Candle[],
): Promise<SavedStrategy> {
  const store = await loadStore();
  const idx = store.strategies.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error("策略不存在");
  const strat = store.strategies[idx];

  const pc: PairCandidate = {
    a: strat.pair.a,
    b: strat.pair.b,
    beta: strat.pair.beta,
    adfT: strat.pair.adfT,
    cointegrated: true,
    correlation: strat.pair.correlation,
    halfLifeDays: strat.pair.halfLifeDays,
    n: strat.pair.n,
  };
  const opts = {
    lookback: strat.params.lookback,
    entryZ: strat.params.entryZ,
    exitZ: strat.params.exitZ,
    stopZ: strat.params.stopZ,
    feeBps: strat.params.feeBps,
    maxHoldDays: strat.params.maxHoldDays,
  };
  const cal = calibratePair(pc, aCandles, bCandles, opts);
  const sig = currentArbSignal(pc, aCandles, bCandles, opts);
  const asOf = cal.events.length > 0 ? cal.events[cal.events.length - 1].exitDate : sig?.asOf ?? null;
  const track = trackFromCalibration(cal, asOf);

  const updated: SavedStrategy = {
    ...strat,
    latest: { ...track, live: liveFromSignal(sig), checkedAt: nowIso() },
    updatedAt: nowIso(),
  };
  store.strategies[idx] = updated;
  await saveStore(store);
  return updated;
}
