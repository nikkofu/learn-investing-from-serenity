"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StockLink from "@/components/StockLink";
import { NFA } from "@/lib/disclaimers";

// ── 类型（与 src/lib/paperTrades.ts 对齐） ─────────────────────────────────────

type CloseReason = "reverted" | "stopped" | "timeout" | "manual";

interface PaperMark {
  asOf: string;
  price: number;
  z: number;
  grossPct: number;
  netPct: number;
  pnl: number;
  holdDays: number;
  reverted: boolean;
  stopped: boolean;
  timedOut: boolean;
  checkedAt: string;
}
interface PaperPosition {
  id: string;
  strategyId?: string;
  source: string;
  name: string;
  note?: string;
  pair: { a: string; b: string; aName: string; bName: string; beta: number; adfT: number; halfLifeDays: number; correlation: number; n: number };
  params: { lookback: number; entryZ: number; exitZ: number; stopZ: number; feeBps: number; maxHoldDays: number };
  side: "long-spread" | "short-spread";
  buyCode: string;
  buyName: string;
  deRiskCode: string;
  entryDate: string;
  entryPrice: number;
  entryZ: number;
  notional: number;
  shares: number;
  maxAdverseZ: number;
  status: "open" | "closed";
  mark: PaperMark | null;
  close: { reason: CloseReason; mark: PaperMark; closedAt: string } | null;
  openedAt: string;
  updatedAt: string;
}
interface PaperSummary {
  openCount: number;
  closedCount: number;
  reversionRatePct: number;
  winRatePct: number;
  avgHoldDays: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

// A 股口径：盈红亏绿。
function pnlClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}
function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtYuan(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

const REASON_LABEL: Record<CloseReason, string> = {
  reverted: "回归兑现",
  stopped: "止损离场",
  timeout: "超时离场",
  manual: "手动平仓",
};
const REASON_STYLE: Record<CloseReason, string> = {
  reverted: "border-rose-500/40 bg-rose-500/10 text-rose-500",
  stopped: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  timeout: "border-amber-400/40 bg-amber-400/10 text-amber-500",
  manual: "border-[var(--border)] text-[var(--muted)]",
};

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${cls ?? "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

/** z 进度条：开仓 z → 当前 z → 回归阈/止损阈 的可视化。 */
function ZTrack({ pos, curZ }: { pos: PaperPosition; curZ: number }) {
  const { stopZ, exitZ } = pos.params;
  const lo = -stopZ;
  const hi = stopZ;
  const span = hi - lo || 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;
  return (
    <div className="relative h-6">
      {/* 回归带 [-exitZ, exitZ] */}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded bg-rose-500/15"
        style={{ left: pct(-exitZ), right: `calc(100% - ${pct(exitZ)})` }}
      />
      <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-[var(--border)]" />
      {/* 开仓点 */}
      <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--muted)] bg-[var(--card)]" style={{ left: pct(pos.entryZ) }} title={`开仓 z=${pos.entryZ}`} />
      {/* 当前点 */}
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--card)]" style={{ left: pct(curZ) }} title={`当前 z=${curZ}`} />
      <div className="absolute -bottom-0.5 left-0 text-[10px] text-emerald-500">止损</div>
      <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] text-rose-500">回归带</div>
      <div className="absolute -bottom-0.5 right-0 text-[10px] text-emerald-500">止损</div>
    </div>
  );
}

