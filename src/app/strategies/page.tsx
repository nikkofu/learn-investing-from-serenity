"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface StrategyMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  tags?: string[];
}
interface TrackRecord {
  meta: StrategyMeta;
  rank: number;
  sampleStocks: number;
  totalTrades: number;
  avgWinRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  avgSharpe: number;
  profitFactor: number;
  beatBuyHold: number;
  beatBuyHoldPct: number;
  avgExcessPct: number;
  score: number;
  grade: "A" | "B" | "C" | "D";
  stars: number;
  assessment: string;
  pros: string[];
  cons: string[];
}
interface Leaderboard {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  universe: { code: string; name: string }[];
  neutralScore: number;
  records: TrackRecord[];
  note: string;
}

function signClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}
function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

const GRADE_STYLE: Record<string, string> = {
  A: "bg-amber-400/15 text-amber-500 border-amber-400/40",
  B: "bg-sky-400/15 text-sky-500 border-sky-400/40",
  C: "bg-slate-400/15 text-slate-400 border-slate-400/40",
  D: "bg-rose-400/10 text-rose-400/80 border-rose-400/30",
};
const RANK_MEDAL = ["🥇", "🥈", "🥉"];

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-400" title={`${n} / 5`}>
      {"★".repeat(n)}
      <span className="text-[var(--border)]">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${cls ?? "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

function StrategyCard({ r }: { r: TrackRecord }) {
  const top = r.rank === 1;
  return (
    <div
      className={`rounded-2xl border p-5 transition ${
        top ? "border-amber-400/50 bg-amber-400/[0.04] shadow-sm" : "border-[var(--border)] bg-[var(--card)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--bg)] text-lg font-bold tabular-nums">
            {RANK_MEDAL[r.rank - 1] ?? r.rank}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--text)]">{r.meta.name}</h3>
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                v{r.meta.version}
              </span>
              {r.meta.tags?.includes("default") && (
                <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">默认</span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <Stars n={r.stars} />
              <span className="text-[var(--muted)]">综合分 {r.score}</span>
            </div>
          </div>
        </div>
        <div className={`grid h-12 w-12 place-items-center rounded-xl border text-2xl font-black ${GRADE_STYLE[r.grade]}`} title="综合评级">
          {r.grade}
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{r.meta.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="平均胜率" value={`${r.avgWinRatePct.toFixed(0)}%`} />
        <Metric
          label="盈亏比"
          value={r.profitFactor >= 99 ? "∞" : r.profitFactor.toFixed(2)}
          cls={r.profitFactor >= 1 ? "text-rose-500" : "text-emerald-500"}
        />
        <Metric label="夏普" value={r.avgSharpe.toFixed(2)} cls={signClass(r.avgSharpe)} />
        <Metric label="平均收益" value={fmtPct(r.avgReturnPct)} cls={signClass(r.avgReturnPct)} />
        <Metric label="超额(α)" value={fmtPct(r.avgExcessPct)} cls={signClass(r.avgExcessPct)} />
        <Metric label="跑赢持有" value={`${r.beatBuyHold}/${r.sampleStocks}`} />
        <Metric label="完成交易" value={`${r.totalTrades} 笔`} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold text-emerald-500">优势</div>
          <ul className="space-y-1 text-sm text-[var(--muted)]">
            {r.pros.length ? r.pros.map((p, i) => <li key={i}>· {p}</li>) : <li>· —</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-rose-500">短板</div>
          <ul className="space-y-1 text-sm text-[var(--muted)]">
            {r.cons.length ? r.cons.map((c, i) => <li key={i}>· {c}</li>) : <li>· —</li>}
          </ul>
        </div>
      </div>

      <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm leading-6 text-[var(--text)]">
        <span className="mr-1 text-[var(--muted)]">点评：</span>
        {r.assessment}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/backtest/strategy"
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          多股票池实测 →
        </Link>
        <Link
          href="/analyze"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)]"
        >
          单票分析切换此策略
        </Link>
      </div>
    </div>
  );
}

export default function StrategyMarketPage() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/strategies/leaderboard${force ? "?force=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBoard(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">策略市场</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            所有已登记策略在同一代表性 A 股篮子上的真实战绩榜单 · 客观评级 · 一键切换实测
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)] disabled:opacity-50"
        >
          {loading ? "回测中…" : "重新回测"}
        </button>
      </div>

      {board && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
          <span>样本：{board.universe.length} 只</span>
          <span>窗口：{board.windowStart} ~ {board.windowEnd}</span>
          <span>中性基本面分：{board.neutralScore}</span>
          <span>更新：{new Date(board.asOf).toLocaleString("zh-CN")}</span>
        </div>
      )}

      {loading && !board && (
        <div className="mt-10 grid place-items-center rounded-2xl border border-dashed border-[var(--border)] py-20 text-sm text-[var(--muted)]">
          正在对代表性篮子批量取 K 并回测全部策略，首次约需 10–30 秒…
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-[var(--text)]">
          榜单加载失败：{error}
          <button onClick={() => load(true)} className="ml-2 underline">
            重试
          </button>
        </div>
      )}

      {board && (
        <>
          <div className="mt-6 space-y-4">
            {board.records.map((r) => (
              <StrategyCard key={r.meta.id} r={r} />
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-xs leading-6 text-[var(--muted)]">
            <div className="mb-1 font-semibold text-[var(--text)]">榜单口径说明</div>
            {board.note}
            <div className="mt-2">
              评级口径：综合分 = 胜率 28% + 盈亏比 27% + 夏普 20% + 平均收益 15% + 跑赢买入持有 10%；A≥62 / B≥50 / C≥38 / D&lt;38（侧重每次出手的质量，弱化受牛熊主导的跑赢买入持有项）。
              想用自定义股票池验证某策略「照建议买卖是否有较大胜率」，请到
              <Link href="/backtest/strategy" className="mx-1 text-[var(--accent)] underline">
                建议忠实回测
              </Link>
              页跑多股票池 + 显著性检验。
            </div>
          </div>
        </>
      )}
    </main>
  );
}
