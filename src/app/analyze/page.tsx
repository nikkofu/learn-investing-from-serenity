"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChokepointAssessment, StockQuote, StockSearchResult } from "@/lib/types";
import { ProgressTrace, applyStageEvent, type Stage } from "@/components/ProgressTrace";
import RadarChart from "@/components/RadarChart";
import { readNdjson } from "@/lib/stream-client";
import SharingCard from "@/components/SharingCard";

const FACTOR_LABELS: Record<string, string> = {
  demand: "确定需求",
  supply: "受限供给",
  attention: "低关注度",
  valueCapture: "价值捕获",
  catalyst: "催化剂",
};

interface AnalyzeResponse {
  quote: StockQuote;
  stats: {
    windowDays: number;
    periodReturnPct: number;
    rangePosition: number;
    avgTurnoverPct: number;
    windowHigh: number;
    windowLow: number;
  } | null;
  assessment: ChokepointAssessment;
}

type Stats = AnalyzeResponse["stats"];

const ANALYZE_STAGES: { key: string; label: string }[] = [
  { key: "quote", label: "获取行情数据（接口调用）" },
  { key: "reason", label: "AI 瓶颈点五因子推理" },
  { key: "summary", label: "结构化汇总与打分" },
];

function yi(n: number): string {
  if (!n) return "-";
  return (n / 1e8).toFixed(1) + " 亿";
}