function PositionCard({ pos, busy, onClose, onDelete }: { pos: PaperPosition; busy: boolean; onClose: () => void; onDelete: () => void }) {
  const open = pos.status === "open";
  const mark = open ? pos.mark : pos.close?.mark ?? pos.mark;
  const curZ = mark?.z ?? pos.entryZ;
  const pnl = mark?.pnl ?? 0;
  const netPct = mark?.netPct ?? 0;
  const sideLabel = pos.side === "long-spread" ? "价差偏低·买低估腿" : "价差偏高·买低估腿";
  return (
    <div className={`rounded-2xl border bg-[var(--card)] p-5 ${open ? "border-[var(--border)]" : "border-[var(--border)] opacity-95"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
              {open ? "持仓中" : "已平仓"}
            </span>
            <h3 className="text-base font-semibold text-[var(--text)]">{pos.name}</h3>
            {pos.strategyId && <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">来自沉淀策略</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 font-mono">
              <StockLink code={pos.pair.a} newTab />
              <span className="text-[var(--muted)]">↔</span>
              <StockLink code={pos.pair.b} newTab />
            </span>
            <span className="rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-1.5 py-0.5 text-xs text-[var(--accent)]">
              买入 <span className="font-mono">{pos.buyCode}</span> {pos.buyName}
            </span>
            <span className="text-xs text-[var(--muted)]">{sideLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!open && pos.close && (
            <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${REASON_STYLE[pos.close.reason]}`}>
              {REASON_LABEL[pos.close.reason]}
            </span>
          )}
          <div className={`grid h-12 min-w-12 place-items-center rounded-xl border border-[var(--border)] px-2 ${pnlClass(pnl)}`} title="净盈亏">
            <span className="text-[10px] text-[var(--muted)]">净盈亏</span>
            <span className="text-base font-black tabular-nums">{fmtPct(netPct)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="开仓 z" value={`${pos.entryZ}`} />
        <Metric label={open ? "当前 z" : "平仓 z"} value={`${curZ}`} cls={Math.abs(curZ) <= pos.params.exitZ ? "text-rose-500" : Math.abs(curZ) >= pos.params.stopZ ? "text-emerald-500" : undefined} />
        <Metric label="买入腿价" value={mark ? `${mark.price}` : `${pos.entryPrice}`} />
        <Metric label="净盈亏(元)" value={fmtYuan(pnl)} cls={pnlClass(pnl)} />
        <Metric label="持有天数" value={`${mark?.holdDays ?? 0} 日`} />
        <Metric label="最大逆向z" value={`${pos.maxAdverseZ}`} />
      </div>

      <div className="mt-4">
        <ZTrack pos={pos} curZ={curZ} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>名义本金 {pos.notional.toLocaleString("zh-CN")} 元 · {pos.shares.toFixed(0)} 股</span>
        <span>开仓 {pos.entryDate} @ {pos.entryPrice}</span>
        <span>参数 entryZ {pos.params.entryZ} / exitZ {pos.params.exitZ} / stopZ {pos.params.stopZ} / 最长 {pos.params.maxHoldDays} 日</span>
        <span>β={pos.pair.beta.toFixed(3)} · 半衰期 {pos.pair.halfLifeDays} 日</span>
        {mark && <span>盯市截至 {mark.asOf}</span>}
        {!open && pos.close && <span>平仓 {new Date(pos.close.closedAt).toLocaleString("zh-CN")}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {open && (
          <button onClick={onClose} disabled={busy} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? "处理中…" : "手动平仓（按现价）"}
          </button>
        )}
        <Link href={`/arb?codes=${pos.pair.a},${pos.pair.b}&entryZ=${pos.params.entryZ}&stopZ=${pos.params.stopZ}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)]">
          在套利雷达打开
        </Link>
        <button onClick={onDelete} disabled={busy} className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-50">
          删除
        </button>
      </div>
    </div>
  );
}

const DEFAULT_PARAMS = { lookback: 60, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, feeBps: 30, maxHoldDays: 120 };

function ManualOpenForm({ onOpened, setNotice }: { onOpened: () => void; setNotice: (s: string | null) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [notional, setNotional] = useState(10000);
  const [p, setP] = useState({ ...DEFAULT_PARAMS });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/paper/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open", a: a.trim(), b: b.trim(), notional, params: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNotice(`已建纸面仓：买入 ${data.position.buyCode} ${data.position.buyName}（开仓 z=${data.position.entryZ}）。`);
      setA("");
      setB("");
      onOpened();
    } catch (e) {
      setNotice(`建仓失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const num = (label: string, key: keyof typeof p, step = 0.1) => (
    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
      {label}
      <input
        type="number"
        step={step}
        value={p[key]}
        onChange={(e) => setP((cur) => ({ ...cur, [key]: Number(e.target.value) }))}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm text-[var(--text)]"
      />
    </label>
  );

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          代码 A（6 位）
          <input value={a} onChange={(e) => setA(e.target.value)} placeholder="600519" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-sm text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          代码 B（6 位）
          <input value={b} onChange={(e) => setB(e.target.value)} placeholder="000858" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-sm text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          名义本金（元）
          <input type="number" step={1000} value={notional} onChange={(e) => setNotional(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm text-[var(--text)]" />
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {num("回看窗口", "lookback", 5)}
        {num("入场 |z|≥", "entryZ")}
        {num("回归 |z|≤", "exitZ")}
        {num("止损 |z|≥", "stopZ")}
        {num("费率(bps)", "feeBps", 1)}
        {num("最长持有(日)", "maxHoldDays", 1)}
      </div>
      <button onClick={submit} disabled={busy || !/^\d{6}$/.test(a.trim()) || !/^\d{6}$/.test(b.trim())} className="mt-3 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
        {busy ? "建仓中…" : "按当前开口信号建纸面仓"}
      </button>
      <p className="mt-2 text-xs text-[var(--muted)]">仅当该配对当前 |z| ≥ 入场阈（存在开口）时可建仓——均值回归仓需在价差显著偏离时入场。</p>
    </div>
  );
}

export default function PaperTradingPage() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const applyPayload = useCallback((data: { positions?: PaperPosition[]; summary?: PaperSummary }) => {
    if (data.positions) setPositions(data.positions);
    if (data.summary) setSummary(data.summary);
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/paper/positions${refresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(body: Record<string, unknown>, id?: string) {
    if (id) setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/paper/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      applyPayload(data);
      return data;
    } catch (e) {
      setNotice(`操作失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/paper/positions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      applyPayload(data);
    } catch (e) {
      setNotice(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  const openList = positions.filter((p) => p.status === "open");
  const closedList = positions.filter((p) => p.status === "closed");

  return (
    <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">配对纸面交易 / 持仓跟踪</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            把沉淀策略 / 套利配对的当前开口一键建成纸面仓，前向盯市看「价差回归是否真的兑现」· 开平流水 / 实时盈亏 / 回归达成率
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFormOpen((v) => !v)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)]">
            {formOpen ? "收起手动建仓" : "手动建仓"}
          </button>
          <button onClick={() => load(true)} disabled={refreshing || loading} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
            {refreshing ? "盯市中…" : "刷新盯市（拉最新 K + 实时价）"}
          </button>
        </div>
      </div>

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          <Metric label="持仓中" value={`${summary.openCount}`} />
          <Metric label="已平仓" value={`${summary.closedCount}`} />
          <Metric label="回归达成率" value={`${summary.reversionRatePct}%`} cls={summary.reversionRatePct >= 60 ? "text-rose-500" : summary.reversionRatePct >= 40 ? "text-amber-500" : "text-emerald-500"} />
          <Metric label="平仓胜率" value={`${summary.winRatePct}%`} cls={summary.winRatePct >= 50 ? "text-rose-500" : "text-emerald-500"} />
          <Metric label="平均持有" value={`${summary.avgHoldDays} 日`} />
          <Metric label="已实现盈亏" value={fmtYuan(summary.realizedPnl)} cls={pnlClass(summary.realizedPnl)} />
          <Metric label="未实现盈亏" value={fmtYuan(summary.unrealizedPnl)} cls={pnlClass(summary.unrealizedPnl)} />
        </div>
      )}

      {formOpen && <ManualOpenForm onOpened={() => load(false)} setNotice={setNotice} />}

      {notice && <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm text-[var(--text)]">{notice}</div>}
      {error && (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-[var(--text)]">
          加载失败：{error}
          <button onClick={() => load(false)} className="ml-2 underline">重试</button>
        </div>
      )}

      {loading && positions.length === 0 ? (
        <div className="mt-10 grid place-items-center rounded-2xl border border-dashed border-[var(--border)] py-20 text-sm text-[var(--muted)]">加载纸面持仓…</div>
      ) : positions.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          还没有纸面仓。去
          <Link href="/strategies" target="_blank" rel="noopener noreferrer" className="mx-1 text-[var(--accent)] underline">策略市场</Link>
          的沉淀策略点「建纸面仓」，或在上方「手动建仓」按当前开口建一笔。
        </div>
      ) : (
        <>
          <h2 className="mt-8 text-lg font-semibold text-[var(--text)]">持仓中（{openList.length}）</h2>
          {openList.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-sm text-[var(--muted)]">暂无持仓中纸面仓。</div>
          ) : (
            <div className="mt-3 space-y-4">
              {openList.map((pos) => (
                <PositionCard key={pos.id} pos={pos} busy={busyId === pos.id} onClose={() => action({ action: "close", id: pos.id }, pos.id)} onDelete={() => remove(pos.id)} />
              ))}
            </div>
          )}

          {closedList.length > 0 && (
            <>
              <div className="mt-8 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--text)]">已平仓（{closedList.length}）</h2>
                <button onClick={() => action({ action: "clear" })} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:bg-[var(--hover)]">
                  清空已平仓
                </button>
              </div>
              <div className="mt-3 space-y-4">
                {closedList.map((pos) => (
                  <PositionCard key={pos.id} pos={pos} busy={busyId === pos.id} onClose={() => {}} onDelete={() => remove(pos.id)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-xs leading-6 text-[var(--muted)]">
        <div className="mb-1 font-semibold text-[var(--text)]">口径说明</div>
        纸面仓按「当前开口信号」前向跟踪：开仓记录买入腿（被低估那只）价格与 z，持仓中按最新日 K + 实时价重算滚动 z 与盈亏；
        命中回归（|z|≤exitZ）/ 止损（|z|≥stopZ）/ 超时（持有≥最长天数）自动平仓。盈亏走 A 股成本模型（佣金/印花税/过户费/滑点）。
        <span className="text-rose-500">盈红</span> / <span className="text-emerald-500">亏绿</span>。回归达成率 = 已平仓中由「价差回归」兑现的占比。{NFA}
      </div>
    </main>
  );
}
