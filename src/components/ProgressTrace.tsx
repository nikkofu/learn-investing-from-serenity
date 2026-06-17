"use client";

import { useEffect, useRef, useState } from "react";

export type StageStatus = "pending" | "active" | "done";
export interface Stage {
  key: string;
  label: string;
  status: StageStatus;
  elapsedMs?: number;
}

/** Apply a {stage,status} stream event to a stage list. */
export function applyStageEvent(stages: Stage[], key: string, status: "start" | "done", elapsedMs?: number): Stage[] {
  return stages.map((s) =>
    s.key === key ? { ...s, status: status === "start" ? "active" : "done", elapsedMs: status === "done" ? elapsedMs : undefined } : s
  );
}

/** 阶段实时与精确耗时计时器 */
function StageTimer({ status, elapsedMs }: { status: StageStatus; elapsedMs?: number }) {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (status !== "active") return;
    const start = Date.now();
    const id = setInterval(() => {
      setTicks((Date.now() - start) / 1000);
    }, 50);
    return () => clearInterval(id);
  }, [status]);

  if (status === "done") {
    const s = elapsedMs != null ? (elapsedMs / 1000).toFixed(2) : ticks > 0 ? ticks.toFixed(2) : "0.00";
    return <span className="font-mono text-xs text-[var(--muted)] font-semibold">{s}s</span>;
  }
  if (status === "active") {
    return <span className="font-mono text-xs text-[var(--accent)] font-semibold animate-pulse">{ticks.toFixed(1)}s</span>;
  }
  return <span className="font-mono text-xs text-[var(--faint)]">--</span>;
}

/** Live wall-clock elapsed (seconds, 1 decimal) while `running` is true. */
function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    // First tick fires on the next macrotask (not synchronously in the effect),
    // resetting the counter to ~0 for this run; subsequent ticks advance it.
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
}

/**
 * Live progress panel: a stage timeline plus a streaming output console
 * (model reasoning + readable answer + raw structured JSON) that updates
 * token-by-token. A wall-clock ticker makes it obvious the request is alive
 * even before the model emits its first token.
 */
