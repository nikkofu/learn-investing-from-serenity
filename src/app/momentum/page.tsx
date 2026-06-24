"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import StockLink from "@/components/StockLink";
import FavoriteButton from "@/components/FavoriteButton";
import PoolControls from "@/components/PoolControls";
import { NFA } from "@/lib/disclaimers";

// ── 类型（与 /api/momentum/* 返回对齐）──────────────────────────────────────
interface MomentumFactors {
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  skip: number | null;
  vol: number | null;
  riskAdj: number | null;
  trend: number | null;
}
interface ScoredStock {
  code: string;
  name: string;
  composite: number;
  factors: MomentumFactors;
}
interface RankResp {
  ranked: ScoredStock[];
  universe: { requested: number; eligible: number };
}
interface SectorMomentum {
  code: string;
  name: string;
  stockCount: number;
  avgComposite: number;
  breadthPct: number;
  avgR3mPct: number;
  topStocks: Array<{ code: string; name: string; composite: number }>;
}
interface SectorsResp {
  sectors: SectorMomentum[];
  sectorCount: number;
}
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
interface BacktestResp {
  mode: "momentum" | "sectorRotation";
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
  stats: {
    totalReturnPct: number;
    cagrPct: number;
    maxDrawdownPct: number;
    annualizedSharpe: number;
    trades: number;
    turnoverPct: number;
  };
}

const PRESET =
  "600519,000858,300750,600036,000333,002594,601318,600276,000651,002415,600900,601012,002475,300059,600887,000001,601888,600309,002714,300760";

