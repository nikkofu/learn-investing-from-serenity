"use client";

import Link from "next/link";
import { Fragment, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import StockLink from "@/components/StockLink";
import PoolControls from "@/components/PoolControls";

interface PairCandidate {
  a: string;
  b: string;
  beta: number;
  adfT: number;
  cointegrated: boolean;
  correlation: number;
  halfLifeDays: number;
  n: number;
}
interface ArbSignal {
  pair: PairCandidate;
  z: number;
  side: "long-spread" | "short-spread";
  spread: number;
  deviation: number;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  nearStop: boolean;
  expectedRevertDays: number;
  spreadSeries: number[];
  dateSeries: string[];
  asOf: string;
  rank: number;
  estNetPct: number;
  buyCode: string;
  deRiskCode: string;
}
interface RadarResult {
  universeSize: number;
  pairsTested: number;
  cointegratedCount: number;
  signals: ArbSignal[];
  asOf: string | null;
  note: string;
}
interface ArbInterpretation {
  thesis: string;
  entryLogic: string;
  revertCatalyst: string;
  risks: string[];
  invalidation: string;
  /** 单边持有的下行风险与落地说明（原对冲性字段，单边化后改述）。 */
  hedgeability: string;
}
interface InterpState {
  loading: boolean;
  error: string | null;
  data: ArbInterpretation | null;
}
interface SignalEvent {
  entryDate: string;
  exitDate: string;
  buyCode: string;
  entryZ: number;
  exitZ: number;
  maxAdverseZ: number;
  holdDays: number;
  reverted: boolean;
  exitReason: string;
  legReturnPct: number;
  legReturnGrossPct: number;
}
interface PairCalibration {
  pair: PairCandidate;
  events: SignalEvent[];
  signals: number;
  reversions: number;
  reversionRatePct: number;
  stopouts: number;
  timeouts: number;
  avgRevertDays: number;
  avgLegReturnPct: number;
  legWinRatePct: number;
  avgMaxAdverseZ: number;
}
interface CalibrationResult {
  universeSize: number;
  pairsTested: number;
  cointegratedCount: number;
  calibrations: PairCalibration[];
  agg: {
    pairsWithSignals: number;
    totalSignals: number;
    reversionRatePct: number;
    avgRevertDays: number;
    avgLegReturnPct: number;
    legWinRatePct: number;
    avgMaxAdverseZ: number;
  };
  asOf: string | null;
  note: string;
}

// 板块预设股票池（同板块更易出协整对）
const PRESETS: { label: string; codes: string }[] = [
  { label: "白酒", codes: "600519,000858,000568,600809,002304,000596,600702,603369,600559,603198" },
  { label: "银行", codes: "601398,601939,601288,601988,600036,601328,601166,600000,601658,002142" },
  { label: "证券", codes: "600030,601688,600837,601211,000776,601788,002736,600999,601377,000166" },
  { label: "新能源车链", codes: "300750,002594,300014,002460,002466,300207,688005,002812,300073,300337" },
  { label: "医药", codes: "600276,300760,000538,600196,002422,300122,002007,600085,000661,300347" },
];

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 120;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.2} />
    </svg>
  );
}