function AnalyzeInner() {
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [content, setContent] = useState("");
  const [structured, setStructured] = useState("");
  const [preview, setPreview] = useState<{ quote: StockQuote; stats: Stats } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function analyze(code: string) {
    setLoading(true);
    setError("");
    setData(null);
    setResults([]);
    setStages(ANALYZE_STAGES.map((s) => ({ ...s, status: "pending" })));
    setReasoning("");
    setContent("");
    setStructured("");
    setPreview(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!(res.headers.get("content-type") || "").includes("ndjson")) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "分析失败");
      }
      await readNdjson(res, (ev) => {
        switch (ev.type as string) {
          case "stage":
            setStages((prev) => applyStageEvent(prev, ev.key as string, ev.status as "start" | "done"));
            break;
          case "token":
            if (ev.kind === "reasoning") setReasoning((r) => r + (ev.text as string));
            else if (ev.kind === "structured") setStructured((s) => s + (ev.text as string));
            else setContent((c) => c + (ev.text as string));
            break;
          case "quote":
            setPreview({ quote: ev.quote as StockQuote, stats: ev.stats as Stats });
            break;
          case "result":
            setData({
              quote: ev.quote as StockQuote,
              stats: ev.stats as Stats,
              assessment: ev.assessment as ChokepointAssessment,
            });
            break;
          case "error":
            setError(ev.message as string);
            break;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const code = params.get("code");
    if (!code || !/^\d{6}$/.test(code)) return;
    // Defer out of the effect body to avoid synchronous cascading setState.
    const id = setTimeout(() => {
      setQuery(code);
      analyze(code);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onQueryChange(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length < 1) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(v.trim())}`);
        const json = await res.json();
        setResults(json.results || []);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">个股瓶颈点分析</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          搜索 A 股（名称 / 代码 / 拼音），AI 按 Serenity 五因子打分并生成瓶颈点论述与风险。
        </p>
      </div>

      <div className="relative">
        <div className="flex gap-3">
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && /^\d{6}$/.test(query.trim())) analyze(query.trim());
            }}
            placeholder="如：绿的谐波 / 300308 / lxd"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--inset)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => /^\d{6}$/.test(query.trim()) && analyze(query.trim())}
            disabled={loading || !/^\d{6}$/.test(query.trim())}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "分析中…" : "分析"}
          </button>
        </div>
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
            {results.map((r) => (
              <button
                key={r.code}
                onClick={() => {
                  setQuery(r.code);
                  setResults([]);
                  analyze(r.code);
                }}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-[var(--hover)]"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 font-mono text-xs text-[var(--faint)]">{r.code}</span>
                </span>
                <span className="text-xs text-[var(--faint)]">{r.market}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{error}</p>
          {error.includes("未配置") && (
            <a href="/settings" className="mt-1 inline-block text-[var(--accent)] underline">前往「设置」配置 LLM →</a>
          )}
        </div>
      )}

      {(loading || content || reasoning || structured || stages.some((s) => s.status !== "pending")) && (
        <ProgressTrace stages={stages} reasoning={reasoning} content={content} structured={structured} running={loading} />
      )}

      {preview && !data && <PreviewCard quote={preview.quote} stats={preview.stats} />}

      {data && <Result data={data} />}
    </div>
  );
}

function PreviewCard({ quote, stats }: { quote: StockQuote; stats: Stats }) {
  const up = quote.changePct >= 0;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {quote.name} <span className="font-mono text-sm text-[var(--faint)]">{quote.code}.{quote.market}</span>
          </h2>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-2xl font-semibold">{quote.price.toFixed(2)}</span>
            <span className={up ? "text-red-400" : "text-emerald-400"}>
              {up ? "+" : ""}{quote.change.toFixed(2)} ({up ? "+" : ""}{quote.changePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <span className="text-xs text-[var(--faint)]">行情已获取，AI 评分生成中…</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="市盈率 TTM" value={quote.pe != null ? quote.pe.toFixed(1) : "-"} />
        <Stat label="市净率" value={quote.pb != null ? quote.pb.toFixed(2) : "-"} />
        <Stat label="总市值" value={yi(quote.totalMarketCap)} />
        <Stat label="换手率" value={quote.turnoverPct.toFixed(2) + "%"} />
        {stats && <Stat label={`近${stats.windowDays}日涨跌`} value={stats.periodReturnPct + "%"} />}
        {stats && <Stat label="区间位置" value={(stats.rangePosition * 100).toFixed(0) + "%"} />}
      </div>
    </div>
  );
}

function Result({ data }: { data: AnalyzeResponse }) {
  const { quote, stats, assessment } = data;
  const up = quote.changePct >= 0;
  const [showPoster, setShowPoster] = useState(false);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {quote.name} <span className="font-mono text-sm text-[var(--faint)]">{quote.code}.{quote.market}</span>
            </h2>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-2xl font-semibold">{quote.price.toFixed(2)}</span>
              <span className={up ? "text-red-400" : "text-emerald-400"}>
                {up ? "+" : ""}{quote.change.toFixed(2)} ({up ? "+" : ""}{quote.changePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPoster(true)}
              className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-fg)] hover:opacity-90 transition shadow-sm cursor-pointer"
            >
              生成社交海报
            </button>
            <ScoreBadge score={assessment.totalScore} verdict={assessment.verdict} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="市盈率 TTM" value={quote.pe != null ? quote.pe.toFixed(1) : "-"} />
          <Stat label="市净率" value={quote.pb != null ? quote.pb.toFixed(2) : "-"} />
          <Stat label="总市值" value={yi(quote.totalMarketCap)} />
          <Stat label="换手率" value={quote.turnoverPct.toFixed(2) + "%"} />
          {stats && <Stat label={`近${stats.windowDays}日涨跌`} value={stats.periodReturnPct + "%"} />}
          {stats && <Stat label="区间位置" value={(stats.rangePosition * 100).toFixed(0) + "%"} />}
          {stats && <Stat label="均换手" value={stats.avgTurnoverPct + "%"} />}
          <Stat label="更新时间" value={quote.time.slice(5)} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h3 className="mb-3 font-semibold">瓶颈点五因子打分</h3>
        <div className="grid items-center gap-6 lg:grid-cols-[320px_1fr]">
          <div className="rounded-lg bg-[var(--inset)] py-3">
            <RadarChart
              factors={assessment.factors.map((f) => ({
                label: FACTOR_LABELS[f.key] || f.key,
                score: f.score,
              }))}
            />
          </div>
          <div className="space-y-3">
            {assessment.factors.map((f) => (
              <div key={f.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-[var(--text)]">{FACTOR_LABELS[f.key] || f.key}</span>
                  <span className="font-mono text-[var(--muted)]">{f.score}/5</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--hover)]">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(f.score / 5) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{f.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h3 className="mb-2 font-semibold">Serenity 风格论述</h3>
        <p className="text-sm leading-7 text-[var(--text)]">{assessment.thesis}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ListCard title="潜在催化剂" items={assessment.catalysts} tone="emerald" />
        <ListCard title="风险点" items={assessment.risks} tone="amber" />
      </div>
      <p className="text-xs text-[var(--faint)]">
        以上由 AI 依据公开行情与 Serenity 方法生成，可能有误，仅供研究，不构成投资建议。
      </p>
      {showPoster && (
        <SharingCard
          quote={quote}
          stats={stats}
          assessment={assessment}
          onClose={() => setShowPoster(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--inset)] px-3 py-2">
      <p className="text-[11px] text-[var(--faint)]">{label}</p>
      <p className="mt-0.5 font-medium text-[var(--text)]">{value}</p>
    </div>
  );
}

function ScoreBadge({ score, verdict }: { score: number; verdict: string }) {
  const color = score >= 75 ? "text-[var(--accent)]" : score >= 55 ? "text-sky-400" : score >= 35 ? "text-amber-400" : "text-[var(--muted)]";
  return (
    <div className="text-right">
      <div className={`text-3xl font-bold ${color}`}>{score}</div>
      <p className="text-xs text-[var(--muted)]">瓶颈点综合分</p>
      <p className="mt-0.5 text-xs text-[var(--text)]">{verdict}</p>
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "emerald" | "amber" }) {
  const border = tone === "emerald" ? "border-[var(--accent-line)]" : "border-[var(--warn-line)]";
  const head = tone === "emerald" ? "text-[var(--accent)]" : "text-[var(--warn)]";
  return (
    <div className={`rounded-xl border ${border} bg-[var(--panel)] p-4`}>
      <h3 className={`mb-2 text-sm font-semibold ${head}`}>{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--text)]">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">加载中…</p>}>
      <AnalyzeInner />
    </Suspense>
  );
}
