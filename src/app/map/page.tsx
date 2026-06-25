"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SupplyChainMap } from "@/lib/types";
import { ProgressTrace, applyStageEvent, type Stage } from "@/components/ProgressTrace";
import { readNdjson } from "@/lib/stream-client";
import { PageHeader } from "@/components/ui";

const SUGGESTIONS = ["AI 算力 / 光模块", "人形机器人", "半导体国产替代", "CPO / 硅光", "稀土永磁", "液冷数据中心"];

const MAP_STAGES: { key: string; label: string }[] = [
  { key: "reason", label: "AI 拆解产业链与瓶颈点" },
  { key: "summary", label: "整理产业链节点" },
];

/** K 线图标（蜡烛图），用于个股「看 K 线」入口。 */
function ChartGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 5v4" />
      <rect width="4" height="6" x="7" y="9" rx="1" />
      <path d="M9 15v2" />
      <path d="M17 3v2" />
      <rect width="4" height="8" x="15" y="5" rx="1" />
      <path d="M17 13v3" />
      <path d="M3 3v18h18" />
    </svg>
  );
}

function MapPageInner() {
  const searchParams = useSearchParams();
  const [trend, setTrend] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [map, setMap] = useState<SupplyChainMap | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [content, setContent] = useState("");
  const [structured, setStructured] = useState("");
  const [retryCount, setRetryCount] = useState(1);
  const [viewMode, setViewMode] = useState<"mindmap" | "list">("mindmap");
  const autoRan = useRef(false);

  // 提取当前图谱中的所有有效A股股票代码
  const allStockCodes = map
    ? Array.from(
        new Set(
          map.nodes
            .flatMap((n) => n.tickers.map((t) => t.code))
            .filter((code) => /^\d{6}$/.test(code))
        )
      ).join(",")
    : "";

  async function run(t?: string, attempt = 1) {
    const q = (t ?? trend).trim();
    if (!q) return;
    setTrend(q);
    setLoading(true);
    setRetryCount(attempt);
    setError("");
    if (attempt === 1) {
      setMap(null);
    }
    setStages(MAP_STAGES.map((s) => ({ ...s, status: "pending" })));
    setReasoning("");
    setContent("");
    setStructured("");
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trend: q }),
      });
      if (!(res.headers.get("content-type") || "").includes("ndjson")) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "拆解失败");
      }
      setRetryCount(1);
      let gotResult = false;
      let streamError = "";
      await readNdjson(res, (ev) => {
        setRetryCount(1);
        switch (ev.type as string) {
          case "stage":
            setStages((prev) => applyStageEvent(prev, ev.key as string, ev.status as "start" | "done"));
            break;
          case "token":
            if (ev.kind === "reasoning") setReasoning((r) => r + (ev.text as string));
            else if (ev.kind === "structured") setStructured((s) => s + (ev.text as string));
            else setContent((c) => c + (ev.text as string));
            break;
          case "result":
            setMap(ev.map as SupplyChainMap);
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
        throw new Error("模型未返回有效拆解结果（JSON 解析失败）");
      }
      setLoading(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "拆解失败";
      if (attempt < 10) {
        console.warn(`第 ${attempt}/10 次尝试失败，准备重试: ${msg}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return run(t, attempt + 1);
      } else {
        setError(`${msg}（已重试 10 次，均告失败，请换一个能力更强的模型）`);
        setLoading(false);
      }
    }
  }

  // 支持从其他页面（如 /methodology）通过 ?trend=<主题>&auto=1 预填并自动拆解
  useEffect(() => {
    if (autoRan.current) return;
    const t = (searchParams.get("trend") || "").trim();
    if (!t) return;
    autoRan.current = true;
    setTrend(t);
    if (searchParams.get("auto") === "1") void run(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="趋势 → 产业链瓶颈点拆解"
        subtitle="输入一个确定性趋势，AI 按 Serenity 瓶颈点方法拆出产业链分层，并标注 A 股“卡脖子”环节。"
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={trend}
          onChange={(e) => setTrend(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="如：AI 算力 / 光模块"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--inset)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => run()}
          disabled={loading}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "拆解中…" : "拆解"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => run(s)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--hover)]">
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{error}</p>
          {error.includes("未配置") && (
            <a href="/settings" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[var(--accent)] underline">前往「设置」配置 LLM →</a>
          )}
        </div>
      )}

      {(loading || content || reasoning || structured || stages.some((s) => s.status !== "pending")) && (
        <ProgressTrace stages={stages} reasoning={reasoning} content={content} structured={structured} running={loading} retryCount={retryCount} />
      )}

      {map && (
        <div className="space-y-6">
          {/* 顶栏信息与模式切换 */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[var(--border)] pb-4">
            <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4 flex-1">
              <p className="text-sm font-medium text-[var(--accent)]">瓶颈点总结</p>
              <p className="mt-1 text-sm leading-6 text-[var(--text)]">{map.summary}</p>
            </div>
            
            {/* 操作控制区 */}
            <div className="flex flex-wrap items-center gap-3 self-end md:self-center">
              {allStockCodes.length > 0 && (
                <Link
                  href={`/scanner?codes=${allStockCodes}&title=${encodeURIComponent(map.trend + "产业链")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:bg-[var(--hover)] text-[var(--accent)] hover:text-[var(--text)] transition cursor-pointer text-xs font-semibold px-3 py-1.5 flex items-center gap-1.5 shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  一键并发诊断 ⚡
                </Link>
              )}

              {/* 切换 Tab */}
              <div className="flex border border-[var(--border)] rounded-lg p-1 bg-[var(--inset)] text-xs font-semibold shrink-0">
                <button
                  onClick={() => setViewMode("mindmap")}
                  className={`px-3 py-1.5 rounded-md transition cursor-pointer flex items-center gap-1.5 ${
                    viewMode === "mindmap" 
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]" 
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v12"/><path d="M6 12h12"/></svg>
                  思维导图
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-3 py-1.5 rounded-md transition cursor-pointer flex items-center gap-1.5 ${
                    viewMode === "list" 
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]" 
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  卡片列表
                </button>
              </div>
            </div>
          </div>

          {/* 渲染内容 */}
          {viewMode === "mindmap" ? (
            <div className="overflow-x-auto pb-4 border border-[var(--border)] rounded-xl bg-[var(--panel)] p-6">
              <div className="min-w-[900px] flex items-stretch gap-10 py-6 select-none relative">
                
                {/* 1. 核心树根：趋势主题 */}
                <div className="flex items-center shrink-0">
                  <div className="relative rounded-2xl border-2 border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_15px_rgba(16,185,129,0.12)] px-6 py-5 text-center max-w-[200px] z-10">
                    <span className="text-[9px] text-[var(--accent)] font-mono uppercase tracking-widest block mb-1">CORE THESIS</span>
                    <h2 className="text-sm font-bold text-[var(--text)] leading-snug">{map.trend}</h2>
                    {/* 右侧连线 */}
                    <div className="absolute right-0 top-1/2 -mr-10 w-10 h-[2px] bg-gradient-to-r from-[var(--accent)] to-[var(--border)] -translate-y-1/2" />
                  </div>
                </div>

                {/* 2. 环节树干与叶子个股 */}
                <div className="flex-1 flex flex-col justify-center gap-6 relative pl-6 border-l-2 border-[var(--border)]">
                  {map.nodes.map((n, idx) => (
                    <div key={idx} className="relative flex items-center gap-6 pl-6">
                      
                      {/* 从左侧垂直树干延伸出的横向连线 */}
                      <div className={`absolute left-0 top-1/2 -ml-[2px] w-6 h-[2px] -translate-y-1/2 ${n.isChokepoint ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`} />

                      {/* 环节卡片 */}
                      <div className={`relative shrink-0 w-[260px] rounded-xl border p-4 shadow-sm backdrop-blur-[4px] transition-all hover:-translate-y-0.5 hover:shadow-md ${
                        n.isChokepoint 
                          ? "border-[var(--accent-line)] bg-gradient-to-br from-[var(--accent-soft)] to-[var(--panel)] shadow-[0_0_10px_rgba(245,158,11,0.06)]" 
                          : "border-[var(--border)] bg-[var(--panel)]"
                      }`}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <h3 className="min-w-0 font-semibold text-sm leading-snug text-[var(--text)]">{n.layer}</h3>
                          {n.isChokepoint && (
                            <span className="shrink-0 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
                              </span>
                              瓶颈点
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--muted)] line-clamp-2 leading-relaxed" title={n.role}>{n.role}</p>
                        
                        {n.bomRatio && (
                          <div className="mt-2 flex items-start gap-1.5 text-[10px] font-mono leading-relaxed text-[var(--muted)]">
                            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                            <span className="shrink-0 whitespace-nowrap">BOM占比</span>
                            <span className="font-bold text-[var(--text)]">{n.bomRatio}</span>
                          </div>
                        )}

                        {/* 右侧连线 */}
                        {n.tickers.length > 0 && (
                          <div className="absolute right-0 top-1/2 -mr-6 w-6 h-[2px] bg-dashed bg-[var(--border)] -translate-y-1/2" />
                        )}
                      </div>

                      {/* 3. 叶子个股节点 */}
                      {n.tickers.length > 0 ? (
                        <div className="flex flex-wrap gap-2 max-w-[380px]">
                          {n.tickers.map((t, j) => {
                            const isA = /^\d{6}$/.test(t.code);
                            return isA ? (
                              <div
                                key={j}
                                className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-2.5 py-1.5 text-xs transition-all hover:border-[var(--accent-line)] hover:bg-[var(--hover)] hover:shadow-sm flex items-center gap-1.5 shrink-0"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                <div className="flex flex-col text-left">
                                  <Link href={`/analyze?code=${t.code}`} target="_blank" rel="noopener noreferrer" title="个股分析" className="font-semibold text-[var(--text)] text-[11px] leading-tight hover:text-[var(--accent)] hover:underline">{t.name}</Link>
                                  <span className="flex items-center gap-1 font-mono text-[9px] text-[var(--faint)]">
                                    {t.code}
                                    <Link href={`/chart?code=${t.code}`} target="_blank" rel="noopener noreferrer" title="看 K 线图" aria-label="看 K 线图" className="text-[var(--faint)] transition hover:text-[var(--accent)]">
                                      <ChartGlyph className="h-3 w-3" />
                                    </Link>
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div 
                                key={j} 
                                className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-2.5 py-1.5 text-xs flex items-center gap-1.5 shrink-0 opacity-60"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--border)] shrink-0" />
                                <div className="flex flex-col text-left">
                                  <span className="font-semibold text-[var(--text)] text-[11px] leading-tight">{t.name}</span>
                                  {t.code && <span className="font-mono text-[9px] text-[var(--faint)]">{t.code}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-xs text-[var(--faint)] font-mono italic">暂无代表A股</div>
                      )}

                    </div>
                  ))}
                </div>

              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {map.nodes.map((n, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-4 ${
                    n.isChokepoint ? "border-[var(--accent-line)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--panel)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{n.layer}</h3>
                    {n.isChokepoint && (
                      <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">瓶颈点</span>
                    )}
                    {n.bomRatio && (
                      <span className="rounded-full bg-[var(--hover)] border border-[var(--border)] px-2 py-0.5 text-[11px] font-mono text-[var(--text)] font-semibold">
                        BOM 占比: {n.bomRatio}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-[var(--text)]">{n.role}</p>
                  {n.isChokepoint && n.chokepointReason && (
                    <p className="mt-1 text-xs leading-5 text-[var(--accent)] font-medium">为何卡脖子：{n.chokepointReason}</p>
                  )}
                  {n.bomDetail && (
                    <div className="mt-2.5 rounded-[2px] border border-dashed border-[var(--border)] bg-[var(--inset)] p-2.5 text-xs">
                      <span className="font-bold text-[var(--faint)] block mb-1 tracking-wider uppercase text-[10px]">物料清单细分拆解 (BOM Details)：</span>
                      <p className="font-mono text-[var(--muted)] leading-relaxed">{n.bomDetail}</p>
                    </div>
                  )}
                  {n.tickers.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {n.tickers.map((t, j) => {
                        const isA = /^\d{6}$/.test(t.code);
                        return (
                          <div key={j} className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs transition hover:border-[var(--accent-line)]">
                            {isA ? (
                              <Link href={`/analyze?code=${t.code}`} target="_blank" rel="noopener noreferrer" title="个股分析" className="font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline">{t.name}</Link>
                            ) : (
                              <span className="font-medium text-[var(--text)]">{t.name}</span>
                            )}
                            {t.code && (isA ? (
                              <Link href={`/chart?code=${t.code}`} target="_blank" rel="noopener noreferrer" title="看 K 线图" className="ml-1 inline-flex items-center gap-1 align-middle font-mono text-xs text-[var(--faint)] transition hover:text-[var(--accent)]">
                                {t.code}
                                <ChartGlyph className="h-3.5 w-3.5" />
                              </Link>
                            ) : (
                              <span className="ml-1 font-mono text-xs text-[var(--faint)]">{t.code}</span>
                            ))}
                            {t.note && <p className="mt-0.5 max-w-[15rem] text-[11px] leading-4 text-[var(--muted)]">{t.note}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          
          <p className="text-xs text-[var(--faint)]">{map.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-xs font-mono text-[var(--muted)]">LOADING PAGE CONTEXT...</div>}>
      <MapPageInner />
    </Suspense>
  );
}
