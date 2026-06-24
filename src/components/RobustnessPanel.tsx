"use client";

import { useEffect, useState } from "react";

/**
 * v0.35 过拟合体检面板：调用 /api/arb/robustness，渲染
 *  1) 参数高原热图（入场阈 × z 窗口，按净值着色，标注最优格）；
 *  2) walk-forward 衰减曲线（IS vs OOS 净值，逐段 SVG 折线 + 明细表）；
 *  3) 综合稳健分与结论徽标。纯统计信号、非投资建议。
 */

interface PlateauCell {
  entryZ: number;
  lookback: number;
  cumReturnPct: number;
  winRatePct: number;
  trades: number;
  valid: boolean;
}
interface ParamPlateau {
  entryGrid: number[];
  lookbackGrid: number[];
  cells: PlateauCell[];
  best: PlateauCell | null;
  profitableCellPct: number;
  neighborRetention: number;
  minTrades: number;
}
interface WalkForwardFold {
  idx: number;
  isStart: string;
  isEnd: string;
  oosStart: string;
  oosEnd: string;
  bestEntryZ: number;
  bestLookback: number;
  isCumPct: number;
  isWinPct: number;
  isTrades: number;
  oosCumPct: number;
  oosWinPct: number;
  oosTrades: number;
  efficiency: number | null;
}
interface WalkForwardResult {
  folds: WalkForwardFold[];
  medianEfficiency: number | null;
  isAvgCumPct: number;
  oosAvgCumPct: number;
  oosPositivePct: number;
}
type RobustnessGrade = "robust" | "fragile" | "overfit";
interface RobustnessReport {
  pair: { a: string; b: string; beta: number; adfT: number; halfLifeDays: number };
  plateau: ParamPlateau;
  wf: WalkForwardResult;
  grade: RobustnessGrade;
  score: number;
  reasons: string[];
}
interface ApiResp {
  report?: RobustnessReport;
  asOf?: string | null;
  note?: string;
  error?: string;
}

