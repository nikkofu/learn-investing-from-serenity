"use client";

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

/**
 * Live progress panel: a stage timeline plus a streaming output console
 * (model reasoning + visible answer) that updates token-by-token.
 */
export function ProgressTrace({
  stages,
  reasoning,
  content,
  running,
}: {
  stages: Stage[];
  reasoning: string;
  content: string;
  running: boolean;
}) {
  const showLive = running || Boolean(reasoning) || Boolean(content);
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <ol className="space-y-2">
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
            {s.status === "active" && <span className="text-xs text-[var(--accent)]">进行中…</span>}
          </li>
        ))}
      </ol>

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
              实时输出 · streaming
              {running && <span className="ml-1 animate-pulse text-[var(--accent)]">▍</span>}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-[var(--text)]">
              {content || (running ? "等待模型返回首个 token…" : "")}
            </pre>
          </div>
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
