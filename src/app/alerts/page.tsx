"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NFA } from "@/lib/disclaimers";

// ── 类型（与 /api/alerts/* 对齐）──────────────────────────────────────────────
type AlertKind = "arb" | "price";
type AlertChannel = "inapp" | "webhook";
type ArbTrigger = "open" | "nearStop";
type PriceOp = ">=" | "<=";

interface AlertRule {
  id: string;
  name: string;
  kind: AlertKind;
  enabled: boolean;
  poolId?: string;
  codes?: string[];
  minCorrelation?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  arbTriggers?: ArbTrigger[];
  code?: string;
  op?: PriceOp;
  price?: number;
  channels: AlertChannel[];
  webhookUrl?: string;
  cooldownMin: number;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
}

interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: AlertKind;
  level: "info" | "warn";
  title: string;
  message: string;
  detail: Record<string, string | number | boolean | string[]>;
  triggeredAt: string;
  read: boolean;
  channelsSent: AlertChannel[];
}

interface StockPool {
  id: string;
  name: string;
  codes: string[];
}

interface CheckResult {
  checkedRules: number;
  newEvents: AlertEvent[];
  errors: { ruleId: string; ruleName: string; error: string }[];
  inTradingSession: boolean;
  checkedAt: string;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

const POLL_MS = 60_000;

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [pools, setPools] = useState<StockPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoPoll, setAutoPoll] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<CheckResult | null>(null);
  const [inSession, setInSession] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshRules = useCallback(async () => {
    const j = await fetch("/api/alerts/rules").then((r) => r.json());
    setRules(j.rules ?? []);
  }, []);
  const refreshEvents = useCallback(async () => {
    const j = await fetch("/api/alerts/events").then((r) => r.json());
    setEvents(j.events ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [r, e, p, s] = await Promise.all([
          fetch("/api/alerts/rules").then((x) => x.json()),
          fetch("/api/alerts/events").then((x) => x.json()),
          fetch("/api/watchlist/pools").then((x) => x.json()),
          fetch("/api/alerts/check").then((x) => x.json()),
        ]);
        setRules(r.rules ?? []);
        setEvents(e.events ?? []);
        setPools(p.pools ?? []);
        setInSession(Boolean(s.inTradingSession));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/alerts/check", { method: "POST" });
      const j = (await res.json()) as CheckResult & { error?: string };
      if (res.ok) {
        setLastCheck(j);
        setInSession(Boolean(j.inTradingSession));
        await refreshEvents();
      }
    } finally {
      setChecking(false);
    }
  }, [refreshEvents]);

  // 自动轮询：开启后每 60s 触发一次评估。
  useEffect(() => {
    if (!autoPoll) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    runCheck();
    timerRef.current = setInterval(runCheck, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoPoll, runCheck]);

  const unread = events.filter((e) => !e.read).length;

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">盘中盯盘告警</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          为<strong>套利配对</strong>（价差开口 / 逼近回归止损）与<strong>个股价格</strong>设盯盘规则，盘中轮询实时行情触发告警。
          投递站内告警箱 + 可选 <code>webhook</code>（邮件可经 webhook 桥接）。全部落 <code>.data/</code> 本地持久化。{NFA}
        </p>
      </div>

      {/* 轮询控制条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${inSession ? "bg-emerald-500/15 text-emerald-500" : "bg-[var(--hover)] text-[var(--muted)]"}`}>
          <span className={`h-2 w-2 rounded-full ${inSession ? "bg-emerald-500" : "bg-[var(--faint)]"}`} />
          {inSession ? "交易时段" : "非交易时段"}
        </span>
        <button
          onClick={runCheck}
          disabled={checking}
          className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          {checking ? "检查中…" : "立即检查"}
        </button>
        <label className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={autoPoll} onChange={(e) => setAutoPoll(e.target.checked)} />
          自动轮询（每 60 秒，仅本页打开时生效）
        </label>
        {lastCheck && (
          <span className="text-xs text-[var(--faint)]">
            上次检查 {fmtDate(lastCheck.checkedAt)} · 评估 {lastCheck.checkedRules} 条规则 · 新增 {lastCheck.newEvents.length} 告警
            {lastCheck.errors.length > 0 && <span className="text-amber-500"> · {lastCheck.errors.length} 条出错</span>}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted)]">载入中…</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <RulesSection rules={rules} pools={pools} onChange={setRules} refreshRules={refreshRules} />
          <InboxSection events={events} unread={unread} onChange={setEvents} />
        </div>
      )}
    </div>
  );
}

// ── 规则管理 ──────────────────────────────────────────────────────────────────
const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm";

function RulesSection({
  rules,
  pools,
  onChange,
  refreshRules,
}: {
  rules: AlertRule[];
  pools: StockPool[];
  onChange: (next: AlertRule[]) => void;
  refreshRules: () => Promise<void>;
}) {
  const [kind, setKind] = useState<AlertKind>("arb");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 套利型
  const [poolId, setPoolId] = useState("");
  const [codesText, setCodesText] = useState("");
  const [entryZ, setEntryZ] = useState("2.0");
  const [stopZ, setStopZ] = useState("3.5");
  const [trigOpen, setTrigOpen] = useState(true);
  const [trigStop, setTrigStop] = useState(true);

  // 价格型
  const [code, setCode] = useState("");
  const [op, setOp] = useState<PriceOp>(">=");
  const [price, setPrice] = useState("");

  // 投递
  const [webhookOn, setWebhookOn] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [cooldownMin, setCooldownMin] = useState("60");

  function resetForm() {
    setName("");
    setPoolId("");
    setCodesText("");
    setEntryZ("2.0");
    setStopZ("3.5");
    setTrigOpen(true);
    setTrigStop(true);
    setCode("");
    setOp(">=");
    setPrice("");
    setWebhookOn(false);
    setWebhookUrl("");
    setCooldownMin("60");
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const channels: AlertChannel[] = ["inapp", ...(webhookOn ? (["webhook"] as AlertChannel[]) : [])];
      const arbTriggers: ArbTrigger[] = [...(trigOpen ? (["open"] as ArbTrigger[]) : []), ...(trigStop ? (["nearStop"] as ArbTrigger[]) : [])];
      const body =
        kind === "price"
          ? { kind, name, code, op, price: Number(price), channels, webhookUrl, cooldownMin: Number(cooldownMin) }
          : {
              kind,
              name,
              poolId: poolId || undefined,
              codes: poolId ? undefined : codesText,
              entryZ: Number(entryZ),
              stopZ: Number(stopZ),
              arbTriggers,
              channels,
              webhookUrl,
              cooldownMin: Number(cooldownMin),
            };
      const res = await fetch("/api/alerts/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "保存失败");
      onChange(json.rules ?? rules);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: AlertRule) {
    const res = await fetch("/api/alerts/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: rule.id, toggleEnabled: true, enabled: !rule.enabled }),
    });
    const json = await res.json();
    if (res.ok) onChange(json.rules ?? rules);
  }

  async function remove(id: string) {
    if (!window.confirm("确认删除该规则？")) return;
    const res = await fetch(`/api/alerts/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json();
    if (res.ok) onChange(json.rules ?? rules);
    await refreshRules();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">新建盯盘规则</h2>
        <div className="flex gap-2 text-xs">
          {(["arb", "price"] as AlertKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                kind === k
                  ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {k === "arb" ? "套利配对盯盘" : "个股价格盯盘"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">规则名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={kind === "arb" ? "如：白酒池价差盯盘" : "如：茅台跌破1500"} />
        </label>

        {kind === "arb" ? (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">监控股票池（推荐，与下方代码二选一）</span>
              <select value={poolId} onChange={(e) => setPoolId(e.target.value)} className={inputCls}>
                <option value="">— 不用池，手填代码 —</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.codes.length} 只）
                  </option>
                ))}
              </select>
            </label>
            {!poolId && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">成分股（≥3 只 6 位代码，逗号/空格/换行分隔）</span>
                <textarea value={codesText} onChange={(e) => setCodesText(e.target.value)} rows={2} className={`${inputCls} font-mono`} placeholder="600519,000858,000568 ..." />
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">入场阈 entryZ</span>
                <input value={entryZ} onChange={(e) => setEntryZ(e.target.value)} className={inputCls} inputMode="decimal" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">止损阈 stopZ</span>
                <input value={stopZ} onChange={(e) => setStopZ(e.target.value)} className={inputCls} inputMode="decimal" />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-[var(--muted)]">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={trigOpen} onChange={(e) => setTrigOpen(e.target.checked)} /> 价差开口（|z|≥entryZ）
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={trigStop} onChange={(e) => setTrigStop(e.target.checked)} /> 逼近止损（|z|≥stopZ）
              </label>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">代码</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-mono`} placeholder="600519" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">条件</span>
              <select value={op} onChange={(e) => setOp(e.target.value as PriceOp)} className={inputCls}>
                <option value=">=">现价 ≥</option>
                <option value="<=">现价 ≤</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">价格（元）</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} inputMode="decimal" placeholder="1500" />
            </label>
          </div>
        )}

        <div className="space-y-2 rounded-md border border-[var(--border)] p-2.5">
          <div className="text-xs font-semibold text-[var(--muted)]">投递渠道</div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
            <label className="inline-flex items-center gap-1.5 opacity-70">
              <input type="checkbox" checked readOnly /> 站内告警箱（默认）
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={webhookOn} onChange={(e) => setWebhookOn(e.target.checked)} /> webhook
            </label>
            <label className="inline-flex items-center gap-1.5">
              冷却
              <input value={cooldownMin} onChange={(e) => setCooldownMin(e.target.value)} className={`${inputCls} w-16`} inputMode="numeric" /> 分钟
            </label>
          </div>
          {webhookOn && (
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className={`${inputCls} w-full font-mono`} placeholder="https://hooks.example.com/...（触发时 POST JSON）" />
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={create} disabled={busy} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50">
            {busy ? "保存中…" : "保存规则"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">暂无规则。</div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-[var(--text)]">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-normal ${r.kind === "arb" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--hover)] text-[var(--muted)]"}`}>
                    {r.kind === "arb" ? "套利" : "价格"}
                  </span>
                  {r.name}
                  {!r.enabled && <span className="ml-2 text-xs font-normal text-[var(--faint)]">（已停用）</span>}
                </div>
                <div className="flex gap-1.5 text-xs">
                  <button onClick={() => toggle(r)} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">
                    {r.enabled ? "停用" : "启用"}
                  </button>
                  <button onClick={() => remove(r.id)} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:border-red-500/40 hover:text-red-400">删除</button>
                </div>
              </div>
              <div className="text-xs text-[var(--muted)]">
                {r.kind === "arb" ? (
                  <>
                    {r.poolId ? `池 ${pools.find((p) => p.id === r.poolId)?.name ?? r.poolId}` : `代码 ${(r.codes ?? []).join(",") || "—"}`}
                    {" · "}entryZ {r.entryZ} / stopZ {r.stopZ}
                    {" · "}
                    {(r.arbTriggers ?? []).map((t) => (t === "open" ? "开口" : "逼近止损")).join("+") || "—"}
                  </>
                ) : (
                  <>
                    {r.code} 现价 {r.op === ">=" ? "≥" : "≤"} {r.price} 元
                  </>
                )}
                {" · "}冷却 {r.cooldownMin}min · 渠道 {r.channels.join("+")}
                {r.lastTriggeredAt && <> · 上次触发 {fmtDate(r.lastTriggeredAt)}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 告警箱 ────────────────────────────────────────────────────────────────────
function InboxSection({ events, unread, onChange }: { events: AlertEvent[]; unread: number; onChange: (next: AlertEvent[]) => void }) {
  const [busy, setBusy] = useState(false);

  async function act(action: "read" | "readAll" | "clear", id?: string) {
    if (action === "clear" && !window.confirm("确认清空告警箱？")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/alerts/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const json = await res.json();
      if (res.ok) onChange(json.events ?? events);
    } finally {
      setBusy(false);
    }
  }

  function linkFor(e: AlertEvent): string | null {
    if (e.kind === "price" && typeof e.detail.code === "string") return `/analyze?code=${e.detail.code}`;
    if (e.kind === "arb" && Array.isArray(e.detail.codes)) return `/arb?codes=${(e.detail.codes as string[]).join(",")}`;
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text)]">
          告警箱 {unread > 0 && <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">{unread} 未读</span>}
        </h2>
        <div className="flex gap-1.5 text-xs">
          <button onClick={() => act("readAll")} disabled={busy || unread === 0} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50">全部已读</button>
          <button onClick={() => act("clear")} disabled={busy || events.length === 0} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:border-red-500/40 hover:text-red-400 disabled:opacity-50">清空</button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
          暂无告警。点「立即检查」或开启自动轮询后，命中规则的机会会出现在这里。
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const href = linkFor(e);
            return (
              <div
                key={e.id}
                className={`rounded-xl border bg-[var(--surface)] p-3 space-y-1 ${e.read ? "border-[var(--border)] opacity-70" : e.level === "warn" ? "border-amber-500/40" : "border-[var(--accent-line)]"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${e.level === "warn" ? "bg-amber-500" : "bg-[var(--accent)]"}`} />
                    {e.title}
                  </div>
                  {!e.read && (
                    <button onClick={() => act("read", e.id)} className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--text)]">已读</button>
                  )}
                </div>
                <div className="text-xs text-[var(--muted)]">{e.message}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--faint)]">
                  <span>{e.ruleName}</span>
                  <span>·</span>
                  <span className="tabular-nums">{fmtDate(e.triggeredAt)}</span>
                  {e.channelsSent.includes("webhook") && <span className="rounded bg-[var(--hover)] px-1.5 py-0.5">webhook 已送</span>}
                  {href && (
                    <Link href={href} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">查看</Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
