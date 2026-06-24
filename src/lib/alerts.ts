import { promises as fs } from "fs";
import path from "path";

/**
 * v0.33 盘中盯盘告警 持久化层。
 *
 * 复用项目既有「.data/ JSON 落盘」机制（同 watchlist.ts / calibration.ts），零新依赖：
 *  - 告警规则（rules）：用户自定义的盯盘条件，两类——
 *      · 套利型（arb）：盯一个股票池/代码集，价差开口（|z|≥entryZ）或逼近止损（|z|≥stopZ）时告警；
 *      · 价格型（price）：单只个股价格上穿 / 下破阈值时告警。
 *  - 告警箱（events）：评估引擎触发的站内告警记录（含已读标记），可清空。
 *
 * 投递渠道：站内（落盘进告警箱）+ webhook（POST JSON）。邮件可经 webhook 桥接。
 * 写操作走「读出整份 → 改 → 整份写回」，文件小、并发低，简单可靠。
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "alerts.json");

/** 告警类型。 */
export type AlertKind = "arb" | "price";

/** 投递渠道。 */
export type AlertChannel = "inapp" | "webhook";

/** 套利型告警触发条件。 */
export type ArbTrigger = "open" | "nearStop";

/** 价格型比较算子。 */
export type PriceOp = ">=" | "<=";

/** 一条告警规则。 */
export interface AlertRule {
  id: string;
  name: string;
  kind: AlertKind;
  enabled: boolean;

  // ── 套利型（kind="arb"）──
  /** 引用已存股票池 id（与 codes 二选一，poolId 优先）。 */
  poolId?: string;
  /** 内联代码集（poolId 缺失时用）。 */
  codes?: string[];
  minCorrelation?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  /** 命中哪些条件才告警：开口 / 逼近止损。 */
  arbTriggers?: ArbTrigger[];

  // ── 价格型（kind="price")──
  /** 单只个股 6 位代码。 */
  code?: string;
  op?: PriceOp;
  /** 价格阈值（元）。 */
  price?: number;

  // ── 投递 ──
  channels: AlertChannel[];
  webhookUrl?: string;
  /** 冷却分钟数：同一去重键在此窗口内只告警一次（默认 60）。 */
  cooldownMin: number;

  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
}

/** 告警等级。 */
export type AlertLevel = "info" | "warn";

/** 一条触发的告警记录（告警箱条目）。 */
export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  message: string;
  /** 去重键：同键在冷却期内只产生一条。 */
  dedupeKey: string;
  /** 结构化细节（z / side / 价格 / 涉及代码等），供前端深链与展示。 */
  detail: Record<string, string | number | boolean | string[]>;
  triggeredAt: string;
  read: boolean;
  /** 实际投递成功的渠道。 */
  channelsSent: AlertChannel[];
}

interface AlertStore {
  rules: AlertRule[];
  events: AlertEvent[];
}

/** 告警箱最多保留的历史条数（防无限增长）。 */
const MAX_EVENTS = 500;

function emptyStore(): AlertStore {
  return { rules: [], events: [] };
}

/** 读出整份存档（缺字段补默认，损坏则回退空档）。 */
export async function loadStore(): Promise<AlertStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AlertStore>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return emptyStore();
  }
}

