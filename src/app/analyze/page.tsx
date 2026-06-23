"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChokepointAssessment, StockQuote, StockSearchResult } from "@/lib/types";
import { ProgressTrace, applyStageEvent, type Stage } from "@/components/ProgressTrace";
import RadarChart from "@/components/RadarChart";
import QuantChart from "@/components/QuantChart";
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
  matchedKnowledge?: {
    themeName: string;
    themeThesis: string;
    tweets: { date: string; text: string }[];
  } | null;
  quant?: any;
  calibration?: CalibrationSummary | null;
  cache?: {
    hit: boolean;
    createdAt: number;
    ttlMs: number;
    positioning: string;
  };
  timings?: {
    quoteMs: number;
    reasonMs: number;
    summaryMs: number;
    totalMs: number;
  };
}

interface CalibrationSummary {
  total: number;
  resolved: number;
  pending: number;
  brier: number | null;
  hitRate: number | null;
  reliability: { lo: number; hi: number; count: number; avgConfidence: number; observedFreq: number }[];
  note: string;
}

type Stats = AnalyzeResponse["stats"];

const ANALYZE_STAGES: { key: string; label: string }[] = [
  { key: "quote", label: "获取行情数据（接口调用）" },
  { key: "reason", label: "AI 瓶颈点五因子推理" },
  { key: "summary", label: "结构化汇总与打分" },
  { key: "vote", label: "自洽投票（多次打分取中位降方差）" },
  { key: "critic", label: "批判者复核（证伪 / 反方尽调）" },
  { key: "judge", label: "裁判调和（最终结论与置信度）" },
];

function yi(n: number): string {
  if (!n) return "-";
  return (n / 1e8).toFixed(1) + " 亿";
}

