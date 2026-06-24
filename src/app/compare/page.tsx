"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import StockLink from "@/components/StockLink";
import FavoriteButton from "@/components/FavoriteButton";
import PoolControls from "@/components/PoolControls";
import { NFA } from "@/lib/disclaimers";

// ── 类型（与 /api/compare* 返回对齐）─────────────────────────────────────────
type CompareUnit = "price" | "pct" | "num" | "score";
interface CompareColumn {
  key: string;
  label: string;
  unit: CompareUnit;
  better: 1 | -1 | 0;
}
interface CompareRow {
  code: string;
  name: string;
  values: Record<string, number | null>;
  pct: Record<string, number | null>;
}
interface NormalizedChart {
  dates: string[];
  series: Array<{ code: string; name: string; points: number[] }>;
}
interface CompareResp {
  columns: CompareColumn[];
  rows: CompareRow[];
  chart: NormalizedChart;
  asOf: string;
  note: string;
}
interface CompareView {
  id: string;
  name: string;
  codes: string[];
  columns: string[];
  sortKey: string;
  sortDir: "asc" | "desc";
  createdAt: string;
  updatedAt: string;
}

const PRESET = "600519,000858,600519,601318,600036,000333,002594,600276";
const ALL_COLUMNS: CompareColumn[] = [
  { key: "price", label: "现价", unit: "price", better: 0 },
  { key: "changePct", label: "今日涨跌", unit: "pct", better: 1 },
  { key: "turnoverPct", label: "换手率", unit: "pct", better: 0 },
  { key: "r1m", label: "近1月", unit: "pct", better: 1 },
  { key: "r3m", label: "近3月", unit: "pct", better: 1 },
  { key: "r6m", label: "近6月", unit: "pct", better: 1 },
  { key: "skip", label: "12-1动量", unit: "pct", better: 1 },
  { key: "vol", label: "年化波动", unit: "pct", better: -1 },
  { key: "riskAdj", label: "风险调整", unit: "num", better: 1 },
  { key: "trend", label: "趋势(vsMA60)", unit: "pct", better: 1 },
  { key: "composite", label: "合成动量分", unit: "score", better: 1 },
];
const DEFAULT_COLUMNS = ["price", "changePct", "r1m", "r3m", "r6m", "vol", "composite"];
const LINE_COLORS = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4", "#d946ef",
];

const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums";

function fmtVal(v: number | null, unit: CompareUnit): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (unit === "pct") return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  if (unit === "price") return v.toFixed(2);
  if (unit === "score") return v.toFixed(1);
  return v.toFixed(2);
}

/** 按横截面百分位（1=最优绿、0=最差红）给单元格上色；中性列返回空。 */
function heatStyle(p: number | null): React.CSSProperties {
  if (p === null || !Number.isFinite(p)) return {};
  const a = Math.abs(p - 0.5) * 2 * 0.3;
  const rgb = p >= 0.5 ? "16,185,129" : "244,63,94";
  return { backgroundColor: `rgba(${rgb},${a.toFixed(3)})` };
}

