"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StockLink from "@/components/StockLink";

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

// ── v0.34 沉淀策略（配对均值回归） ──────────────────────────────────────────────

interface PairTrackRecord {
  signals: number;
  reversionRatePct: number;
  avgRevertDays: number;
  avgLegReturnPct: number;
  legWinRatePct: number;
  avgMaxAdverseZ: number;
  stopouts: number;
  timeouts: number;
  asOf: string | null;
}
interface PairLiveSignal {
  z: number;
  side: "long-spread" | "short-spread";
  deviation: number;
  nearStop: boolean;
  expectedRevertDays: number;
  estNetPct: number;
  buyCode: string;
  deRiskCode: string;
  asOf: string;
}
interface SavedStrategy {
  id: string;
  name: string;
  kind: "arb-pair";
  source: string;
  note?: string;
  pair: { a: string; b: string; aName: string; bName: string; beta: number; adfT: number; halfLifeDays: number; correlation: number; n: number };
  params: { lookback: number; entryZ: number; exitZ: number; stopZ: number; feeBps: number; maxHoldDays: number };
  snapshot: PairTrackRecord;
  score: { score: number; grade: "A" | "B" | "C" | "D"; stars: number };
  latest: (PairTrackRecord & { live: PairLiveSignal | null; checkedAt: string }) | null;
  createdAt: string;
  updatedAt: string;
}

function SavedStrategyCard({
  s,
  busy,
  onRevalidate,
  onDelete,
  onExport,
}: {
  s: SavedStrategy;
  busy: boolean;
  onRevalidate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const m = s.latest ?? s.snapshot;
  const live = s.latest?.live ?? null;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">👤 沉淀策略</span>
            <h3 className="text-base font-semibold text-[var(--text)]">{s.name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 font-mono">
              <StockLink code={s.pair.a} newTab />
              <span className="text-[var(--muted)]">↔</span>
              <StockLink code={s.pair.b} newTab />
            </span>
            <Stars n={s.score.stars} />
            <span className="text-[var(--muted)]">综合分 {s.score.score}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {live ? (
            <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${live.nearStop ? "border-rose-500/40 bg-rose-500/10 text-rose-500" : "border-amber-400/40 bg-amber-400/10 text-amber-500"}`} title="复检时当前存在开口信号">
              {live.nearStop ? "逼近止损" : "当前开口"} |z|={live.deviation} · 买 <span className="font-mono">{live.buyCode}</span>
            </span>
          ) : s.latest ? (
            <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">复检：未开口</span>
          ) : (
            <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">未复检</span>
          )}
          <div className={`grid h-10 w-10 place-items-center rounded-xl border text-xl font-black ${GRADE_STYLE[s.score.grade]}`} title="评级">
            {s.score.grade}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="信号数" value={`${m.signals}`} />
        <Metric label="回归率" value={`${m.reversionRatePct}%`} cls={m.reversionRatePct >= 60 ? "text-emerald-500" : m.reversionRatePct >= 40 ? "text-amber-500" : "text-rose-500"} />
        <Metric label="单边胜率" value={`${m.legWinRatePct}%`} cls={m.legWinRatePct >= 50 ? "text-emerald-500" : "text-rose-500"} />
        <Metric label="单边净收益(均)" value={fmtPct(m.avgLegReturnPct)} cls={m.avgLegReturnPct > 0 ? "text-emerald-500" : "text-rose-500"} />
        <Metric label="平均回归天数" value={`${m.avgRevertDays} 日`} />
        <Metric label="最大逆向z(均)" value={`${m.avgMaxAdverseZ}`} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>β={s.pair.beta.toFixed(3)}</span>
        <span>ADF t={s.pair.adfT.toFixed(2)}</span>
        <span>半衰期 {s.pair.halfLifeDays} 日</span>
        <span>参数 entryZ {s.params.entryZ} / exitZ {s.params.exitZ} / stopZ {s.params.stopZ}</span>
        <span>数据截至 {m.asOf ?? "—"}</span>
        {s.latest && <span>上次复检 {new Date(s.latest.checkedAt).toLocaleString("zh-CN")}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onRevalidate} disabled={busy} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? "复检中…" : "复检（拉最新 K 重算）"}
        </button>
        <Link href={`/arb?codes=${s.pair.a},${s.pair.b}&entryZ=${s.params.entryZ}&stopZ=${s.params.stopZ}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)]">
          在套利雷达打开
        </Link>
        <button onClick={onExport} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)]">
          导出（复制 JSON）
        </button>
        <button onClick={onDelete} disabled={busy} className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-50">
          删除
        </button>
      </div>
    </div>
  );
}

function SavedStrategiesSection() {
  const [list, setList] = useState<SavedStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/strategies/saved");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setList(data.strategies as SavedStrategy[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revalidate(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/strategies/saved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revalidate", id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setList((cur) => cur.map((s) => (s.id === id ? (data.strategy as SavedStrategy) : s)));
    } catch (e) {
      setNotice(`复检失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/strategies/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setList((cur) => cur.filter((s) => s.id !== id));
    } catch (e) {
      setNotice(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function exportOne(s: SavedStrategy) {
    const json = JSON.stringify(s, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setNotice(`已复制「${s.name}」的 JSON 到剪贴板，可发给他人导入。`);
    } catch {
      setNotice(json);
    }
  }

  async function doImport() {
    setNotice(null);
    try {
      const parsed = JSON.parse(importText);
      const res = await fetch("/api/strategies/saved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import", json: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setImportText("");
      setImportOpen(false);
      await load();
      setNotice("导入成功。");
    } catch (e) {
      setNotice(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">👤 我的沉淀策略（配对均值回归）</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            从套利雷达「信号回测校准」沉淀的验证过配对，可随时复检是否仍成立·可导出/导入分享
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen((v) => !v)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)]">
            {importOpen ? "取消导入" : "导入策略"}
          </button>
          <button onClick={load} disabled={loading} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:bg-[var(--hover)] disabled:opacity-50">
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </div>

      {importOpen && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="粘贴导出的策略 JSON…"
            className="h-32 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs"
          />
          <button onClick={doImport} disabled={!importText.trim()} className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            导入
          </button>
        </div>
      )}

      {notice && <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm text-[var(--text)]">{notice}</div>}
      {err && <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-[var(--text)]">加载失败：{err}</div>}

      {!loading && list.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          还没有沉淀策略。去
          <Link href="/arb" className="mx-1 text-[var(--accent)] underline">套利雷达</Link>
          跑「信号回测校准」，在表里点「沉淀为策略」即可。
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {list.map((s) => (
            <SavedStrategyCard
              key={s.id}
              s={s}
              busy={busyId === s.id}
              onRevalidate={() => revalidate(s.id)}
              onDelete={() => remove(s.id)}
              onExport={() => exportOne(s)}
            />
          ))}
        </div>
      )}
    </section>
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
    <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
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

      <SavedStrategiesSection />

      {board && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-[var(--text)]">内置策略排行榜（单票买卖）</h2>
          <div className="mt-4 space-y-4">
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
