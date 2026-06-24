import { promises as fs } from "fs";
import path from "path";
import { buyShares, sellProceeds } from "@/lib/costs";

/**
 * v0.36 配对纸面交易 / 持仓跟踪 持久化层。
 *
 * 复用项目既有「.data/ JSON 落盘」机制（同 watchlist.ts / alerts.ts / savedStrategies.ts），零新依赖：
 * 把 /strategies 沉淀策略（或 /arb 配对）当前的开口信号，一键建成「纸面仓」前向跟踪——
 * 记录开仓快照（买入腿 / 价格 / z / 名义本金），持仓中按最新 K + 实时价盯市算实时盈亏与当前 z，
 * 命中回归(exitZ)/止损(stopZ)/超时(maxHoldDays) 自动平仓，沉淀开平流水与「回归达成率」。
 *
 * 与 v0.34 沉淀策略（事后校准统计）互补：那是「历史能不能信」，这是「现在跟一笔看回归兑现没」。
 * P&L 走 costs.ts 既有 A 股成本模型（buyShares/sellProceeds，含佣金/印花税/过户费/滑点），非投资建议。
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "paper-trades.json");

const CODE_RE = /^\d{6}$/;

/** 默认名义本金（元）。 */
export const DEFAULT_NOTIONAL = 10000;

/** 平仓原因。 */
export type CloseReason = "reverted" | "stopped" | "timeout" | "manual";

/** 一次盯市快照（持仓中持续刷新，平仓后定格为最终值）。 */
export interface PaperMark {
  /** 盯市数据截至日（最后交易日，可能含当日实时价）。 */
  asOf: string;
  /** 买入腿当前价（含实时拼接）。 */
  price: number;
  /** 当前价差 z（带符号，同校准口径）。 */
  z: number;
  /** 相对开仓的毛收益%。 */
  grossPct: number;
  /** 扣 A 股往返成本后的净收益%。 */
  netPct: number;
  /** 净盈亏绝对额（元）。 */
  pnl: number;
  /** 已持有交易日数。 */
  holdDays: number;
  /** 是否已回归（|z|≤exitZ，=信号兑现）。 */
  reverted: boolean;
  /** 是否逼近/越过止损（|z|≥stopZ）。 */
  stopped: boolean;
  /** 是否超时（holdDays≥maxHoldDays）。 */
  timedOut: boolean;
  checkedAt: string;
}

/** 一条纸面持仓。 */
export interface PaperPosition {
  id: string;
  /** 来源沉淀策略 id（手动从 /arb 建仓可空）。 */
  strategyId?: string;
  source: string;
  name: string;
  note?: string;
  /** 协整配对（含 β，盯市时复用 β 重算 z）。 */
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
  params: {
    lookback: number;
    entryZ: number;
    exitZ: number;
    stopZ: number;
    feeBps: number;
    maxHoldDays: number;
  };
  /** 开口方向：long-spread=价差偏低买 A，short-spread=价差偏高买 B。 */
  side: "long-spread" | "short-spread";
  /** 实际买入（被低估）那一只。 */
  buyCode: string;
  buyName: string;
  /** 相对被高估、规避的那一只。 */
  deRiskCode: string;
  /** 开仓数据截至日（信号最后交易日）。 */
  entryDate: string;
  /** 开仓时买入腿价格。 */
  entryPrice: number;
  /** 开仓时 z（带符号）。 */
  entryZ: number;
  /** 名义本金（元）。 */
  notional: number;
  /** 纸面持股数（buyShares 按成本模型折算，浮点）。 */
  shares: number;
  /** 持有期内出现过的最大 |z|（逆向最深）。 */
  maxAdverseZ: number;
  status: "open" | "closed";
  /** 最近一次盯市快照（未盯市为 null）。 */
  mark: PaperMark | null;
  /** 平仓信息（未平仓为 null）。 */
  close: {
    reason: CloseReason;
    mark: PaperMark;
    closedAt: string;
  } | null;
  openedAt: string;
  updatedAt: string;
}

