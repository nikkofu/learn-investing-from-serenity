"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChokepointAssessment, StockQuote, StockSearchResult } from "@/lib/types";

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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function analyze(code: string) {
    setLoading(true);
    setError("");
    setData(null);
    setResults([]);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "分析失败");
      setData(json);
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
        <p className="mt-1 text-sm text-zinc-400">
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
            className="flex-1 rounded-lg border border-white/15 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-emerald-500/60"
          />
          <button
            onClick={() => /^\d{6}$/.test(query.trim()) && analyze(query.trim())}
            disabled={loading || !/^\d{6}$/.test(query.trim())}
            className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? "分析中…" : "分析"}
          </button>
        </div>
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/15 bg-[#11161f] shadow-xl">
            {results.map((r) => (
              <button
                key={r.code}
                onClick={() => {
                  setQuery(r.code);
                  setResults([]);
                  analyze(r.code);
                }}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-white/5"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 font-mono text-xs text-zinc-500">{r.code}</span>
                </span>
                <span className="text-xs text-zinc-500">{r.market}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {data && <Result data={data} />}
    </div>
  );
}

function Result({ data }: { data: AnalyzeResponse }) {
  const { quote, stats, assessment } = data;
  const up = quote.changePct >= 0;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {quote.name} <span className="font-mono text-sm text-zinc-500">{quote.code}.{quote.market}</span>
            </h2>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-2xl font-semibold">{quote.price.toFixed(2)}</span>
              <span className={up ? "text-red-400" : "text-emerald-400"}>
                {up ? "+" : ""}{quote.change.toFixed(2)} ({up ? "+" : ""}{quote.changePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <ScoreBadge score={assessment.totalScore} verdict={assessment.verdict} />
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

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-3 font-semibold">瓶颈点五因子打分</h3>
        <div className="space-y-3">
          {assessment.factors.map((f) => (
            <div key={f.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-zinc-200">{FACTOR_LABELS[f.key] || f.key}</span>
                <span className="font-mono text-zinc-400">{f.score}/5</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(f.score / 5) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{f.rationale}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-2 font-semibold">Serenity 风格论述</h3>
        <p className="text-sm leading-7 text-zinc-200">{assessment.thesis}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ListCard title="潜在催化剂" items={assessment.catalysts} tone="emerald" />
        <ListCard title="风险点" items={assessment.risks} tone="amber" />
      </div>
      <p className="text-xs text-zinc-500">
        以上由 AI 依据公开行情与 Serenity 方法生成，可能有误，仅供研究，不构成投资建议。
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="mt-0.5 font-medium text-zinc-100">{value}</p>
    </div>
  );
}

function ScoreBadge({ score, verdict }: { score: number; verdict: string }) {
  const color = score >= 75 ? "text-emerald-400" : score >= 55 ? "text-sky-400" : score >= 35 ? "text-amber-400" : "text-zinc-400";
  return (
    <div className="text-right">
      <div className={`text-3xl font-bold ${color}`}>{score}</div>
      <p className="text-xs text-zinc-400">瓶颈点综合分</p>
      <p className="mt-0.5 text-xs text-zinc-300">{verdict}</p>
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "emerald" | "amber" }) {
  const border = tone === "emerald" ? "border-emerald-500/20" : "border-amber-500/20";
  const head = tone === "emerald" ? "text-emerald-300" : "text-amber-300";
  return (
    <div className={`rounded-xl border ${border} bg-white/[0.02] p-4`}>
      <h3 className={`mb-2 text-sm font-semibold ${head}`}>{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-300">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">加载中…</p>}>
      <AnalyzeInner />
    </Suspense>
  );
}
