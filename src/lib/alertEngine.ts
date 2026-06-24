/**
 * v0.33 盘中盯盘告警 评估引擎。
 *
 * 把既有「套利雷达」与实时行情升级为盘中盯盘：
 *  - 拉日 K（窗口足够算滚动 z）+ 实时行情，把当前价拼成「最后一根」→ 算盘中 live z；
 *  - 套利型规则用 scanArbRadar 找当前开口/逼近止损的协整配对；价格型规则比当前价与阈值；
 *  - 命中后做冷却去重（同去重键在 cooldownMin 内只报一次），投递站内 + webhook，落盘进告警箱。
 *
 * 无服务端常驻定时器（与本项目 serverless 口径一致）：由 /alerts 页客户端定时轮询 /api/alerts/check
 * 驱动评估。交易时段判断仅用于前端提示与避免无谓轮询，评估本身允许任意时刻手动触发。
 */
import { getKlinesBatch, getQuotesFailover } from "./sources";
import { scanArbRadar } from "./pairTrading";
import { listPools } from "./watchlist";
import { getUniverseConfig, isExcluded } from "./universe";
import {
  listRules,
  loadStore,
  appendEvents,
  type AlertRule,
  type AlertChannel,
  type AlertEvent,
  type NewEvent,
} from "./alerts";
import type { Candle } from "./types";

export interface CheckResult {
  checkedRules: number;
  enabledRules: number;
  newEvents: AlertEvent[];
  errors: { ruleId: string; ruleName: string; error: string }[];
  inTradingSession: boolean;
  checkedAt: string;
}

/** 上海钟（UTC+8）的当前时间分量。 */
function shanghaiParts(now = Date.now()): { y: number; m: number; d: number; dow: number; minutes: number; date: string } {
  const t = new Date(now + 8 * 3600 * 1000);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const dow = t.getUTCDay(); // 0=周日
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { y, m, d, dow, minutes, date };
}

/** A 股交易时段：周一~周五 09:30–11:30 / 13:00–15:00（不含节假日判断）。 */
export function inAShareTradingSession(now = Date.now()): boolean {
  const { dow, minutes } = shanghaiParts(now);
  if (dow === 0 || dow === 6) return false;
  const am = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const pm = minutes >= 13 * 60 && minutes <= 15 * 60;
  return am || pm;
}

/** 把实时价拼为最后一根：同日则覆盖收盘，否则追加一根合成日 K（OHLC 均取现价）。 */
function spliceLivePrice(candles: Candle[], price: number, today: string): Candle[] {
  if (!(price > 0) || candles.length === 0) return candles;
  const sorted = [...candles].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  if (last.date === today) {
    sorted[sorted.length - 1] = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    return sorted;
  }
  if (today > last.date) {
    sorted.push({ date: today, open: price, high: price, low: price, close: price, volume: 0, amount: 0, changePct: 0, turnoverPct: 0 });
  }
  return sorted;
}

/** 解析规则关联的代码集（引用股票池或内联），并按主板纯净化口径过滤。 */
async function resolveCodes(rule: AlertRule): Promise<string[]> {
  let raw: string[] = [];
  if (rule.poolId) {
    const pools = await listPools();
    raw = pools.find((p) => p.id === rule.poolId)?.codes ?? [];
  } else {
    raw = rule.codes ?? [];
  }
  const cfg = getUniverseConfig();
  return Array.from(new Set(raw.filter((c) => /^\d{6}$/.test(c) && !isExcluded(c, undefined, cfg))));
}

/** 投递一条告警到各渠道，返回成功投递的渠道列表。站内恒成功；webhook 失败则不计入。 */
async function dispatch(rule: AlertRule, payload: Record<string, unknown>): Promise<AlertChannel[]> {
  const sent: AlertChannel[] = [];
  for (const ch of rule.channels) {
    if (ch === "inapp") {
      sent.push("inapp");
    } else if (ch === "webhook" && rule.webhookUrl) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(rule.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) sent.push("webhook");
      } catch {
        /* webhook 投递失败：站内仍可见，不阻断 */
      }
    }
  }
  return sent;
}