interface RecentStock {
  code: string;
  name: string;
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
  const [retryCount, setRetryCount] = useState(1);
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("serenity_recent_stocks");
    if (stored) {
      try {
        setRecentStocks(JSON.parse(stored));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const saveToRecent = (code: string, name: string) => {
    if (!code || !name) return;
    setRecentStocks((prev) => {
      const filtered = prev.filter((item) => item.code !== code);
      const updated = [{ code, name }, ...filtered].slice(0, 10);
      localStorage.setItem("serenity_recent_stocks", JSON.stringify(updated));
      return updated;
    });
  };

  const clearRecent = () => {
    localStorage.removeItem("serenity_recent_stocks");
    setRecentStocks([]);
  };

  async function analyze(code: string, attempt = 1, refresh = false) {
    setLoading(true);
    setRetryCount(attempt);
    setError("");
    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }
    setResults([]);
    if (attempt === 1) {
      setData(null);
      setPreview(null);
    }
    setStages(ANALYZE_STAGES.map((s) => ({ ...s, status: "pending" })));
    setReasoning("");
    setContent("");
    setStructured("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, refresh }),
      });
      if (!(res.headers.get("content-type") || "").includes("ndjson")) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "分析失败");
      }
      setRetryCount(1);
      let gotResult = false;
      let streamError = "";
      await readNdjson(res, (ev) => {
        setRetryCount(1);
        switch (ev.type as string) {
          case "stages":
            // 后端根据是否命中静态缓存下发本次运行的阶段清单（命中/未命中两套不同）。
            setStages((ev.stages as { key: string; label: string }[]).map((s) => ({ ...s, status: "pending" })));
            break;
          case "stage":
            setStages((prev) => applyStageEvent(prev, ev.key as string, ev.status as "start" | "done", ev.elapsedMs as number | undefined));
            break;
          case "token":
            if (ev.kind === "reasoning") setReasoning((r) => r + (ev.text as string));
            else if (ev.kind === "structured") setStructured((s) => s + (ev.text as string));
            else setContent((c) => c + (ev.text as string));
            break;
          case "quote":
            {
              const q = ev.quote as StockQuote;
              setPreview({ quote: q, stats: ev.stats as Stats });
              saveToRecent(q.code, q.name);
            }
            break;
          case "result":
            setData({
              quote: ev.quote as StockQuote,
              stats: ev.stats as Stats,
              assessment: ev.assessment as ChokepointAssessment,
              quant: ev.quant,
              calibration: (ev.calibration ?? null) as CalibrationSummary | null,
              cache: ev.cache as AnalyzeResponse["cache"],
              timings: ev.timings as any,
            });
            gotResult = true;
            break;
          case "error":
            streamError = ev.message as string;
            break;
        }
      });
      if (streamError) {
        throw new Error(streamError);
      }
      if (!gotResult) {
        throw new Error("模型未返回有效打分结果（JSON 解析失败）");
      }
      setLoading(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "分析失败";
      if (attempt < 10) {
        console.warn(`第 ${attempt}/10 次尝试失败，准备重试: ${msg}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return analyze(code, attempt + 1, refresh);
      } else {
        setError(`${msg}（已重试 10 次，均告失败，请换一个能力更强的模型）`);
        setLoading(false);
      }
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
    if (loading || v.trim().length < 1) {
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
        {results.length > 0 && !loading && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] shadow-xl">
            {results.map((r, idx) => (
              <button
                key={`${r.code}-${r.market}-${idx}`}
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

      {/* 最近搜索历史 */}
      {recentStocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs select-none">
          <span className="text-[var(--faint)] font-mono uppercase tracking-wider">最近搜索：</span>
          <div className="flex flex-wrap gap-1.5 items-center flex-1">
            {recentStocks.map((s) => (
              <button
                key={s.code}
                onClick={() => {
                  setQuery(s.code);
                  analyze(s.code);
                }}
                className="px-2 py-1 rounded-[2px] bg-[var(--inset)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[var(--muted)] font-mono cursor-pointer transition text-[10.5px] font-semibold"
              >
                {s.name} ({s.code})
              </button>
            ))}
            <button
              onClick={clearRecent}
              className="ml-1 text-[10px] text-red-400 hover:text-red-300 font-semibold cursor-pointer underline hover:no-underline"
            >
              清除历史
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{error}</p>
          {error.includes("未配置") && (
            <a href="/settings" className="mt-1 inline-block text-[var(--accent)] underline">前往「设置」配置 LLM →</a>
          )}
        </div>
      )}

      {(loading || content || reasoning || structured || stages.some((s) => s.status !== "pending")) && (
        <ProgressTrace
          stages={stages}
          reasoning={reasoning}
          content={content}
          structured={structured}
          running={loading}
          retryCount={retryCount}
          timings={data?.timings}
        />
      )}

      {data?.cache && (
        <CacheBadge
          cache={data.cache}
          disabled={loading}
          onRefresh={() => data?.quote && analyze(data.quote.code, 1, true)}
        />
      )}

      {preview && !data && <PreviewCard quote={preview.quote} stats={preview.stats} />}

      {data && <Result data={data} />}
    </div>
  );
}

function CacheBadge({
  cache,
  onRefresh,
  disabled,
}: {
  cache: NonNullable<AnalyzeResponse["cache"]>;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  // 相对时间依赖 Date.now()（非纯），在 effect 里计算，避免在渲染期调用不纯函数。
  const [ageText, setAgeText] = useState("");
  useEffect(() => {
    const ageMs = Math.max(0, Date.now() - cache.createdAt);
    setAgeText(
      ageMs < 60 * 60 * 1000
        ? `${Math.round(ageMs / 60000)} 分钟前`
        : ageMs < 24 * 60 * 60 * 1000
          ? `${Math.round(ageMs / 3600000)} 小时前`
          : `${Math.round(ageMs / 86400000)} 天前`,
    );
  }, [cache.createdAt]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-[var(--border)] bg-[var(--inset)] px-3.5 py-2 text-xs">
      <div className="flex items-center gap-2">
        {cache.hit ? (
          <span className="font-semibold text-emerald-500">⚡ 静态基本面缓存命中</span>
        ) : (
          <span className="font-semibold text-[var(--accent)]">🧠 全量推理（已写入静态缓存）</span>
        )}
        <span className="text-[var(--muted)]">
          {cache.hit ? `基本面推理生成于 ${ageText}，本次仅实时刷新动态层（关注度/催化/买卖区间）` : "基本面推理一周内将直接秒级命中"}
        </span>
        {cache.positioning && <span className="text-[var(--faint)]">· 区位：{cache.positioning}</span>}
      </div>
      <button
        onClick={onRefresh}
        disabled={disabled}
        className="shrink-0 rounded-[2px] border border-[var(--border)] px-2.5 py-1 text-[var(--muted)] transition hover:text-[var(--accent)] hover:border-[var(--accent)] disabled:opacity-50"
      >
        强制重算静态层
      </button>
    </div>
  );
}

function PreviewCard({ quote, stats }: { quote: StockQuote; stats: Stats }) {
  const up = quote.changePct >= 0;
  return (
    <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5">
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
  const { quote, stats, assessment, matchedKnowledge, calibration } = data;
  const up = quote.changePct >= 0;
  const [showPoster, setShowPoster] = useState(false);
  return (
    <div className="space-y-5">
      <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-wide flex items-center gap-2 flex-wrap">
              <span>{quote.name}</span>
              <span className="font-mono text-sm text-[var(--faint)]">{quote.code}.{quote.market}</span>
              {assessment.recommendedBuy && (
                <span className="border border-[var(--accent)] text-[var(--accent)] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider rounded-none">
                  策略买入推荐
                </span>
              )}
            </h2>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="text-2xl font-mono font-bold">{quote.price.toFixed(2)}</span>
              <span className={`font-mono text-sm font-bold ${up ? "text-red-500" : "text-emerald-500"}`}>
                {up ? "+" : ""}{quote.change.toFixed(2)} ({up ? "+" : ""}{quote.changePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/chart?code=${quote.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] hover:bg-[var(--hover)] px-3 py-2 text-xs font-semibold tracking-wider text-[var(--text)] transition flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0l-6-6" />
              </svg>
              <span>Full chart</span>
            </a>
            <button
              onClick={() => setShowPoster(true)}
              className="rounded-[2px] bg-[var(--accent)] px-4 py-2 text-xs font-semibold tracking-wider text-[var(--accent-fg)] hover:opacity-90 transition cursor-pointer"
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
          {assessment.buyPriceRange && <Stat label="建议买入区间" value={assessment.buyPriceRange} />}
          {assessment.sellPriceRange && <Stat label="建议止盈区间" value={assessment.sellPriceRange} />}
          {stats && <Stat label="均换手" value={stats.avgTurnoverPct + "%"} />}
          <Stat label="更新时间" value={quote.time.slice(5)} />
        </div>
      </div>

      <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5">
        <h3 className="mb-3 font-bold tracking-wider">瓶颈点五因子打分</h3>
        <div className="grid items-center gap-6 lg:grid-cols-[320px_1fr]">
          <div className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] py-3">
            <RadarChart
              factors={assessment.factors.map((f) => ({
                label: FACTOR_LABELS[f.key] || f.key,
                score: f.score,
              }))}
            />
          </div>
          <div className="space-y-4">
            {assessment.factors.map((f) => (
              <div key={f.key}>
                <div className="mb-1.5 flex items-center justify-between text-xs font-mono">
                  <span className="text-[var(--text)] font-semibold">{FACTOR_LABELS[f.key] || f.key}</span>
                  <span className="font-bold text-[var(--accent)]">{f.score} / 5</span>
                </div>
                <div className="h-[3px] overflow-hidden rounded-none bg-[var(--hover)]">
                  <div className="h-full rounded-none bg-[var(--accent)]" style={{ width: `${(f.score / 5) * 100}%` }} />
                </div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{f.rationale}</p>
                {f.evidence && (
                  <p className="mt-1 text-[10px] leading-4 text-[var(--faint)]">
                    <span className="font-semibold">证据：</span>{f.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5">
        <h3 className="mb-2 font-bold tracking-wider">Serenity 风格论述</h3>
        <p className="text-sm leading-7 text-[var(--text)] text-justify">{assessment.thesis}</p>
      </div>

      <ReviewCard assessment={assessment} />

      {calibration && <CalibrationCard c={calibration} />}

      {/* ============================================================== */}
      {/* 新增：Serenity 投研实战与 BOM 解构面板 */}
      {/* ============================================================== */}
      {((assessment.workflowSteps && assessment.workflowSteps.length > 0) || assessment.bomPosition || (matchedKnowledge && matchedKnowledge.tweets.length > 0)) && (
        <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-6">
          <h3 className="font-bold tracking-wider border-b border-[var(--border)] pb-2">
            Serenity 投研实战与 BOM 解构
          </h3>
          
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            {/* 左侧：六步工作流 */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                六步工作流实战解剖 (Workflow Analysis)
              </h4>
              {assessment.workflowSteps && assessment.workflowSteps.length > 0 ? (
                <div className="relative border-l border-[var(--border)] pl-4 ml-2.5 space-y-5">
                  {assessment.workflowSteps.map((s) => {
                    const isWind = s.step === 5;
                    const isPos = s.step === 6;
                    const numColor = isWind 
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-500" 
                      : isPos 
                        ? "bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent)]" 
                        : "bg-[var(--hover)] border-[var(--border)] text-[var(--text)]";
                    
                    return (
                      <div key={s.step} className="relative">
                        <span className={`absolute -left-[27px] top-0.5 flex h-5 w-5 shrink-0 place-items-center justify-center rounded-full border text-[10px] font-mono font-bold ${numColor}`}>
                          0{s.step}
                        </span>
                        <div className="space-y-1">
                          <h5 className="text-xs font-bold tracking-wide text-[var(--text)]">
                            {s.title}
                          </h5>
                          <p className="text-xs leading-relaxed text-[var(--muted)] text-justify">
                            {s.content}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--faint)]">暂无工作流解构数据</p>
              )}
            </div>

            {/* 右侧：BOM 拆解与一手推文 */}
            <div className="space-y-5">
              {/* BOM 拆解卡片 */}
              {assessment.bomPosition && (
                <div className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] p-4 space-y-2.5">
                  <h4 className="text-xs font-bold tracking-wider text-[var(--text)] uppercase border-b border-[var(--border)] pb-1.5 flex items-center justify-between">
                    <span>BOM 成本链定位</span>
                    <span className="rounded-full bg-[var(--accent-soft)] border border-[var(--accent-line)] px-2 py-0.5 text-[9px] font-mono text-[var(--accent)]">
                      BOM 占比: {assessment.bomPosition.bomRatio || "暂无估算"}
                    </span>
                  </h4>
                  <div className="space-y-1.5 text-xs">
                    <p className="text-[11px] text-[var(--faint)] font-semibold">BOM 节点：</p>
                    <p className="font-mono text-[var(--text)] font-semibold">{assessment.bomPosition.nodeName}</p>
                    <p className="text-[11px] text-[var(--faint)] font-semibold mt-2">物料作用与卡脖子判定：</p>
                    <p className="text-[var(--muted)] leading-relaxed text-justify">{assessment.bomPosition.role}</p>
                  </div>
                </div>
              )}

              {/* Serenity 一手推文参考 */}
              {matchedKnowledge && matchedKnowledge.tweets && matchedKnowledge.tweets.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold tracking-wider text-[var(--faint)] uppercase tracking-widest text-[10px] border-b border-[var(--border)] pb-1">
                    Serenity 一手笔记参考 ({matchedKnowledge.tweets.length} 条)
                  </h4>
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {matchedKnowledge.tweets.map((t, idx) => (
                      <div key={idx} className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-3 text-xs space-y-1.5 glass-card">
                        <div className="flex items-center justify-between text-[10px] text-[var(--faint)] font-mono">
                          <span>@aleabitoreddit 原文</span>
                          <span>{t.date}</span>
                        </div>
                        <p className="font-mono text-[var(--muted)] leading-relaxed whitespace-pre-line text-justify scale-[0.95] origin-top-left">
                          {t.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ListCard title="潜在催化剂" items={assessment.catalysts} tone="emerald" />
        <ListCard title="风险点" items={assessment.risks} tone="amber" />
      </div>

      {data.quant && (
        <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="flex justify-between items-center border-b border-[var(--border)] pb-2 mb-3">
            <div className="text-[9.5px] font-mono text-[var(--accent)] font-extrabold uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              [Serenity Quant Engine / 均线量化与筹码图谱诊断]
            </div>
            <a
              href={`/chart?code=${quote.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] hover:bg-[var(--hover)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text)] transition flex items-center gap-1.5 font-mono cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0l-6-6" />
              </svg>
              <span>Full chart</span>
            </a>
          </div>
          <QuantChart
            quantData={data.quant}
            currentPrice={quote.price}
          />
        </div>
      )}
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
    <div className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] px-3 py-2">
      <p className="text-[10px] text-[var(--faint)] font-mono uppercase tracking-wider">{label}</p>
      <p className="mt-0.5 font-mono font-bold text-[var(--text)]">{value}</p>
    </div>
  );
}

