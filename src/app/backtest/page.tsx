"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface PortfolioBar {
  date: string;
  equity: number;
  cash: number;
  positions: Record<string, { shares: number; price: number }>;
}
interface PortfolioTrade {
  date: string;
  code: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
}
interface PortfolioStats {
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  annualizedSharpe: number;
  trades: number;
  turnoverPct: number;
}
interface BacktestResult {
  config: {
    startCash: number;
    rebalanceEveryNDays: number;
    feeBps: number;
    maxPositions: number;
    minHoldBars: number;
    startDate: string;
    endDate: string;
  };
  equityCurve: PortfolioBar[];
  trades: PortfolioTrade[];
  stats: PortfolioStats;
}

const PRESET = "600519,000858,300750,600036,000333,002594,601318,600276,000651,002415";

/** A 股惯例：红涨绿跌。 */
function signClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtMoney(v: number): string {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)} 万`;
  return v.toFixed(0);
}

/** 无依赖 SVG 净值曲线：含初始资金基准线、峰值回撤阴影、起止日期标注。 */
function EquityChart({ bars, startCash }: { bars: PortfolioBar[]; startCash: number }) {
  if (!bars || bars.length < 2) return <div className="h-64" />;
  const w = 900;
  const h = 280;
  const padX = 8;
  const padY = 14;
  const eqs = bars.map((b) => b.equity);
  const min = Math.min(...eqs, startCash);
  const max = Math.max(...eqs, startCash);
  const span = max - min || 1;
  const stepX = (w - padX * 2) / (bars.length - 1);
  const x = (i: number) => padX + i * stepX;
  const y = (v: number) => padY + (h - padY * 2) * (1 - (v - min) / span);
  const line = bars.map((b, i) => `${x(i).toFixed(1)},${y(b.equity).toFixed(1)}`).join(" ");
  const baseY = y(startCash);
  const last = bars[bars.length - 1].equity;
  const up = last >= startCash;
  const stroke = up ? "#f43f5e" : "#10b981";
  const area = `${padX},${(h - padY).toFixed(1)} ${line} ${(w - padX).toFixed(1)},${(h - padY).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="组合净值曲线">
      <polygon points={area} style={{ fill: stroke, opacity: 0.08 }} />
      <line
        x1={padX}
        y1={baseY}
        x2={w - padX}
        y2={baseY}
        style={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }}
      />
      <text x={padX + 2} y={baseY - 4} fontSize={11} style={{ fill: "var(--faint)" }}>
        初始 {fmtMoney(startCash)}
      </text>
      <polyline
        points={line}
        style={{ fill: "none", stroke, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }}
      />
      <text x={padX} y={h - 2} fontSize={11} style={{ fill: "var(--faint)" }}>
        {bars[0].date}
      </text>
      <text x={w - padX} y={h - 2} fontSize={11} textAnchor="end" style={{ fill: "var(--faint)" }}>
        {bars[bars.length - 1].date}
      </text>
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

export default function BacktestPage() {
  const [codesText, setCodesText] = useState(PRESET);
  const [startCash, setStartCash] = useState(1_000_000);
  const [maxPositions, setMaxPositions] = useState(5);
  const [rebalanceEveryNDays, setRebalanceEveryNDays] = useState(5);
  const [feeBps, setFeeBps] = useState(30);
  const [limit, setLimit] = useState(400);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

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
    if (codes.length === 0) {
      setError("请输入至少 1 个 6 位股票代码");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/backtest/portfolio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes, startCash, maxPositions, rebalanceEveryNDays, feeBps, limit }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResult(json as BacktestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="mb-2 flex gap-2 text-xs">
          <span className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent)]">
            组合回测
          </span>
          <Link href="/backtest/strategy" className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
            建议忠实回测（胜率证明）
          </Link>
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)]">组合回测</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          给定股票池，按价格动量截面排名每 N 个交易日轮动等权持有 top-K，含手续费与 A 股涨跌停撮合约束（涨停买不进、跌停卖不出）。仅供研究，不构成投资建议。
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">股票池（6 位代码，逗号/空格/换行分隔）· 已识别 {codes.length} 只</span>
          <textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            rows={3}
            className={`${inputCls} font-mono`}
            placeholder="600519,000858,300750 ..."
          />
        </label>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">初始资金（元）</span>
            <input type="number" min={10000} step={10000} value={startCash} onChange={(e) => setStartCash(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">最大持仓（只）</span>
            <input type="number" min={1} max={50} value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">再平衡间隔（交易日）</span>
            <input type="number" min={1} max={60} value={rebalanceEveryNDays} onChange={(e) => setRebalanceEveryNDays(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单边手续费（bps）</span>
            <input type="number" min={0} max={200} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单只取 K 根数</span>
            <input type="number" min={60} max={800} step={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "回测中…" : "运行回测"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="总收益" value={fmtPct(result.stats.totalReturnPct)} cls={signClass(result.stats.totalReturnPct)} />
            <StatCard label="年化(CAGR)" value={fmtPct(result.stats.cagrPct)} cls={signClass(result.stats.cagrPct)} />
            <StatCard label="最大回撤" value={`-${result.stats.maxDrawdownPct.toFixed(2)}%`} cls="text-amber-500" />
            <StatCard label="年化夏普" value={result.stats.annualizedSharpe.toFixed(2)} />
            <StatCard label="换手率" value={`${result.stats.turnoverPct.toFixed(0)}%`} />
            <StatCard label="成交笔数" value={String(result.stats.trades)} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)]">净值曲线</h2>
              <span className="text-xs text-[var(--muted)]">
                {result.config.startDate} → {result.config.endDate} · {result.equityCurve.length} 个交易日 · 等权 top-{result.config.maxPositions}
              </span>
            </div>
            <EquityChart bars={result.equityCurve} startCash={result.config.startCash} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)]">交易流水</h2>
              <span className="text-xs text-[var(--muted)]">共 {result.trades.length} 笔（最新在前，最多显示 200）</span>
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">日期</th>
                    <th className="px-3 py-2 font-medium">代码</th>
                    <th className="px-3 py-2 font-medium">方向</th>
                    <th className="px-3 py-2 text-right font-medium">股数</th>
                    <th className="px-3 py-2 text-right font-medium">价格</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.trades]
                    .reverse()
                    .slice(0, 200)
                    .map((t, i) => (
                      <tr key={i} className="border-t border-[var(--border)]">
                        <td className="px-3 py-1.5 tabular-nums text-[var(--faint)]">{t.date}</td>
                        <td className="px-3 py-1.5 font-mono">{t.code}</td>
                        <td className={`px-3 py-1.5 ${t.side === "buy" ? "text-rose-500" : "text-emerald-500"}`}>
                          {t.side === "buy" ? "买入" : "卖出"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{t.shares}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{t.price.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