function StatCard({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${cls ?? "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

export default function ArbRadarPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[var(--muted)]">载入中…</div>}>
      <ArbRadarInner />
    </Suspense>
  );
}

function ArbRadarInner() {
  const params = useSearchParams();
  const [codesText, setCodesText] = useState(params.get("codes")?.trim() || PRESETS[0].codes);
  const [minCorrelation, setMinCorrelation] = useState(Number(params.get("minCorrelation")) || 0.7);
  const [entryZ, setEntryZ] = useState(Number(params.get("entryZ")) || 2.0);
  const [stopZ, setStopZ] = useState(Number(params.get("stopZ")) || 3.5);
  const [limit, setLimit] = useState(Number(params.get("limit")) || 500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [interp, setInterp] = useState<Record<string, InterpState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const [cal, setCal] = useState<CalibrationResult | null>(null);
  const [calOpen, setCalOpen] = useState<Record<string, boolean>>({});
  const [sediment, setSediment] = useState<Record<string, { state: "saving" | "done" | "error"; msg: string }>>({});

  const codes = useMemo(
    () =>
      Array.from(
        new Set(
          codesText
            .split(/[\s,，]+/)
            .map((c) => c.trim())
            .filter((c) => /^\d{6}$/.test(c)),
        ),
      ),
    [codesText],
  );

  async function run() {
    if (codes.length < 3) {
      setError("套利雷达至少需要 3 只股票，建议同板块 ≥8 只");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/arb/radar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes, limit, minCorrelation, entryZ, stopZ }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResult(json as RadarResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggleInterpret(s: ArbSignal) {
    const key = `${s.pair.a}-${s.pair.b}`;
    const isOpen = expanded[key];
    setExpanded((m) => ({ ...m, [key]: !isOpen }));
    if (isOpen || interp[key]?.data || interp[key]?.loading) return;
    setInterp((m) => ({ ...m, [key]: { loading: true, error: null, data: null } }));
    try {
      const res = await fetch("/api/arb/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          a: s.pair.a,
          b: s.pair.b,
          z: s.z,
          side: s.side,
          buyCode: s.buyCode,
          deRiskCode: s.deRiskCode,
          beta: s.pair.beta,
          correlation: s.pair.correlation,
          adfT: s.pair.adfT,
          halfLifeDays: s.pair.halfLifeDays,
          expectedRevertDays: s.expectedRevertDays,
          estNetPct: s.estNetPct,
          nearStop: s.nearStop,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setInterp((m) => ({ ...m, [key]: { loading: false, error: null, data: json as ArbInterpretation } }));
    } catch (e) {
      setInterp((m) => ({ ...m, [key]: { loading: false, error: e instanceof Error ? e.message : String(e), data: null } }));
    }
  }

  async function runCalibrate() {
    if (codes.length < 3) {
      setCalError("信号回测校准至少需要 3 只股票，建议同板块 ≥8 只");
      return;
    }
    setCalLoading(true);
    setCalError(null);
    setCal(null);
    try {
      const res = await fetch("/api/arb/calibrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes, limit, minCorrelation, entryZ, stopZ }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setCal(json as CalibrationResult);
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalLoading(false);
    }
  }

  // 把一行校准结果 + 当前参数沉淀成「策略市场」里的配对策略
  async function sedimentStrategy(c: PairCalibration) {
    const key = `${c.pair.a}-${c.pair.b}`;
    setSediment((m) => ({ ...m, [key]: { state: "saving", msg: "沉淀中…" } }));
    try {
      const res = await fetch("/api/strategies/saved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          strategy: {
            pair: {
              a: c.pair.a,
              b: c.pair.b,
              beta: c.pair.beta,
              adfT: c.pair.adfT,
              halfLifeDays: c.pair.halfLifeDays,
              correlation: c.pair.correlation,
              n: c.pair.n,
            },
            params: { entryZ, stopZ, exitZ: 0.5 },
            snapshot: {
              signals: c.signals,
              reversionRatePct: c.reversionRatePct,
              avgRevertDays: c.avgRevertDays,
              avgLegReturnPct: c.avgLegReturnPct,
              legWinRatePct: c.legWinRatePct,
              avgMaxAdverseZ: c.avgMaxAdverseZ,
              stopouts: c.stopouts,
              timeouts: c.timeouts,
              asOf: cal?.asOf ?? null,
            },
            source: "arb-calibrate",
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const grade = json?.strategy?.score?.grade ?? "?";
      setSediment((m) => ({ ...m, [key]: { state: "done", msg: `已沉淀（评级 ${grade}）` } }));
    } catch (e) {
      setSediment((m) => ({ ...m, [key]: { state: "error", msg: e instanceof Error ? e.message : String(e) } }));
    }
  }

  const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums";

  return (
    <div className="w-full space-y-6">
      <div>
        <div className="mb-2 flex gap-2 text-xs">
          <span className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent)]">
            套利雷达 · StatArb
          </span>
          <Link href="/backtest/pairs" className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
            配对回测（样本内外）
          </Link>
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)]">统计套利雷达 · 单边可执行择时</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          候选池（已按设置页<strong>股票池纯净化</strong>口径剔除科创/北交所/B 股等）内全两两做 Engle-Granger 协整检验，只捕捉<strong>当前价差已开口</strong>（|z|≥入场阈）的机会，
          按 <strong>|z|×协整强度</strong>排序。每条直接落到<strong>单边动作</strong>：相对被低估的那一只 → <span className="text-emerald-500 font-semibold">逢低分批布局</span>（买入择时）；相对被高估的那一只 → <span className="text-rose-500 font-semibold">减仓/规避</span>。
          <strong>诚实边界</strong>：这是<strong>「相对强弱择时」，不是无风险对冲套利</strong>——A 股主板无融券，单边持有需自担市场 β 与方向风险，结果为统计信号，非投资建议。
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setCodesText(p.codes)}
              className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">
            候选股票池（6 位代码）· 已识别 {codes.length} 只，两两组合 {(codes.length * (codes.length - 1)) / 2} 对
          </span>
          <textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            rows={3}
            className={`${inputCls} font-mono`}
            placeholder="600519,000858,000568 ..."
          />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">最低相关性</span>
            <input type="number" min={0} max={1} step={0.05} value={minCorrelation} onChange={(e) => setMinCorrelation(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">入场 z 阈</span>
            <input type="number" min={1} max={4} step={0.1} value={entryZ} onChange={(e) => setEntryZ(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">止损 z 阈（协整破裂）</span>
            <input type="number" min={2} max={6} step={0.1} value={stopZ} onChange={(e) => setStopZ(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单只取 K 根</span>
            <input type="number" min={250} max={800} step={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={run} disabled={loading} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {loading ? "扫描中（全两两协整较慢）…" : "扫描当前套利机会"}
          </button>
          <button
            onClick={runCalibrate}
            disabled={calLoading}
            className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-5 py-1.5 text-sm font-semibold text-[var(--accent)] hover:opacity-90 disabled:opacity-50"
          >
            {calLoading ? "事后回测中…" : "信号回测校准（事后验证）"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
          {calError && <span className="text-sm text-red-500">{calError}</span>}
        </div>
        <PoolControls
          codes={codes}
          onLoad={(c) => setCodesText(c.join(","))}
          screen={{ scope: "arb", params: { codes: codes.join(","), minCorrelation, entryZ, stopZ, limit } }}
        />
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="股票池" value={`${result.universeSize} 只`} />
            <StatCard label="检验对数" value={`${result.pairsTested}`} />
            <StatCard label="协整对" value={`${result.cointegratedCount}`} />
            <StatCard label="当前开口机会" value={`${result.signals.length}`} cls={result.signals.length ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
          </div>
          {result.asOf && <div className="text-xs text-[var(--muted)]">数据截至 {result.asOf}</div>}

          {result.signals.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
              当前没有价差开口的机会（所有协整对的 |z| 都低于入场阈）。可降低入场 z 阈或换板块再扫。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                    <th className="px-3 py-2">配对（A / B）</th>
                    <th className="px-3 py-2">单边可执行动作</th>
                    <th className="px-3 py-2 text-right">z 偏离</th>
                    <th className="px-3 py-2 text-right">预计回归</th>
                    <th className="px-3 py-2 text-right">估算净收益</th>
                    <th className="px-3 py-2 text-right">半衰期</th>
                    <th className="px-3 py-2 text-right">β</th>
                    <th className="px-3 py-2 text-right">相关性</th>
                    <th className="px-3 py-2 text-right">ADF-t</th>
                    <th className="px-3 py-2">价差走势</th>
                    <th className="px-3 py-2">AI 解读</th>
                  </tr>
                </thead>
                <tbody>
                  {result.signals.map((s) => {
                    const key = `${s.pair.a}-${s.pair.b}`;
                    const ist = interp[key];
                    const open = expanded[key];
                    return (
                    <Fragment key={key}>
                    <tr className="border-b border-[var(--border)] last:border-0">
                      <td className="px-3 py-2 font-mono">
                        <span className="inline-flex items-center gap-1">
                          <StockLink code={s.pair.a} newTab />
                          <span className="text-[var(--muted)]">/</span>
                          <StockLink code={s.pair.b} newTab />
                        </span>
                        {s.nearStop && <span className="ml-1 rounded bg-red-500/15 px-1 text-[10px] text-red-500">近止损</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1">
                            <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-500">逢低买入</span>
                            <StockLink code={s.buyCode} newTab />
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold text-rose-500">减仓/规避</span>
                            <StockLink code={s.deRiskCode} newTab />
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{s.z}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.expectedRevertDays} 日</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${s.estNetPct > 0 ? "text-emerald-500" : "text-[var(--muted)]"}`}>{fmtPct(s.estNetPct)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.pair.halfLifeDays.toFixed(1)} 日</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.pair.beta.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.pair.correlation.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.pair.adfT.toFixed(2)}</td>
                      <td className="px-3 py-2"><Spark data={s.spreadSeries} /></td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleInterpret(s)}
                          className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--accent)] hover:border-[var(--accent-line)]"
                        >
                          {ist?.loading ? "解读中…" : open ? "收起" : "AI 解读"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[var(--border)] last:border-0">
                        <td colSpan={11} className="bg-[var(--bg)] px-3 py-3">
                          {ist?.loading && <div className="text-xs text-[var(--muted)]">AI 正在解读这条套利机会…</div>}
                          {ist?.error && <div className="text-xs text-red-500">{ist.error}</div>}
                          {ist?.data && (
                            <div className="space-y-2 text-xs leading-relaxed">
                              <div><span className="font-semibold text-[var(--accent)]">核心逻辑：</span>{ist.data.thesis}</div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div><span className="font-semibold text-[var(--text)]">入场依据：</span>{ist.data.entryLogic}</div>
                                <div><span className="font-semibold text-[var(--text)]">回归依据：</span>{ist.data.revertCatalyst}</div>
                              </div>
                              {ist.data.risks.length > 0 && (
                                <div>
                                  <span className="font-semibold text-[var(--text)]">风险：</span>
                                  <ul className="ml-4 list-disc text-[var(--muted)]">
                                    {ist.data.risks.map((r, i) => <li key={i}>{r}</li>)}
                                  </ul>
                                </div>
                              )}
                              <div><span className="font-semibold text-rose-500">可证伪/止损条件：</span>{ist.data.invalidation}</div>
                              <div><span className="font-semibold text-amber-500">单边持有风险/落地：</span>{ist.data.hedgeability}</div>
                              <div className="text-[10px] text-[var(--muted)]">AI 解读基于统计量推演的单边均值回归择时，非投资建议。</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--muted)]">{result.note}</p>
        </div>
      )}

      {cal && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)]">信号回测校准 · 事后验证</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              对池内全部协整配对<strong>全历史回放</strong>：每次 |z|≥入场阈开口就<strong>买入被低估的那一只</strong>，持有到价差回归/止损/超时，统计这套<strong>单边择时规则</strong>历史上的真实表现。
              单边收益<strong>含市场 β（非中性）</strong>、已扣单边往返成本。回归率高·单边胜率高·最大逆向浅 ⇒ z 阈更可托付。历史不代表未来，非投资建议。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="协整配对" value={`${cal.agg.pairsWithSignals} 对`} />
            <StatCard label="历史信号数" value={`${cal.agg.totalSignals}`} />
            <StatCard label="价差回归率" value={`${cal.agg.reversionRatePct}%`} cls={cal.agg.reversionRatePct >= 60 ? "text-emerald-500" : cal.agg.reversionRatePct >= 40 ? "text-amber-500" : "text-rose-500"} />
            <StatCard label="平均回归天数" value={`${cal.agg.avgRevertDays} 日`} />
            <StatCard label="单边净收益(均)" value={fmtPct(cal.agg.avgLegReturnPct)} cls={cal.agg.avgLegReturnPct > 0 ? "text-emerald-500" : "text-rose-500"} />
            <StatCard label="单边胜率" value={`${cal.agg.legWinRatePct}%`} cls={cal.agg.legWinRatePct >= 50 ? "text-emerald-500" : "text-rose-500"} />
          </div>
          {cal.asOf && <div className="text-xs text-[var(--muted)]">回放数据截至 {cal.asOf} · 平均最大逆向 |z|={cal.agg.avgMaxAdverseZ}</div>}

          {cal.calibrations.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
              池内协整配对在全历史上没有触发过 |z|≥入场阈的开口信号。可降低入场 z 阈或换板块再试。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                    <th className="px-3 py-2">配对（A / B）</th>
                    <th className="px-3 py-2 text-right">信号数</th>
                    <th className="px-3 py-2 text-right">回归率</th>
                    <th className="px-3 py-2 text-right">止损/超时</th>
                    <th className="px-3 py-2 text-right">平均回归天数</th>
                    <th className="px-3 py-2 text-right">单边净收益(均)</th>
                    <th className="px-3 py-2 text-right">单边胜率</th>
                    <th className="px-3 py-2 text-right">最大逆向z(均)</th>
                    <th className="px-3 py-2">逐笔</th>
                    <th className="px-3 py-2">沉淀</th>
                  </tr>
                </thead>
                <tbody>
                  {cal.calibrations.map((c) => {
                    const key = `${c.pair.a}-${c.pair.b}`;
                    const open = calOpen[key];
                    return (
                      <Fragment key={key}>
                        <tr className="border-b border-[var(--border)] last:border-0">
                          <td className="px-3 py-2 font-mono">
                            <span className="inline-flex items-center gap-1">
                              <StockLink code={c.pair.a} newTab />
                              <span className="text-[var(--muted)]">/</span>
                              <StockLink code={c.pair.b} newTab />
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.signals}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${c.reversionRatePct >= 60 ? "text-emerald-500" : c.reversionRatePct >= 40 ? "text-amber-500" : "text-rose-500"}`}>{c.reversionRatePct}%</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">{c.stopouts}/{c.timeouts}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.avgRevertDays} 日</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${c.avgLegReturnPct > 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(c.avgLegReturnPct)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${c.legWinRatePct >= 50 ? "text-emerald-500" : "text-rose-500"}`}>{c.legWinRatePct}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.avgMaxAdverseZ}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setCalOpen((m) => ({ ...m, [key]: !open }))}
                              className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--accent)] hover:border-[var(--accent-line)]"
                            >
                              {open ? "收起" : `${c.signals} 笔`}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              disabled={sediment[key]?.state === "saving" || sediment[key]?.state === "done"}
                              onClick={() => sedimentStrategy(c)}
                              title="把该配对 + 当前参数 + 校准战绩沉淀为策略市场里的配对策略"
                              className={`rounded border px-2 py-0.5 text-xs disabled:opacity-60 ${sediment[key]?.state === "done" ? "border-emerald-500/40 text-emerald-500" : sediment[key]?.state === "error" ? "border-rose-500/40 text-rose-500" : "border-[var(--border)] text-[var(--accent)] hover:border-[var(--accent-line)]"}`}
                            >
                              {sediment[key]?.msg ?? "沉淀为策略"}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-[var(--border)] last:border-0">
                            <td colSpan={10} className="bg-[var(--bg)] px-3 py-3">
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[680px] text-xs">
                                  <thead>
                                    <tr className="text-left text-[var(--muted)]">
                                      <th className="px-2 py-1">买入</th>
                                      <th className="px-2 py-1">进场日</th>
                                      <th className="px-2 py-1">出场日</th>
                                      <th className="px-2 py-1 text-right">进场z</th>
                                      <th className="px-2 py-1 text-right">出场z</th>
                                      <th className="px-2 py-1 text-right">最大逆向z</th>
                                      <th className="px-2 py-1 text-right">持有天数</th>
                                      <th className="px-2 py-1">结果</th>
                                      <th className="px-2 py-1 text-right">单边净收益</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.events.map((e, i) => (
                                      <tr key={i} className="border-t border-[var(--border)]">
                                        <td className="px-2 py-1 font-mono"><StockLink code={e.buyCode} newTab /></td>
                                        <td className="px-2 py-1 tabular-nums text-[var(--muted)]">{e.entryDate}</td>
                                        <td className="px-2 py-1 tabular-nums text-[var(--muted)]">{e.exitDate}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{e.entryZ}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{e.exitZ}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{e.maxAdverseZ}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{e.holdDays}</td>
                                        <td className="px-2 py-1">
                                          <span className={`rounded px-1 text-[10px] ${e.reverted ? "bg-emerald-500/15 text-emerald-500" : e.exitReason === "协整破裂止损" ? "bg-rose-500/15 text-rose-500" : "bg-[var(--border)] text-[var(--muted)]"}`}>{e.exitReason}</span>
                                        </td>
                                        <td className={`px-2 py-1 text-right tabular-nums ${e.legReturnPct > 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(e.legReturnPct)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--muted)]">{cal.note}</p>
        </div>
      )}
    </div>
  );
}