// ── 工具 ────────────────────────────────────────────────────────────────────
function signClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}
function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtPctRaw(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}
function fmtMoney(v: number): string {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)} 万`;
  return v.toFixed(0);
}
function fmtScore(v: number): string {
  return (v * 100).toFixed(1);
}

/** 无依赖 SVG 净值曲线（含初始资金基准线）。 */
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
      <line x1={padX} y1={baseY} x2={w - padX} y2={baseY} style={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }} />
      <text x={padX + 2} y={baseY - 4} fontSize={11} style={{ fill: "var(--faint)" }}>初始 {fmtMoney(startCash)}</text>
      <polyline points={line} style={{ fill: "none", stroke, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
      <text x={padX} y={h - 2} fontSize={11} style={{ fill: "var(--faint)" }}>{bars[0].date}</text>
      <text x={w - padX} y={h - 2} fontSize={11} textAnchor="end" style={{ fill: "var(--faint)" }}>{bars[bars.length - 1].date}</text>
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

const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums";

type Tab = "rank" | "sectors" | "backtest";

export default function MomentumPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[var(--muted)]">载入中…</div>}>
      <MomentumInner />
    </Suspense>
  );
}

function MomentumInner() {
  const params = useSearchParams();
  const initialCodes = params.get("codes")?.trim() || PRESET;
  const initialLimit = Number(params.get("limit")) || 280;
  const [tab, setTab] = useState<Tab>("rank");
  return (
    <div className="w-full space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {([
            ["rank", "个股动量榜"],
            ["sectors", "行业轮动信号"],
            ["backtest", "纯多头回测"],
          ] as Array<[Tab, string]>).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                tab === k
                  ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)]">横截面动量 / 行业轮动</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          主板个股多因子动量打分（近 1/3/6 月收益、12-1 动量、风险调整、趋势）、行业轮动信号、以及按动量截面排名轮动的<strong>纯多头</strong>组合回测（只买不做空，含手续费与 A 股涨跌停撮合约束）。{NFA}
        </p>
      </div>

      {tab === "rank" && <RankTab initialCodes={initialCodes} initialLimit={initialLimit} />}
      {tab === "sectors" && <SectorsTab />}
      {tab === "backtest" && <BacktestTab initialCodes={initialCodes} />}
    </div>
  );
}

// ── Tab 1：个股动量榜 ────────────────────────────────────────────────────────
function RankTab({ initialCodes, initialLimit }: { initialCodes: string; initialLimit: number }) {
  const [codesText, setCodesText] = useState(initialCodes);
  const [limit, setLimit] = useState(initialLimit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<RankResp | null>(null);

  const codes = useMemo(
    () => Array.from(new Set(codesText.split(/[\s,，、]+/).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c)))),
    [codesText],
  );

  async function run() {
    if (codes.length === 0) {
      setError("请输入至少 1 个 6 位股票代码");
      return;
    }
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const res = await fetch("/api/momentum/rank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes, limit }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResp(json as RankResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">股票池（6 位代码，逗号/空格/换行分隔）· 已识别 {codes.length} 只</span>
          <textarea value={codesText} onChange={(e) => setCodesText(e.target.value)} rows={3} className={`${inputCls} font-mono`} placeholder="600519,000858,300750 ..." />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单只取 K 根数</span>
            <input type="number" min={70} max={400} step={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={loading} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {loading ? "打分中…" : "动量打分"}
          </button>
          <PoolControls
            codes={codes}
            onLoad={(c) => setCodesText(c.join(","))}
            screen={{ scope: "momentum", params: { codes: codes.join(","), limit } }}
          />
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {resp && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text)]">动量排名</h2>
            <span className="text-xs text-[var(--muted)]">主板有效 {resp.universe.eligible} / 输入 {resp.universe.requested} 只</span>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">代码</th>
                  <th className="px-2 py-2 font-medium">名称</th>
                  <th className="px-2 py-2 text-right font-medium">动量分</th>
                  <th className="px-2 py-2 text-right font-medium">近1月</th>
                  <th className="px-2 py-2 text-right font-medium">近3月</th>
                  <th className="px-2 py-2 text-right font-medium">近6月</th>
                  <th className="px-2 py-2 text-right font-medium">趋势</th>
                  <th className="px-2 py-2 text-right font-medium">年化波动</th>
                </tr>
              </thead>
              <tbody>
                {resp.ranked.map((s, i) => (
                  <tr key={s.code} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1.5 tabular-nums text-[var(--faint)]">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono"><StockLink code={s.code} newTab /></td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <FavoriteButton code={s.code} name={s.name} />
                        {s.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtScore(s.composite)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${signClass(s.factors.r1m ?? 0)}`}>{fmtPctRaw(s.factors.r1m)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${signClass(s.factors.r3m ?? 0)}`}>{fmtPctRaw(s.factors.r3m)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${signClass(s.factors.r6m ?? 0)}`}>{fmtPctRaw(s.factors.r6m)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${signClass(s.factors.trend ?? 0)}`}>{fmtPctRaw(s.factors.trend)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[var(--muted)]">{fmtPctRaw(s.factors.vol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2：行业轮动信号 ──────────────────────────────────────────────────────
function SectorsTab() {
  const [maxStocksPerSector, setMaxStocksPerSector] = useState(15);
  const [limit, setLimit] = useState(280);
  const [topN, setTopN] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<SectorsResp | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const res = await fetch("/api/momentum/sectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxStocksPerSector, limit, topN }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResp(json as SectorsResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单板块取成分股（只）</span>
            <input type="number" min={1} max={80} value={maxStocksPerSector} onChange={(e) => setMaxStocksPerSector(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单只取 K 根数</span>
            <input type="number" min={70} max={400} step={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">显示前 N 板块</span>
            <input type="number" min={1} max={100} value={topN} onChange={(e) => setTopN(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={run} disabled={loading} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {loading ? "计算中…（拉取全市场 K 线，约需数十秒）" : "计算行业轮动信号"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {resp && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text)]">板块动量排名</h2>
            <span className="text-xs text-[var(--muted)]">共 {resp.sectorCount} 个板块（按合成动量从强到弱）</span>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">板块</th>
                  <th className="px-2 py-2 text-right font-medium">动量分</th>
                  <th className="px-2 py-2 text-right font-medium">宽度</th>
                  <th className="px-2 py-2 text-right font-medium">近3月均收益</th>
                  <th className="px-2 py-2 text-right font-medium">成分股</th>
                  <th className="px-2 py-2 font-medium">龙头（动量最强）</th>
                </tr>
              </thead>
              <tbody>
                {resp.sectors.map((s, i) => (
                  <tr key={s.code} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1.5 tabular-nums text-[var(--faint)]">{i + 1}</td>
                    <td className="px-2 py-1.5"><span className="font-medium">{s.name}</span> <span className="text-xs text-[var(--faint)]">{s.code}</span></td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtScore(s.avgComposite)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[var(--muted)]">{s.breadthPct.toFixed(0)}%</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${signClass(s.avgR3mPct)}`}>{fmtPct(s.avgR3mPct)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[var(--muted)]">{s.stockCount}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {s.topStocks.map((t) => (
                          <span key={t.code} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs">
                            <StockLink code={t.code} newTab /> <span className="text-[var(--faint)]">{t.name}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3：纯多头回测 ────────────────────────────────────────────────────────
function BacktestTab({ initialCodes }: { initialCodes: string }) {
  const [mode, setMode] = useState<"momentum" | "sectorRotation">("momentum");
  const [codesText, setCodesText] = useState(initialCodes);
  const [sectorsText, setSectorsText] = useState("");
  const [topSectors, setTopSectors] = useState(3);
  const [maxStocksPerSector, setMaxStocksPerSector] = useState(15);
  const [startCash, setStartCash] = useState(1_000_000);
  const [maxPositions, setMaxPositions] = useState(10);
  const [rebalanceEveryNDays, setRebalanceEveryNDays] = useState(5);
  const [feeBps, setFeeBps] = useState(30);
  const [limit, setLimit] = useState(400);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<BacktestResp | null>(null);

  const codes = useMemo(
    () => Array.from(new Set(codesText.split(/[\s,，、]+/).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c)))),
    [codesText],
  );
  const sectors = useMemo(
    () => Array.from(new Set(sectorsText.split(/[\s,，、]+/).map((c) => c.trim()).filter((c) => /^BK\d+$/.test(c)))),
    [sectorsText],
  );

  async function run() {
    if (mode === "momentum" && codes.length === 0) {
      setError("请输入至少 1 个 6 位股票代码");
      return;
    }
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const body =
        mode === "momentum"
          ? { mode, codes, startCash, maxPositions, rebalanceEveryNDays, feeBps, limit }
          : { mode, sectors, topSectors, maxStocksPerSector, startCash, maxPositions, rebalanceEveryNDays, feeBps, limit };
      const res = await fetch("/api/momentum/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResp(json as BacktestResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <div className="flex gap-2 text-xs">
          {([
            ["momentum", "个股动量"],
            ["sectorRotation", "行业轮动"],
          ] as Array<["momentum" | "sectorRotation", string]>).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`rounded-md px-3 py-1 transition ${
                mode === k
                  ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "momentum" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">股票池（6 位代码）· 已识别 {codes.length} 只</span>
            <textarea value={codesText} onChange={(e) => setCodesText(e.target.value)} rows={3} className={`${inputCls} font-mono`} />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">板块代码 BK（留空=全部本地板块）· 已识别 {sectors.length} 个</span>
            <textarea value={sectorsText} onChange={(e) => setSectorsText(e.target.value)} rows={2} className={`${inputCls} font-mono`} placeholder="留空则评估全部本地板块；或如 BK1625,BK1435" />
          </label>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {mode === "sectorRotation" && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">每期持有板块数</span>
                <input type="number" min={1} max={20} value={topSectors} onChange={(e) => setTopSectors(Number(e.target.value))} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">单板块成分股</span>
                <input type="number" min={1} max={80} value={maxStocksPerSector} onChange={(e) => setMaxStocksPerSector(Number(e.target.value))} className={inputCls} />
              </label>
            </>
          )}
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

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={loading} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {loading ? "回测中…" : "运行纯多头回测"}
          </button>
          {mode === "momentum" && (
            <PoolControls codes={codes} onLoad={(c) => setCodesText(c.join(","))} />
          )}
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {resp && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="总收益" value={fmtPct(resp.stats.totalReturnPct)} cls={signClass(resp.stats.totalReturnPct)} />
            <StatCard label="年化(CAGR)" value={fmtPct(resp.stats.cagrPct)} cls={signClass(resp.stats.cagrPct)} />
            <StatCard label="最大回撤" value={`-${resp.stats.maxDrawdownPct.toFixed(2)}%`} cls="text-amber-500" />
            <StatCard label="年化夏普" value={resp.stats.annualizedSharpe.toFixed(2)} />
            <StatCard label="换手率" value={`${resp.stats.turnoverPct.toFixed(0)}%`} />
            <StatCard label="成交笔数" value={String(resp.stats.trades)} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)]">净值曲线</h2>
              <span className="text-xs text-[var(--muted)]">
                {resp.config.startDate} → {resp.config.endDate} · {resp.equityCurve.length} 个交易日 · {resp.mode === "momentum" ? "个股动量" : "行业轮动"} · 等权 top-{resp.config.maxPositions}
              </span>
            </div>
            <EquityChart bars={resp.equityCurve} startCash={resp.config.startCash} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)]">交易流水</h2>
              <span className="text-xs text-[var(--muted)]">共 {resp.trades.length} 笔（最新在前，最多显示 200）</span>
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
                  {[...resp.trades].reverse().slice(0, 200).map((t, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-3 py-1.5 tabular-nums text-[var(--faint)]">{t.date}</td>
                      <td className="px-3 py-1.5 font-mono"><StockLink code={t.code} newTab /></td>
                      <td className={`px-3 py-1.5 ${t.side === "buy" ? "text-rose-500" : "text-emerald-500"}`}>{t.side === "buy" ? "买入" : "卖出"}</td>
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