async function saveStore(store: AlertStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (store.events.length > MAX_EVENTS) store.events = store.events.slice(0, MAX_EVENTS);
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

const CODE_RE = /^\d{6}$/;

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

function normalizeCodes(input: string[] | string | undefined): string[] {
  const arr = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,，、]+/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const c = String(raw).trim();
    if (CODE_RE.test(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

const ALERT_CHANNELS: AlertChannel[] = ["inapp", "webhook"];

function sanitizeChannels(input: unknown): AlertChannel[] {
  const arr = Array.isArray(input) ? input : [];
  const out = arr.filter((c): c is AlertChannel => ALERT_CHANNELS.includes(c as AlertChannel));
  // 站内为默认兜底渠道，至少保留站内，确保告警可见。
  return out.includes("inapp") ? out : ["inapp", ...out];
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── 规则增删改查 ─────────────────────────────────────────────────────────────

export async function listRules(): Promise<AlertRule[]> {
  return (await loadStore()).rules;
}

export interface RuleInput {
  id?: string;
  name?: string;
  kind: AlertKind;
  enabled?: boolean;
  poolId?: string;
  codes?: string[] | string;
  minCorrelation?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  arbTriggers?: ArbTrigger[];
  code?: string;
  op?: PriceOp;
  price?: number;
  channels?: AlertChannel[];
  webhookUrl?: string;
  cooldownMin?: number;
}

/** 校验并整理一条规则的业务字段（建/改共用）。 */
function buildRuleFields(input: RuleInput): Omit<AlertRule, "id" | "createdAt" | "updatedAt" | "lastTriggeredAt"> {
  const kind: AlertKind = input.kind === "price" ? "price" : "arb";
  const channels = sanitizeChannels(input.channels);
  const webhookUrl = input.webhookUrl?.trim() || undefined;
  if (channels.includes("webhook") && !webhookUrl) {
    throw new Error("启用 webhook 渠道时必须提供 webhook URL");
  }
  const base = {
    name: input.name?.trim() || (kind === "arb" ? "套利盯盘" : "价格盯盘"),
    kind,
    enabled: input.enabled !== false,
    channels,
    webhookUrl,
    cooldownMin: Math.max(1, Math.round(num(input.cooldownMin, 60))),
  };

  if (kind === "price") {
    const code = (input.code ?? "").trim();
    if (!CODE_RE.test(code)) throw new Error("价格型告警需提供 6 位股票代码");
    const op: PriceOp = input.op === "<=" ? "<=" : ">=";
    const price = num(input.price, NaN);
    if (!Number.isFinite(price) || price <= 0) throw new Error("价格型告警需提供正的价格阈值");
    return { ...base, code, op, price };
  }

  // arb
  const codes = normalizeCodes(input.codes);
  if (!input.poolId && codes.length < 3) {
    throw new Error("套利型告警需引用一个股票池，或内联至少 3 个 6 位代码");
  }
  const triggers = (input.arbTriggers ?? []).filter(
    (t): t is ArbTrigger => t === "open" || t === "nearStop",
  );
  return {
    ...base,
    poolId: input.poolId?.trim() || undefined,
    codes: input.poolId ? undefined : codes,
    minCorrelation: num(input.minCorrelation, 0.7),
    entryZ: num(input.entryZ, 2.0),
    exitZ: num(input.exitZ, 0.5),
    stopZ: num(input.stopZ, 3.5),
    arbTriggers: triggers.length ? triggers : ["open", "nearStop"],
  };
}

/** 创建（无 id）或更新（带 id）一条规则。 */
export async function upsertRule(input: RuleInput): Promise<AlertRule> {
  const fields = buildRuleFields(input);
  const store = await loadStore();
  if (input.id) {
    const existing = store.rules.find((r) => r.id === input.id);
    if (!existing) throw new Error("规则不存在");
    const updated: AlertRule = {
      ...existing,
      ...fields,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
      lastTriggeredAt: existing.lastTriggeredAt,
    };
    store.rules = store.rules.map((r) => (r.id === input.id ? updated : r));
    await saveStore(store);
    return updated;
  }
  const ts = nowIso();
  const rule: AlertRule = { ...fields, id: genId("rule"), createdAt: ts, updatedAt: ts };
  store.rules = [rule, ...store.rules];
  await saveStore(store);
  return rule;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<AlertRule | null> {
  const store = await loadStore();
  const rule = store.rules.find((r) => r.id === id);
  if (!rule) return null;
  rule.enabled = enabled;
  rule.updatedAt = nowIso();
  await saveStore(store);
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  const store = await loadStore();
  store.rules = store.rules.filter((r) => r.id !== id);
  await saveStore(store);
}

// ── 告警箱 ───────────────────────────────────────────────────────────────────

export async function listEvents(unreadOnly = false): Promise<AlertEvent[]> {
  const events = (await loadStore()).events;
  return unreadOnly ? events.filter((e) => !e.read) : events;
}

export async function markEventRead(id: string): Promise<void> {
  const store = await loadStore();
  const ev = store.events.find((e) => e.id === id);
  if (ev) ev.read = true;
  await saveStore(store);
}

export async function markAllRead(): Promise<void> {
  const store = await loadStore();
  for (const e of store.events) e.read = true;
  await saveStore(store);
}

export async function clearEvents(): Promise<void> {
  const store = await loadStore();
  store.events = [];
  await saveStore(store);
}

/** 评估引擎新触发的告警载荷（落盘前）。 */
export interface NewEvent {
  ruleId: string;
  ruleName: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  message: string;
  dedupeKey: string;
  detail: Record<string, string | number | boolean | string[]>;
  channelsSent: AlertChannel[];
}

/**
 * 追加一批新告警并更新对应规则的 lastTriggeredAt。返回落盘后的完整事件（含 id）。
 * 评估引擎已在内存里做过冷却去重，这里直接落盘。
 */
export async function appendEvents(news: NewEvent[]): Promise<AlertEvent[]> {
  if (news.length === 0) return [];
  const store = await loadStore();
  const ts = nowIso();
  const created: AlertEvent[] = news.map((n) => ({
    ...n,
    id: genId("evt"),
    triggeredAt: ts,
    read: false,
  }));
  store.events = [...created, ...store.events];
  const firedRuleIds = new Set(news.map((n) => n.ruleId));
  for (const r of store.rules) if (firedRuleIds.has(r.id)) r.lastTriggeredAt = ts;
  await saveStore(store);
  return created;
}