function ScoreBadge({ score, verdict }: { score: number; verdict: string }) {
  const color = score >= 75 ? "text-[var(--accent)]" : score >= 55 ? "text-sky-400" : score >= 35 ? "text-amber-400" : "text-[var(--muted)]";
  return (
    <div className="text-right">
      <div className={`text-3xl font-mono font-black ${color} leading-none`}>{score}</div>
      <p className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wider mt-1 border-t border-[var(--border)] pt-0.5">{verdict}</p>
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "emerald" | "amber" }) {
  const border = tone === "emerald" ? "border-[var(--accent-line)]" : "border-[var(--warn-line)]";
  const head = tone === "emerald" ? "text-[var(--accent)]" : "text-[var(--warn)]";
  return (
    <div className={`rounded-[2px] border ${border} bg-[var(--panel)] p-4`}>
      <h3 className={`mb-3 text-xs font-bold tracking-wider uppercase border-b border-[var(--border)] pb-1.5 ${head}`}>{title}</h3>
      <ul className="space-y-1.5 text-xs leading-5 text-[var(--text)]">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 items-start font-mono text-[var(--muted)]">
            <span className={`${head} font-bold`}>[0{i + 1}]</span>
            <span className="text-[var(--text)] font-sans text-justify">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEVERITY_TONE: Record<"high" | "medium" | "low", string> = {
  high: "text-red-500 border-red-500/40",
  medium: "text-amber-500 border-amber-500/40",
  low: "text-[var(--muted)] border-[var(--border)]",
};
const SEVERITY_LABEL: Record<"high" | "medium" | "low", string> = { high: "高", medium: "中", low: "低" };

/** AI 复核（Generator→Critic→Judge）面板：展示置信度、回测口径胜率、批判者反证。 */
function ReviewCard({ assessment }: { assessment: ChokepointAssessment }) {
  const { critique, finalConfidence, adjusted, winRate, selfConsistency } = assessment;
  if (!critique && finalConfidence == null && !winRate && !selfConsistency) return null;
  const confPct = finalConfidence != null ? Math.round(finalConfidence * 100) : null;
  const confColor =
    confPct == null ? "text-[var(--muted)]" : confPct >= 60 ? "text-[var(--accent)]" : confPct >= 40 ? "text-amber-400" : "text-red-500";
  return (
    <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold tracking-wider flex items-center gap-2">
          AI 复核 · 风控
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] border border-[var(--border)] rounded-full px-2 py-0.5">
            生成器 → 批判者 → 裁判
          </span>
        </h3>
        <div className="flex items-center gap-4">
          {adjusted && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-amber-500 border border-amber-500/40 rounded-full px-2 py-0.5">
              已据复核下调
            </span>
          )}
          {confPct != null && (
            <div className="text-right">
              <div className={`text-2xl font-mono font-black leading-none ${confColor}`}>{confPct}%</div>
              <p className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wider mt-0.5">最终置信度</p>
            </div>
          )}
        </div>
      </div>

      {winRate && (
        <div className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--text)]">
              胜率：{winRate.source === "na" ? "样本不足" : `${winRate.value.toFixed(1)}%`}
            </span>
            {winRate.source === "walkforward" && (
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--accent)] border border-[var(--accent-line)] rounded-full px-2 py-0.5">
                样本外 · {winRate.horizon}日前瞻 · {winRate.sampleSize}次信号
              </span>
            )}
            {winRate.source === "backtest" && (
              <span className="text-[9px] font-mono uppercase tracking-wider text-amber-500 border border-amber-500/40 rounded-full px-2 py-0.5">
                样本内回测 · {winRate.sampleSize}笔
              </span>
            )}
            {winRate.inSample && winRate.source === "walkforward" && (
              <span className="text-[var(--faint)]">（样本内对照 {winRate.inSample.value.toFixed(1)}%，通常偏高）</span>
            )}
          </div>
          <p className="text-[var(--faint)]">{winRate.note}</p>
          {winRate.benchmark && (
            <div className="mt-1 border-t border-[var(--border)] pt-1.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[var(--muted)]">
                  策略 <b className={winRate.benchmark.strategyReturnPct >= 0 ? "text-rose-500" : "text-emerald-500"}>{winRate.benchmark.strategyReturnPct > 0 ? "+" : ""}{winRate.benchmark.strategyReturnPct.toFixed(2)}%</b>
                </span>
                <span className="text-[var(--faint)]">vs 买入持有 <b className={winRate.benchmark.buyHoldReturnPct >= 0 ? "text-rose-500" : "text-emerald-500"}>{winRate.benchmark.buyHoldReturnPct > 0 ? "+" : ""}{winRate.benchmark.buyHoldReturnPct.toFixed(2)}%</b></span>
                <span className="text-[var(--muted)]">超额 <b className={winRate.benchmark.excessPct >= 0 ? "text-rose-500" : "text-emerald-500"}>{winRate.benchmark.excessPct > 0 ? "+" : ""}{winRate.benchmark.excessPct.toFixed(2)}pp</b></span>
                <span
                  className={`text-[9px] font-mono uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                    winRate.benchmark.significant
                      ? "text-emerald-500 border-emerald-500/40"
                      : "text-[var(--faint)] border-[var(--border)]"
                  }`}
                >
                  {winRate.benchmark.significant ? `显著 z=${winRate.benchmark.zVsCoin}` : `不显著 z=${winRate.benchmark.zVsCoin} · n=${winRate.benchmark.sampleSize}`}
                </span>
              </div>
              <p className="text-[var(--faint)]">{winRate.benchmark.note}</p>
            </div>
          )}
        </div>
      )}

      {selfConsistency && selfConsistency.runs > 1 && (
        <div className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] p-3 text-xs space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--text)]">自洽投票</span>
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--accent)] border border-[var(--accent-line)] rounded-full px-2 py-0.5">
              {selfConsistency.runs} 次打分 · 取中位
            </span>
            <span className="text-[var(--faint)]">最大因子分歧 {selfConsistency.maxSpread.toFixed(1)} 分</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selfConsistency.factors.map((f) => (
              <span key={f.key} className="rounded-[2px] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                {FACTOR_LABELS[f.key] ?? f.key}: {f.primary.toFixed(1)}→{f.consensus.toFixed(1)}
                {f.spread > 0 && <span className="text-amber-500"> ±{f.spread.toFixed(1)}</span>}
              </span>
            ))}
          </div>
          <p className="text-[var(--faint)]">{selfConsistency.note}</p>
        </div>
      )}

      {critique?.summary && <p className="text-sm leading-6 text-[var(--text)] text-justify">{critique.summary}</p>}

      {critique && critique.disconfirming.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[var(--faint)] uppercase tracking-wider">反证 / 证伪点</p>
          {critique.disconfirming.map((d, i) => (
            <div key={i} className="flex gap-2 items-start text-xs">
              <span className={`shrink-0 font-mono border rounded px-1.5 py-0.5 text-[10px] ${SEVERITY_TONE[d.severity]}`}>
                {SEVERITY_LABEL[d.severity]}
                {d.factorKey ? `·${FACTOR_LABELS[d.factorKey] || d.factorKey}` : ""}
                {typeof d.suggestedScoreDelta === "number" ? ` ${d.suggestedScoreDelta > 0 ? "+" : ""}${d.suggestedScoreDelta}` : ""}
              </span>
              <span className="text-[var(--muted)] text-justify leading-5">{d.issue}</span>
            </div>
          ))}
        </div>
      )}

      {critique && critique.unsupportedClaims.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--faint)] uppercase tracking-wider mb-1">缺乏证据支撑的论断</p>
          <ul className="space-y-1 text-xs text-[var(--muted)]">
            {critique.unsupportedClaims.map((c, i) => (
              <li key={i} className="flex gap-2"><span className="text-[var(--faint)]">·</span><span className="text-justify">{c}</span></li>
            ))}
          </ul>
        </div>
      )}

      {critique && critique.overfitWarnings.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--faint)] uppercase tracking-wider mb-1">过拟合 / 反身性提示</p>
          <ul className="space-y-1 text-xs text-[var(--muted)]">
            {critique.overfitWarnings.map((c, i) => (
              <li key={i} className="flex gap-2"><span className="text-[var(--faint)]">·</span><span className="text-justify">{c}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 校准闭环（B3）：展示预测落库与事后真实涨跌结算出的 Brier 分 / 可靠性曲线。 */
function CalibrationCard({ c }: { c: CalibrationSummary }) {
  return (
    <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-[var(--text)]">校准闭环 · 可靠性</h3>
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] border border-[var(--border)] rounded-full px-2 py-0.5">
          预测 {c.total} · 已结算 {c.resolved} · 待结算 {c.pending}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <div>
          <div className="text-[var(--faint)]">Brier 分（越低越准）</div>
          <div className="font-mono font-bold text-base text-[var(--text)]">{c.brier != null ? c.brier.toFixed(3) : "—"}</div>
        </div>
        <div>
          <div className="text-[var(--faint)]">实际命中率</div>
          <div className="font-mono font-bold text-base text-[var(--text)]">{c.hitRate != null ? `${c.hitRate}%` : "—"}</div>
        </div>
      </div>
      {c.resolved > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-[var(--faint)] uppercase tracking-wider">可靠性曲线（置信度桶 vs 实际命中）</p>
          <div className="space-y-1">
            {c.reliability.filter((b) => b.count > 0).map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="w-16 text-[var(--faint)]">{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</span>
                <div className="flex-1 h-3 rounded-[2px] bg-[var(--inset)] relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-[var(--accent-line)]" style={{ width: `${b.observedFreq * 100}%` }} />
                </div>
                <span className="w-24 text-right text-[var(--muted)]">实测 {Math.round(b.observedFreq * 100)}% · n={b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-[var(--faint)]">{c.note}</p>
      <p className="text-[10px] text-[var(--faint)]">
        回填真实涨跌：<code className="font-mono">POST /api/calibration/record {`{code, actualReturnPct, horizonDays}`}</code>
      </p>
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