export function ProgressTrace({
  stages,
  reasoning,
  content,
  structured,
  running,
  retryCount = 1,
  timings,
}: {
  stages: Stage[];
  reasoning: string;
  content: string;
  structured: string;
  running: boolean;
  retryCount?: number;
  timings?: {
    quoteMs: number;
    reasonMs: number;
    summaryMs: number;
    totalMs: number;
  };
}) {
  const elapsed = useElapsed(running);
  const showLive = running || Boolean(reasoning) || Boolean(content) || Boolean(structured);
  const awaitingFirstToken = running && !reasoning && !content && !structured;

  const reasoningRef = useRef<HTMLPreElement>(null);
  const contentRef = useRef<HTMLPreElement>(null);
  const structuredRef = useRef<HTMLPreElement>(null);

  // 监控文本流更新，自动滚动容器，使用户始终能看到最新生成的文字行
  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content]);

  useEffect(() => {
    if (structuredRef.current) {
      structuredRef.current.scrollTop = structuredRef.current.scrollHeight;
    }
  }, [structured]);

  // 估算已经生成的总 token 数量（字符数粗略折算）
  const totalTokens = reasoning.length + content.length + structured.length;
  // 估算实时生成速度 (tokens / sec)
  const speed = elapsed > 0 ? totalTokens / elapsed : 0;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <ol className="flex-1 space-y-2">
          {stages.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-sm py-0.5">
              <div className="flex items-center gap-2.5">
                <StageDot status={s.status} />
                <span
                  className={
                    s.status === "pending"
                      ? "text-[var(--faint)]"
                      : s.status === "active"
                        ? "font-medium text-[var(--accent)]"
                        : "text-[var(--text)]"
                  }
                >
                  {s.label}
                </span>
                {s.status === "active" && (
                  <span
                    className={`text-[11px] ml-1.5 font-semibold transition ${
                      retryCount > 1 ? "text-amber-500 animate-pulse" : "text-[var(--accent)]/70"
                    }`}
                  >
                    {retryCount > 1 ? `正在重试 ${retryCount}/10...` : "进行中…"}
                  </span>
                )}
              </div>
              <StageTimer status={s.status} elapsedMs={s.elapsedMs} />
            </li>
          ))}
        </ol>
      </div>

      {showLive && (
        <div className="space-y-2.5 pt-1">
          {/* Claude Code / Codex 风格终端指标状态条 */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 font-mono text-[11px] select-none">
            <div className="flex items-center gap-2">
              {running ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]"></span>
                </span>
              ) : (
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500/80" />
              )}
              <span className="font-semibold text-zinc-100 uppercase tracking-wider">
                {running ? "AI 推理流传输中" : "AI 推理完成"}
              </span>
            </div>
            
            <div className="flex items-center gap-3.5">
              <div className="flex items-center gap-1">
                <span className="text-zinc-400">TIME:</span>
                <span className="font-semibold text-[var(--accent)]">{elapsed.toFixed(1)}s</span>
              </div>
              {totalTokens > 0 && (
                <>
                  <span className="text-zinc-700">|</span>
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-400">TOKENS:</span>
                    <span className="font-semibold text-[var(--accent)]">{totalTokens.toLocaleString()}</span>
                  </div>
                  <span className="text-zinc-700">|</span>
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-400">SPEED:</span>
                    <span className="font-semibold text-[var(--accent)]">{speed.toFixed(1)} t/s</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {!running && timings && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-1.5 font-mono text-[10px] select-none">
              <span className="text-zinc-400 uppercase tracking-wider font-bold">⏱️ 性能审计:</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">行情获取:</span>
                <span className="text-zinc-200">{(timings.quoteMs / 1000).toFixed(2)}s</span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">AI 推理:</span>
                <span className="text-zinc-200">{(timings.reasonMs / 1000).toFixed(2)}s</span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">量化计算:</span>
                <span className="text-zinc-200">{(timings.summaryMs / 1000).toFixed(2)}s</span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">总耗时:</span>
                <span className="text-[var(--accent)] font-bold">{(timings.totalMs / 1000).toFixed(2)}s</span>
              </div>
            </div>
          )}

          {reasoning && (
            <details open className="rounded-lg border border-[var(--border)] bg-[var(--inset)]">
              <summary className="cursor-pointer px-3 py-1.5 text-xs text-[var(--muted)]">
                模型思考过程 · reasoning
              </summary>
              <pre ref={reasoningRef} className="max-h-48 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-[var(--faint)]">
                {reasoning}
              </pre>
            </details>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--inset)]">
            <div className="px-3 py-1.5 text-xs text-[var(--muted)] flex items-center justify-between border-b border-[var(--border)] bg-white/[0.01]">
              <span>
                AI 实时分析推理 · live
                {running && <span className="ml-1 animate-pulse text-[var(--accent)]">▍</span>}
              </span>
            </div>
            <pre ref={contentRef} className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-[12px] leading-6 text-[var(--text)]">
              {content || (awaitingFirstToken ? `💡 正在为您调取 Serenity 专属投研数据库，检索该个股在产业链中的上下游瓶颈关系及一手行业笔记数据...\n\n⏱️ 已等待：${elapsed.toFixed(1)}s (大模型推理启动中，可能需要几秒，请耐心等待)` : "")}
            </pre>
          </div>

          {structured && (
            <details className="rounded-lg border border-[var(--border)] bg-[var(--inset)]">
              <summary className="cursor-pointer px-3 py-1.5 text-xs text-[var(--muted)]">
                结构化结果生成中（JSON）
                {running && <span className="ml-1 animate-pulse text-[var(--accent)]">▍</span>}
              </summary>
              <pre ref={structuredRef} className="max-h-40 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-[var(--faint)]">
                {structured}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function StageDot({ status }: { status: StageStatus }) {
  if (status === "active") {
    return (
      <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent-line)] border-t-[var(--accent)]" />
    );
  }
  if (status === "done") {
    return <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full bg-[var(--accent)]" />;
  }
  return <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--faint)]" />;
}