const GRADE_META: Record<RobustnessGrade, { label: string; cls: string }> = {
  robust: { label: "稳健（高原宽 + 样本外不塌）", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" },
  fragile: { label: "脆弱（盈利区窄 / 样本外打折）", cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  overfit: { label: "疑似过拟合（样本内强、样本外塌）", cls: "bg-rose-500/15 text-rose-500 border-rose-500/40" },
};

/** 净值 → 单元格背景色：正绿负红，强度按当前网格内最大绝对值归一。 */
function cellColor(v: number, maxAbs: number): string {
  if (maxAbs <= 0) return "transparent";
  const t = Math.max(0, Math.min(1, Math.abs(v) / maxAbs));
  const alpha = (0.12 + 0.55 * t).toFixed(2);
  return v >= 0 ? `rgba(16,185,129,${alpha})` : `rgba(244,63,94,${alpha})`;
}

function Heatmap({ p }: { p: ParamPlateau }) {
  const maxAbs = Math.max(0.0001, ...p.cells.filter((c) => c.valid).map((c) => Math.abs(c.cumReturnPct)));
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-right text-[var(--muted)]">窗口\入场z</th>
            {p.entryGrid.map((e) => (
              <th key={e} className="px-2 py-1 text-center font-mono text-[var(--muted)]">{e}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.lookbackGrid.map((lb) => (
            <tr key={lb}>
              <td className="px-2 py-1 text-right font-mono text-[var(--muted)]">{lb}</td>
              {p.entryGrid.map((e) => {
                const c = p.cells.find((x) => x.entryZ === e && x.lookback === lb);
                if (!c) return <td key={e} />;
                const isBest = p.best && p.best.entryZ === e && p.best.lookback === lb;
                return (
                  <td
                    key={e}
                    title={`entryZ=${e} lookback=${lb}｜净值 ${c.cumReturnPct}%｜胜率 ${c.winRatePct}%｜${c.trades} 笔${c.valid ? "" : "（笔数不足）"}`}
                    className={`px-2 py-1 text-center tabular-nums ${isBest ? "ring-2 ring-[var(--accent)] ring-inset font-semibold" : ""}`}
                    style={{ background: c.valid ? cellColor(c.cumReturnPct, maxAbs) : "transparent", color: c.valid ? "var(--text)" : "var(--muted)" }}
                  >
                    {c.valid ? c.cumReturnPct : "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** walk-forward 衰减折线：IS 与 OOS 净值随 fold 推进的两条线。 */
function DecayChart({ folds }: { folds: WalkForwardFold[] }) {
  if (folds.length < 1) return null;
  const w = 320;
  const h = 120;
  const pad = 24;
  const xs = folds.map((_, i) => (folds.length === 1 ? 0.5 : i / (folds.length - 1)));
  const vals = folds.flatMap((f) => [f.isCumPct, f.oosCumPct]);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const px = (t: number) => pad + t * (w - 2 * pad);
  const py = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const line = (pick: (f: WalkForwardFold) => number) =>
    folds.map((f, i) => `${px(xs[i])},${py(pick(f))}`).join(" ");
  const zeroY = py(0);
  return (
    <svg width={w} height={h} className="overflow-visible">
      <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="var(--border)" strokeDasharray="3 3" />
      <polyline points={line((f) => f.isCumPct)} fill="none" stroke="var(--muted)" strokeWidth={1.4} />
      <polyline points={line((f) => f.oosCumPct)} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      {folds.map((f, i) => (
        <g key={f.idx}>
          <circle cx={px(xs[i])} cy={py(f.isCumPct)} r={2.5} fill="var(--muted)" />
          <circle cx={px(xs[i])} cy={py(f.oosCumPct)} r={2.5} fill="var(--accent)" />
          <text x={px(xs[i])} y={h - 6} textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 9 }}>#{f.idx}</text>
        </g>
      ))}
    </svg>
  );
}

export default function RobustnessPanel({ a, b }: { a: string; b: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<ApiResp | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/arb/robustness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a, b }),
    })
      .then(async (r) => {
        const j = (await r.json()) as ApiResp;
        if (!alive) return;
        if (!r.ok || j.error) setError(j.error ?? `请求失败（${r.status}）`);
        else setResp(j);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [a, b]);

  if (loading) return <div className="py-4 text-center text-xs text-[var(--muted)]">过拟合体检中（参数扫描 + 滚动前推）…</div>;
  if (error) return <div className="py-3 text-xs text-rose-500">体检失败：{error}</div>;
  if (!resp?.report) return null;
  const { report } = resp;
  const g = GRADE_META[report.grade];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${g.cls}`}>{g.label}</span>
        <span className="text-sm">
          稳健分 <span className="text-lg font-semibold tabular-nums text-[var(--text)]">{report.score}</span>
          <span className="text-[var(--muted)]">/100</span>
        </span>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--muted)]">
        {report.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-[var(--text)]">参数高原热图（全样本净值%）</div>
          <Heatmap p={report.plateau} />
          <div className="text-[10px] text-[var(--muted)]">
            绿=盈利红=亏损，色深=幅度；■框=净值最优格。盈利格越连成一片越稳；只有孤立尖峰=过拟合。
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-[var(--text)]">Walk-forward 衰减曲线（IS vs 样本外）</div>
          {report.wf.folds.length === 0 ? (
            <div className="py-4 text-xs text-[var(--muted)]">历史样本不足，未做滚动前推。</div>
          ) : (
            <>
              <DecayChart folds={report.wf.folds} />
              <div className="flex gap-4 text-[10px] text-[var(--muted)]">
                <span><span className="inline-block h-1.5 w-3 align-middle" style={{ background: "var(--muted)" }} /> 样本内 IS</span>
                <span><span className="inline-block h-1.5 w-3 align-middle" style={{ background: "var(--accent)" }} /> 样本外 OOS</span>
                <span>样本外效率中位 {report.wf.medianEfficiency ?? "—"}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {report.wf.folds.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[11px]">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="px-2 py-1">段</th>
                <th className="px-2 py-1">样本外区间</th>
                <th className="px-2 py-1 text-right">选优参(entryZ/窗口)</th>
                <th className="px-2 py-1 text-right">IS净值</th>
                <th className="px-2 py-1 text-right">OOS净值</th>
                <th className="px-2 py-1 text-right">OOS胜率</th>
                <th className="px-2 py-1 text-right">OOS笔数</th>
                <th className="px-2 py-1 text-right">样本外效率</th>
              </tr>
            </thead>
            <tbody>
              {report.wf.folds.map((f) => (
                <tr key={f.idx} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1">#{f.idx}</td>
                  <td className="px-2 py-1 tabular-nums text-[var(--muted)]">{f.oosStart} → {f.oosEnd}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.bestEntryZ} / {f.bestLookback}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${f.isCumPct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{f.isCumPct}%</td>
                  <td className={`px-2 py-1 text-right tabular-nums font-semibold ${f.oosCumPct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{f.oosCumPct}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.oosWinPct}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.oosTrades}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.efficiency ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resp.note && <p className="text-[10px] text-[var(--muted)]">{resp.note}{resp.asOf ? `（截至 ${resp.asOf}）` : ""}</p>}
    </div>
  );
}