// ── 归一化走势叠加图（纯 SVG，基点=100）────────────────────────────────────────
function NormalizedChartView({ chart }: { chart: NormalizedChart }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  if (!chart || chart.dates.length < 2 || chart.series.length === 0) {
    return <p className="text-sm text-[var(--muted)]">公共交易日不足，暂无走势叠加图。</p>;
  }
  const w = 920;
  const h = 300;
  const padX = 8;
  const padY = 16;
  const visible = chart.series.filter((s) => !hidden.has(s.code));
  const allPts = visible.flatMap((s) => s.points);
  const min = allPts.length ? Math.min(...allPts, 100) : 100;
  const max = allPts.length ? Math.max(...allPts, 100) : 100;
  const span = max - min || 1;
  const n = chart.dates.length;
  const stepX = (w - padX * 2) / (n - 1);
  const x = (i: number) => padX + i * stepX;
  const y = (v: number) => padY + (h - padY * 2) * (1 - (v - min) / span);
  const baseY = y(100);
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 300 }}>
        <line x1={padX} y1={baseY} x2={w - padX} y2={baseY} stroke="var(--border)" strokeDasharray="4 4" />
        <text x={padX + 2} y={baseY - 3} className="fill-[var(--faint)]" style={{ fontSize: 10 }}>基点 100</text>
        {chart.series.map((s, si) => {
          if (hidden.has(s.code)) return null;
          const color = LINE_COLORS[si % LINE_COLORS.length];
          const line = s.points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
          return <polyline key={s.code} points={line} fill="none" stroke={color} strokeWidth={1.5} />;
        })}
      </svg>
      <div className="flex flex-wrap gap-2 text-xs">
        {chart.series.map((s, si) => {
          const color = LINE_COLORS[si % LINE_COLORS.length];
          const off = hidden.has(s.code);
          const last = s.points[s.points.length - 1];
          return (
            <button
              key={s.code}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.code)) next.delete(s.code);
                  else next.add(s.code);
                  return next;
                })
              }
              className={`flex items-center gap-1.5 rounded border border-[var(--border)] px-2 py-0.5 transition ${off ? "opacity-40" : ""}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[var(--text)]">{s.name}</span>
              <span className="tabular-nums text-[var(--muted)]">{last >= 100 ? "+" : ""}{(last - 100).toFixed(1)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[var(--muted)]">载入中…</div>}>
      <CompareInner />
    </Suspense>
  );
}

function CompareInner() {
  const params = useSearchParams();
  const [codesText, setCodesText] = useState(params.get("codes")?.trim() || PRESET);
  const [activeCols, setActiveCols] = useState<string[]>(DEFAULT_COLUMNS);
  const [sortKey, setSortKey] = useState("composite");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<CompareResp | null>(null);
  const [views, setViews] = useState<CompareView[]>([]);
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);

  const codes = useMemo(
    () => Array.from(new Set(codesText.split(/[\s,，、]+/).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c)))),
    [codesText],
  );

  const run = useCallback(async (codeList: string[]) => {
    if (codeList.length === 0) {
      setError("请输入至少 1 个 6 位股票代码");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes: codeList }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResp(json as CompareResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadViews = useCallback(async () => {
    try {
      const json = await fetch("/api/compare/views").then((r) => r.json());
      setViews(json.views ?? []);
    } catch {
      setViews([]);
    }
  }, []);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  function toggleCol(key: string) {
    setActiveCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function onSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!resp) return [];
    const rows = [...resp.rows];
    rows.sort((a, b) => {
      const va = a.values[sortKey];
      const vb = b.values[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return rows;
  }, [resp, sortKey, sortDir]);

  function applyView(v: CompareView) {
    setCodesText(v.codes.join(","));
    setActiveCols(v.columns.length ? v.columns : DEFAULT_COLUMNS);
    setSortKey(v.sortKey);
    setSortDir(v.sortDir);
    setCurrentViewId(v.id);
    run(v.codes);
  }

  async function saveView(asUpdate: boolean) {
    if (codes.length === 0) {
      setError("当前没有可保存的代码");
      return;
    }
    const id = asUpdate ? currentViewId : null;
    const defName = asUpdate ? views.find((v) => v.id === id)?.name ?? "" : "";
    const name = window.prompt(asUpdate ? "更新对比视图名称" : "新对比视图名称", defName);
    if (name === null) return;
    const res = await fetch("/api/compare/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, codes, columns: activeCols, sortKey, sortDir }),
    });
    const json = await res.json();
    if (res.ok) {
      setCurrentViewId(json.view?.id ?? null);
      await loadViews();
    } else {
      setError(json.error ?? "保存失败");
    }
  }

  async function removeView(id: string) {
    if (!window.confirm("删除该对比视图？")) return;
    await fetch(`/api/compare/views?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (currentViewId === id) setCurrentViewId(null);
    await loadViews();
  }

  const shownCols = ALL_COLUMNS.filter((c) => activeCols.includes(c.key));

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">多标的横向对比</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          把任意一组标的拉到同一张表里横向对比（实时行情 + 横截面动量因子，按<strong>截面百分位</strong>着色：绿优红劣），叠加<strong>归一化价格走势</strong>（公共交易日，基点=100）。可把「对比哪些标的 + 显示哪些列 + 排序」沉淀成命名<strong>对比视图</strong>一键复原。{NFA}
        </p>
      </div>

      {/* 已存视图 */}
      {views.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 text-xs font-semibold text-[var(--muted)]">已存对比视图</div>
          <div className="flex flex-wrap gap-2">
            {views.map((v) => (
              <div
                key={v.id}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                  currentViewId === v.id ? "border-[var(--accent-line)] bg-[var(--accent-soft)]" : "border-[var(--border)]"
                }`}
              >
                <button onClick={() => applyView(v)} className="text-[var(--text)] hover:text-[var(--accent)]">
                  {v.name} <span className="text-[var(--faint)]">· {v.codes.length}只</span>
                </button>
                <button onClick={() => removeView(v.id)} className="text-[var(--faint)] hover:text-red-500" title="删除">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 输入 + 列选择 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">标的（6 位代码，逗号/空格/换行分隔，最多 30 只）· 已识别 {codes.length} 只</span>
          <textarea value={codesText} onChange={(e) => setCodesText(e.target.value)} rows={3} className={`${inputCls} font-mono`} placeholder="600519,000858,601318 ..." />
        </label>

        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">显示列</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_COLUMNS.map((c) => (
              <button
                key={c.key}
                onClick={() => toggleCol(c.key)}
                className={`rounded border px-2 py-0.5 transition ${
                  activeCols.includes(c.key)
                    ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setCurrentViewId(null); run(codes); }} disabled={loading} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {loading ? "对比中…" : "开始对比"}
          </button>
          <PoolControls codes={codes} onLoad={(c) => setCodesText(c.join(","))} />
          <div className="flex items-center gap-1.5 text-xs">
            <button onClick={() => saveView(false)} className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--muted)] hover:text-[var(--text)]">存为对比视图</button>
            {currentViewId && (
              <button onClick={() => saveView(true)} className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--muted)] hover:text-[var(--text)]">更新当前视图</button>
            )}
          </div>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {/* 对比表 */}
      {resp && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text)]">横向对比表</h2>
            <span className="text-xs text-[var(--muted)]">{resp.asOf || "—"} · {sortedRows.length} 只 · 点表头排序</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2 font-medium">代码</th>
                  <th className="px-2 py-2 font-medium">名称</th>
                  {shownCols.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => onSort(c.key)}
                      className="cursor-pointer select-none px-2 py-2 text-right font-medium hover:text-[var(--text)]"
                    >
                      {c.label}{sortKey === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.code} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1.5 font-mono"><StockLink code={r.code} newTab /></td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <FavoriteButton code={r.code} name={r.name} />
                        {r.name}
                      </span>
                    </td>
                    {shownCols.map((c) => (
                      <td key={c.key} className="px-2 py-1.5 text-right tabular-nums" style={heatStyle(r.pct[c.key])}>
                        {fmtVal(r.values[c.key], c.unit)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--faint)]">{resp.note}</p>
        </div>
      )}

      {/* 归一化走势叠加 */}
      {resp && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text)]">归一化价格走势（基点=100，公共交易日）</h2>
          <NormalizedChartView chart={resp.chart} />
        </div>
      )}
    </div>
  );
}
