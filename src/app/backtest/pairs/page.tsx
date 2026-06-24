"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { NFA } from "@/lib/disclaimers";

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
interface PairBacktest {
  pair: PairCandidate;
  totalTrades: number;
  wins: number;
  winRatePct: number;
  avgReturnPct: number;
  cumReturnPct: number;
  profitFactor: number;
}
interface AggStats {
  testedPairs: number;
  profitablePairs: number;
  totalTrades: number;
  winRatePct: number;
  avgReturnPct: number;
  portfolioCumPct: number;
}
interface ScanResult {
  universeSize: number;
  pairsTested: number;
  cointegratedCount: number;
  topPairs: PairCandidate[];
  topBacktests: PairBacktest[];
  inSample: AggStats;
  outOfSample: AggStats;
  note: string;
}

const BLUECHIP50 =
  "601939,601398,601288,600941,601988,300750,601857,601138,600519,300308,600938,601628,600036,601318,601088,601899,300502,002594,600900,000333,601328,601658,600028,002371,601728,002475,002384,603986,603993,600183,601869,600030,601998,601166,300476,300394,300274,301666,300059,600276,601211,603259,601319,002916,600000,601601,002415,300408,000858,600487";

function signClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}
function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function StatCard({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${cls ?? "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

export default function PairsBacktestPage() {
  const [codesText, setCodesText] = useState(BLUECHIP50);
  const [minCorrelation, setMinCorrelation] = useState(0.7);
  const [entryZ, setEntryZ] = useState(2.0);
  const [stopZ, setStopZ] = useState(3.5);
  const [limit, setLimit] = useState(500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const codes = useMemo(
    () =>
      Array.from(
        new Set(
          codesText
            .split(/[\s,，、]+/)
            .map((c) => c.trim())
            .filter((c) => /^\d{6}$/.test(c)),
        ),
      ),
    [codesText],
  );

  async function run() {
    if (codes.length < 3) {
      setError("配对交易至少需要 3 只候选（建议 ≥10 只）");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/backtest/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes, limit, minCorrelation, entryZ, stopZ }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResult(json as ScanResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums";

  // 过拟合程度：样本内胜率 - 样本外胜率（越大越像"撞出来的"）。
  const overfitGap = result ? result.inSample.winRatePct - result.outOfSample.winRatePct : 0;

  return (
    <div className="w-full space-y-6">
      <div>
        <div className="mb-2 flex gap-2 text-xs">
          <Link href="/backtest" className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
            组合回测
          </Link>
          <Link href="/backtest/strategy" className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
            建议忠实回测
          </Link>
          <span className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent)]">
            配对交易(统计套利)
          </span>
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)]">统计套利 · 配对交易（市场中性）</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          与趋势内核**互补**的机构常用 alpha：在候选池里两两做 Engle-Granger 协整检验（OLS 求对冲比例 β → 残差 ADF 平稳性），挑出**协整**配对，把价差标准化为 z 分数做均值回归——z 过高做空价差、过低做多价差、回归平仓、破裂止损，双腿各计手续费。**重点看样本内 vs 样本外**：协整是样本内性质、会破裂，样本外回落越大越是过拟合。**诚实边界**：A 股融券受限，纯多空在多数个股难落地。{NFA}
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">候选股票池（6 位代码）· 已识别 {codes.length} 只（两两组合 {(codes.length * (codes.length - 1)) / 2} 对）</span>
          <textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            rows={3}
            className={`${inputCls} font-mono`}
            placeholder="601939,601398,601288 ..."
          />
          <button type="button" onClick={() => setCodesText(BLUECHIP50)} className="self-start rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">
            大盘蓝筹 50（总市值先验选样）
          </button>
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">最低相关性</span>
            <input type="number" min={0} max={1} step={0.05} value={minCorrelation} onChange={(e) => setMinCorrelation(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">入场 z 阈值</span>
            <input type="number" min={1} max={4} step={0.1} value={entryZ} onChange={(e) => setEntryZ(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">止损 z 阈值（协整破裂）</span>
            <input type="number" min={2} max={6} step={0.1} value={stopZ} onChange={(e) => setStopZ(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单只取 K 根数</span>
            <input type="number" min={250} max={800} step={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={run} disabled={loading} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {loading ? "扫描中…（两两协整检验较慢）" : "扫描协整配对并回测"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${overfitGap > 15 ? "border-red-500/40 bg-red-500/10" : overfitGap > 5 ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"} text-[var(--text)]`}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">结论 · 样本外是否还赚钱（过拟合检验）</div>
            <p className="text-sm leading-6">
              候选 {result.universeSize} 只、两两 {result.pairsTested} 对，找到协整配对 {result.cointegratedCount} 对。
              样本内胜率 {result.inSample.winRatePct}% / 每笔 {fmtPct(result.inSample.avgReturnPct)}；
              <b> 样本外</b>（前 60% 选配对+定 β、后 40% 独立交易）胜率 {result.outOfSample.winRatePct}% / 每笔 {fmtPct(result.outOfSample.avgReturnPct)}、盈利配对 {result.outOfSample.profitablePairs}/{result.outOfSample.testedPairs}。
              样本内外胜率落差 {overfitGap.toFixed(1)}pp{overfitGap > 15 ? " → 落差大，朴素静态-β 协整难以样本外存活（典型 stat-arb 衰减）。" : overfitGap > 5 ? " → 有过拟合，需谨慎。" : " → 落差小，相对稳健。"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="协整配对数" value={`${result.cointegratedCount}`} />
            <StatCard label="样本内胜率" value={`${result.inSample.winRatePct}%`} />
            <StatCard label="样本外胜率" value={`${result.outOfSample.winRatePct}%`} cls={result.outOfSample.winRatePct >= 50 ? "text-rose-500" : "text-emerald-500"} />
            <StatCard label="样本内每笔" value={fmtPct(result.inSample.avgReturnPct)} cls={signClass(result.inSample.avgReturnPct)} />
            <StatCard label="样本外每笔" value={fmtPct(result.outOfSample.avgReturnPct)} cls={signClass(result.outOfSample.avgReturnPct)} />
            <StatCard label="样本外盈利配对" value={`${result.outOfSample.profitablePairs}/${result.outOfSample.testedPairs}`} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Top 协整配对（按 ADF t 排序，越负越平稳）· 单配对样本内回测</h2>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="text-[var(--muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-1 pr-2 font-medium">配对 (多A / 空B)</th>
                    <th className="py-1 pr-2 font-medium">β</th>
                    <th className="py-1 pr-2 font-medium">ADF t</th>
                    <th className="py-1 pr-2 font-medium">相关</th>
                    <th className="py-1 pr-2 font-medium">半衰期</th>
                    <th className="py-1 pr-2 font-medium">交易</th>
                    <th className="py-1 pr-2 font-medium">胜率</th>
                    <th className="py-1 pr-2 font-medium">每笔</th>
                    <th className="py-1 pr-2 font-medium">PF</th>
                  </tr>
                </thead>
                <tbody>
                  {result.topBacktests.map((b) => (
                    <tr key={`${b.pair.a}-${b.pair.b}`} className="border-b border-[var(--border)]/50">
                      <td className="py-1 pr-2 font-mono">{b.pair.a} / {b.pair.b}</td>
                      <td className="py-1 pr-2">{b.pair.beta.toFixed(2)}</td>
                      <td className="py-1 pr-2">{b.pair.adfT.toFixed(2)}</td>
                      <td className="py-1 pr-2">{b.pair.correlation.toFixed(2)}</td>
                      <td className="py-1 pr-2">{b.pair.halfLifeDays.toFixed(0)}日</td>
                      <td className="py-1 pr-2">{b.totalTrades}</td>
                      <td className="py-1 pr-2">{b.winRatePct}%</td>
                      <td className={`py-1 pr-2 ${signClass(b.avgReturnPct)}`}>{fmtPct(b.avgReturnPct)}</td>
                      <td className="py-1 pr-2">{Number.isFinite(b.profitFactor) ? b.profitFactor.toFixed(2) : "∞"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--faint)]">{result.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}
