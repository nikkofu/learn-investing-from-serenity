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
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <ol className="space-y-2">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-sm">
            <StageDot status={s.status} />
            <span
              className={
                s.status === "pending"
                  ? "text-zinc-500"
                  : s.status === "active"
                    ? "font-medium text-emerald-300"
                    : "text-zinc-300"
              }
            >
              {s.label}
            </span>
            {s.status === "active" && <span className="text-xs text-emerald-400/70">进行中…</span>}
          </li>
        ))}
      </ol>

      {showLive && (
        <div className="space-y-2 pt-1">
          {reasoning && (
            <details open className="rounded-lg border border-white/10 bg-black/30">
              <summary className="cursor-pointer px-3 py-1.5 text-xs text-zinc-400">
                模型思考过程 · reasoning
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-zinc-500">
                {reasoning}
              </pre>
            </details>
          )}
          <div className="rounded-lg border border-white/10 bg-black/30">
            <div className="px-3 py-1.5 text-xs text-zinc-400">
              实时输出 · streaming
              {running && <span className="ml-1 animate-pulse text-emerald-400">▍</span>}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-5 text-zinc-300">
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
      <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
    );
  }
  if (status === "done") {
    return <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500" />;
  }
  return <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white/25" />;
}
