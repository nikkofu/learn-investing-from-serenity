"use client";

import { useEffect, useState } from "react";

export type StageStatus = "pending" | "active" | "done";
export interface Stage {
  key: string;
  label: string;
  status: StageStatus;
}

/** Apply a {stage,status} stream event to a stage list. */
export function applyStageEvent(stages: Stage[], key: string, status: "start" | "done"): Stage[] {
  return stages.map((s) =>
    s.key === key ? { ...s, status: status === "start" ? "active" : "done" } : s
  );
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
}: {
  stages: Stage[];
  reasoning: string;
  content: string;
  structured: string;
  running: boolean;
  retryCount?: number;
}) {
  const elapsed = useElapsed(running);
  const showLive = running || Boolean(reasoning) || Boolean(content) || Boolean(structured);
  const awaitingFirstToken = running && !reasoning && !content && !structured;
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <ol className="flex-1 space-y-2">
          {stages.map((s) => (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
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
                  className={`text-xs ml-1.5 font-semibold transition ${
                    retryCount > 1 ? "text-amber-500 animate-pulse" : "text-[var(--accent)]"
                  }`}
                >
                  {retryCount > 1 ? `正在重试 ${retryCount}/10...` : "进行中…"}
                </span>
              )}
            </li>
          ))}
        </ol>
        {(running || elapsed > 0) && (
          <span className="ml-3 shrink-0 self-start font-mono text-xs text-[var(--muted)]" aria-label="已用时">
            {elapsed.toFixed(1)}s
          </span>
        )}
      </div>

      {showLive && (
        <div className="space-y-2 pt-1">
          {reasoning && (
            <details open className="rounded-lg border border-[var(--border)] bg-[var(--inset)]">
              <summary className="cursor-pointer px-3 py-1.5 text-xs text-[var(--muted)]">
                模型思考过程 · reasoning
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-[var(--faint)]">
                {reasoning}
              </pre>
            </details>
          )}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--inset)]">
            <div className="px-3 py-1.5 text-xs text-[var(--muted)]">
              AI 实时分析推理 · live
              {running && <span className="ml-1 animate-pulse text-[var(--accent)]">▍</span>}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 text-[12px] leading-6 text-[var(--text)]">
              {content || (awaitingFirstToken ? `等待模型返回首个 token… ${elapsed.toFixed(1)}s（取决于模型，首字可能需数秒）` : "")}
            </pre>
          </div>
          {structured && (
            <details className="rounded-lg border border-[var(--border)] bg-[var(--inset)]">
              <summary className="cursor-pointer px-3 py-1.5 text-xs text-[var(--muted)]">
                结构化结果生成中（JSON）
                {running && <span className="ml-1 animate-pulse text-[var(--accent)]">▍</span>}
              </summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-[var(--faint)]">
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