/** 评估单条套利型规则，产出候选告警（未做冷却去重）。 */
async function evalArbRule(rule: AlertRule): Promise<Omit<NewEvent, "channelsSent">[]> {
  const codes = await resolveCodes(rule);
  if (codes.length < 3) return [];
  const km = await getKlinesBatch(codes, 500, "baidu-first");
  const quotes = await getQuotesFailover(codes);
  const today = shanghaiParts().date;
  const candles: Record<string, Candle[]> = {};
  for (const code of codes) {
    let cs = (km.get(code)?.candles ?? []).filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);
    if (cs.length < 250) continue;
    const px = quotes[code]?.price;
    if (px && px > 0) cs = spliceLivePrice(cs, px, today);
    candles[code] = cs;
  }
  if (Object.keys(candles).length < 3) return [];

  const result = scanArbRadar(candles, {
    find: { minCorrelation: rule.minCorrelation ?? 0.7, minHalfLife: 2, maxHalfLife: 60 },
    trade: { entryZ: rule.entryZ ?? 2.0, exitZ: rule.exitZ ?? 0.5, stopZ: rule.stopZ ?? 3.5, feeBps: 30 },
    maxSignals: 50,
  });
  const triggers = rule.arbTriggers ?? ["open", "nearStop"];
  const out: Omit<NewEvent, "channelsSent">[] = [];
  for (const sig of result.signals) {
    const { a, b } = sig.pair;
    const sideTxt = `买 ${sig.buyCode} / 规避 ${sig.deRiskCode}`;
    if (triggers.includes("nearStop") && sig.nearStop) {
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        kind: "arb",
        level: "warn",
        title: `配对 ${a}-${b} 逼近/越过止损（|z|=${sig.deviation}）`,
        message: `价差 z=${sig.z}，已达止损阈 ${sig.stopZ}，协整可能破裂，注意风险。${sideTxt}。`,
        dedupeKey: `${rule.id}:arb:${a}-${b}:nearStop`,
        detail: { a, b, z: sig.z, deviation: sig.deviation, side: sig.side, buyCode: sig.buyCode, deRiskCode: sig.deRiskCode, codes: [a, b] },
      });
    } else if (triggers.includes("open")) {
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        kind: "arb",
        level: "info",
        title: `配对 ${a}-${b} 价差开口（|z|=${sig.deviation}）`,
        message: `价差 z=${sig.z}（入场阈 ${sig.entryZ}），预计 ${sig.expectedRevertDays} 日回归，估算净收益 ${sig.estNetPct}%。${sideTxt}。`,
        dedupeKey: `${rule.id}:arb:${a}-${b}:${sig.side}:open`,
        detail: { a, b, z: sig.z, deviation: sig.deviation, side: sig.side, buyCode: sig.buyCode, deRiskCode: sig.deRiskCode, estNetPct: sig.estNetPct, expectedRevertDays: sig.expectedRevertDays, codes: [a, b] },
      });
    }
  }
  return out;
}

/** 评估单条价格型规则。 */
async function evalPriceRule(rule: AlertRule): Promise<Omit<NewEvent, "channelsSent">[]> {
  const code = rule.code;
  const op = rule.op ?? ">=";
  const threshold = rule.price;
  if (!code || threshold == null) return [];
  const quotes = await getQuotesFailover([code]);
  const q = quotes[code];
  const px = q?.price;
  if (!px || px <= 0) return [];
  const hit = op === ">=" ? px >= threshold : px <= threshold;
  if (!hit) return [];
  const name = q?.name || code;
  return [
    {
      ruleId: rule.id,
      ruleName: rule.name,
      kind: "price",
      level: "info",
      title: `${name} ${code} 现价 ${px} ${op === ">=" ? "≥" : "≤"} ${threshold}`,
      message: `${name}（${code}）现价 ${px} 元，已${op === ">=" ? "上穿" : "下破"}阈值 ${threshold} 元（涨跌 ${q?.changePct ?? "-"}%）。`,
      dedupeKey: `${rule.id}:price:${op}${threshold}`,
      detail: { code, name, price: px, op, threshold, changePct: q?.changePct ?? 0 },
    },
  ];
}

/** 冷却去重：同去重键在最近 cooldownMin 内已有事件则跳过。 */
function passCooldown(dedupeKey: string, cooldownMin: number, existing: AlertEvent[], now: number): boolean {
  const cutoff = now - cooldownMin * 60 * 1000;
  for (const e of existing) {
    if (e.dedupeKey === dedupeKey && new Date(e.triggeredAt).getTime() >= cutoff) return false;
  }
  return true;
}

/**
 * 评估全部启用规则，做冷却去重 + 投递 + 落盘，返回本次新增告警与错误。
 */
export async function checkAlerts(): Promise<CheckResult> {
  const rules = await listRules();
  const enabled = rules.filter((r) => r.enabled);
  const store = await loadStore();
  const existing = store.events;
  const now = Date.now();
  const errors: CheckResult["errors"] = [];
  const toAppend: NewEvent[] = [];
  const firedKeys = new Set<string>();

  for (const rule of enabled) {
    try {
      const candidates = rule.kind === "price" ? await evalPriceRule(rule) : await evalArbRule(rule);
      for (const c of candidates) {
        if (firedKeys.has(c.dedupeKey)) continue;
        if (!passCooldown(c.dedupeKey, rule.cooldownMin, existing, now)) continue;
        firedKeys.add(c.dedupeKey);
        const channelsSent = await dispatch(rule, {
          type: "serenity-alert",
          ruleName: c.ruleName,
          kind: c.kind,
          level: c.level,
          title: c.title,
          message: c.message,
          detail: c.detail,
          triggeredAt: new Date(now).toISOString(),
        });
        toAppend.push({ ...c, channelsSent });
      }
    } catch (e) {
      errors.push({ ruleId: rule.id, ruleName: rule.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const newEvents = await appendEvents(toAppend);
  return {
    checkedRules: enabled.length,
    enabledRules: enabled.length,
    newEvents,
    errors,
    inTradingSession: inAShareTradingSession(now),
    checkedAt: new Date(now).toISOString(),
  };
}
