"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import StockLink from "@/components/StockLink";

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
  hedgeability: string;
}
interface InterpState {
  loading: boolean;
  error: string | null;
  data: ArbInterpretation | null;
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
  const [codesText, setCodesText] = useState(PRESETS[0].codes);
  const [minCorrelation, setMinCorrelation] = useState(0.7);
  const [entryZ, setEntryZ] = useState(2.0);
  const [stopZ, setStopZ] = useState(3.5);
  const [limit, setLimit] = useState(500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [interp, setInterp] = useState<Record<string, InterpState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
        <h1 className="text-xl font-semibold text-[var(--text)]">统计套利雷达 · 实时机会捕捉</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          在候选股票池里全两两做 Engle-Granger 协整检验，只捕捉<strong>当前价差已开口</strong>（|z|≥入场阈）的机会，
          按 <strong>|z|×协整强度</strong>排序。每条机会给出方向（做多/做空价差）、进出止损 z 阈、半衰期推算的<strong>预计回归天数</strong>、双边成本后估算净收益。
          <strong>诚实边界</strong>：A 股融券受限，纯多空难落地——优先选两融/ETF 可对冲品种，结果为价差口径研究信号，非投资建议。
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
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
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
                    <th className="px-3 py-2">方向</th>
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
                        <span className={s.side === "long-spread" ? "text-emerald-500" : "text-rose-500"}>
                          {s.side === "long-spread" ? `多 ${s.pair.a} / 空 ${s.pair.b}` : `空 ${s.pair.a} / 多 ${s.pair.b}`}
                        </span>
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
                              <div><span className="font-semibold text-amber-500">可对冲性/落地：</span>{ist.data.hedgeability}</div>
                              <div className="text-[10px] text-[var(--muted)]">AI 解读基于统计量推演，非投资建议。</div>
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
    </div>
  );
}