interface PaperStore {
  positions: PaperPosition[];
}

function emptyStore(): PaperStore {
  return { positions: [] };
}

export async function loadStore(): Promise<PaperStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PaperStore>;
    return { positions: Array.isArray(parsed.positions) ? parsed.positions : [] };
  } catch {
    return emptyStore();
  }
}

async function saveStore(store: PaperStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function genId(): string {
  return `paper_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

// ── 盯市 / 盈亏（纯计算） ──────────────────────────────────────────────────

/** 已持有交易日数：对齐交易日序列中处于 (entryDate, asOf] 的根数。 */
export function holdDaysBetween(dates: string[], entryDate: string, asOf: string): number {
  let c = 0;
  for (const d of dates) if (d > entryDate && d <= asOf) c++;
  return c;
}

/**
 * 由「买入腿当前价 + 当前 z + 持仓天数」盯市，算实时盈亏与回归/止损/超时判定。
 * 成本走 costs.ts：sellProceeds(shares, price) 已扣卖出佣金/印花税/过户费/滑点，
 * 与开仓 buyShares 的买入成本对称，pnl = 卖出净得 − 名义本金。
 */
export function computeMark(
  pos: PaperPosition,
  price: number,
  z: number,
  asOf: string,
  holdDays: number,
): PaperMark {
  const proceeds = sellProceeds(pos.shares, price);
  const pnl = proceeds - pos.notional;
  const netPct = pos.notional > 0 ? (pnl / pos.notional) * 100 : 0;
  const grossPct = pos.entryPrice > 0 ? (price / pos.entryPrice - 1) * 100 : 0;
  const az = Math.abs(z);
  return {
    asOf,
    price: Number(price.toFixed(3)),
    z: Number(z.toFixed(2)),
    grossPct: Number(grossPct.toFixed(2)),
    netPct: Number(netPct.toFixed(2)),
    pnl: Number(pnl.toFixed(2)),
    holdDays,
    reverted: az <= pos.params.exitZ,
    stopped: az >= pos.params.stopZ,
    timedOut: holdDays >= pos.params.maxHoldDays,
    checkedAt: nowIso(),
  };
}

/** 由盯市快照判断应否自动平仓，返回原因（不平则 null）。优先级：止损 > 回归 > 超时。 */
export function autoCloseReason(mark: PaperMark): CloseReason | null {
  if (mark.stopped) return "stopped";
  if (mark.reverted) return "reverted";
  if (mark.timedOut) return "timeout";
  return null;
}

// ── 汇总 ────────────────────────────────────────────────────────────────────

export interface PaperSummary {
  openCount: number;
  closedCount: number;
  /** 已平仓中由「价差回归」兑现的占比%（回归达成率）。 */
  reversionRatePct: number;
  /** 已平仓胜率%（净收益>0）。 */
  winRatePct: number;
  /** 已平仓平均持有交易日。 */
  avgHoldDays: number;
  /** 已平仓累计净盈亏（元）。 */
  realizedPnl: number;
  /** 持仓中未实现净盈亏（元）。 */
  unrealizedPnl: number;
}

export function summarize(positions: PaperPosition[]): PaperSummary {
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed" && p.close);
  const reverts = closed.filter((p) => p.close!.reason === "reverted").length;
  const wins = closed.filter((p) => p.close!.mark.netPct > 0).length;
  const holdSum = closed.reduce((s, p) => s + p.close!.mark.holdDays, 0);
  const realized = closed.reduce((s, p) => s + p.close!.mark.pnl, 0);
  const unrealized = open.reduce((s, p) => s + (p.mark?.pnl ?? 0), 0);
  return {
    openCount: open.length,
    closedCount: closed.length,
    reversionRatePct: closed.length ? Number(((reverts / closed.length) * 100).toFixed(1)) : 0,
    winRatePct: closed.length ? Number(((wins / closed.length) * 100).toFixed(1)) : 0,
    avgHoldDays: closed.length ? Number((holdSum / closed.length).toFixed(1)) : 0,
    realizedPnl: Number(realized.toFixed(2)),
    unrealizedPnl: Number(unrealized.toFixed(2)),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listPaperPositions(): Promise<PaperPosition[]> {
  const list = (await loadStore()).positions;
  // 持仓中在前，其次按更新时间降序
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export interface OpenPaperInput {
  strategyId?: string;
  source?: string;
  name?: string;
  note?: string;
  pair: PaperPosition["pair"];
  params: PaperPosition["params"];
  side: "long-spread" | "short-spread";
  buyCode: string;
  buyName: string;
  deRiskCode: string;
  entryDate: string;
  entryPrice: number;
  entryZ: number;
  notional?: number;
}

export async function openPaperPosition(input: OpenPaperInput): Promise<PaperPosition> {
  const { pair } = input;
  if (!CODE_RE.test(pair.a) || !CODE_RE.test(pair.b)) throw new Error("配对需为两只 6 位 A 股代码");
  if (!(input.entryPrice > 0)) throw new Error("开仓价格无效");
  const store = await loadStore();
  // 同配对 + 同方向已有持仓中纸面仓则视为重复，避免重复建仓
  const dup = store.positions.find(
    (p) => p.status === "open" && p.pair.a === pair.a && p.pair.b === pair.b && p.side === input.side,
  );
  if (dup) throw new Error(`该配对（${pair.a}↔${pair.b}）同方向已有持仓中纸面仓，请先平仓`);

  const notional = input.notional && input.notional > 0 ? input.notional : DEFAULT_NOTIONAL;
  const shares = buyShares(notional, input.entryPrice);
  if (!(shares > 0)) throw new Error("名义本金不足以买入 1 股");
  const now = nowIso();
  const pos: PaperPosition = {
    id: genId(),
    strategyId: input.strategyId,
    source: input.source ?? "manual",
    name: input.name?.trim() || `纸面仓 · 买 ${input.buyCode}`,
    note: input.note?.trim() || undefined,
    pair,
    params: input.params,
    side: input.side,
    buyCode: input.buyCode,
    buyName: input.buyName,
    deRiskCode: input.deRiskCode,
    entryDate: input.entryDate,
    entryPrice: Number(input.entryPrice.toFixed(3)),
    entryZ: Number(input.entryZ.toFixed(2)),
    notional,
    shares,
    maxAdverseZ: Math.abs(input.entryZ),
    status: "open",
    mark: null,
    close: null,
    openedAt: now,
    updatedAt: now,
  };
  store.positions = [pos, ...store.positions];
  await saveStore(store);
  return pos;
}

/** 写回一条持仓的盯市结果；若给定 closeReason 则同时平仓。 */
export async function applyMark(
  id: string,
  mark: PaperMark,
  closeReason: CloseReason | null,
): Promise<PaperPosition | undefined> {
  const store = await loadStore();
  const idx = store.positions.findIndex((p) => p.id === id);
  if (idx < 0) return undefined;
  const pos = store.positions[idx];
  if (pos.status !== "open") return pos;
  const maxAdverseZ = Math.max(pos.maxAdverseZ, Math.abs(mark.z));
  const now = nowIso();
  const updated: PaperPosition = {
    ...pos,
    maxAdverseZ: Number(maxAdverseZ.toFixed(2)),
    mark,
    updatedAt: now,
    ...(closeReason ? { status: "closed" as const, close: { reason: closeReason, mark, closedAt: now } } : {}),
  };
  store.positions[idx] = updated;
  await saveStore(store);
  return updated;
}

export async function deletePaperPosition(id: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.positions.length;
  store.positions = store.positions.filter((p) => p.id !== id);
  if (store.positions.length === before) return false;
  await saveStore(store);
  return true;
}

/** 清空全部已平仓记录（保留持仓中）。 */
export async function clearClosedPositions(): Promise<number> {
  const store = await loadStore();
  const before = store.positions.length;
  store.positions = store.positions.filter((p) => p.status === "open");
  const removed = before - store.positions.length;
  if (removed > 0) await saveStore(store);
  return removed;
}
