"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupplyChainMap } from "@/lib/types";
import { ProgressTrace, applyStageEvent, type Stage } from "@/components/ProgressTrace";
import { readNdjson } from "@/lib/stream-client";

const SUGGESTIONS = ["AI 算力 / 光模块", "人形机器人", "半导体国产替代", "CPO / 硅光", "稀土永磁", "液冷数据中心"];

const MAP_STAGES: { key: string; label: string }[] = [
  { key: "reason", label: "AI 拆解产业链与瓶颈点" },
  { key: "summary", label: "整理产业链节点" },
];

export default function MapPage() {
  const [trend, setTrend] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [map, setMap] = useState<SupplyChainMap | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [content, setContent] = useState("");
  const [structured, setStructured] = useState("");

  async function run(t?: string) {
    const q = (t ?? trend).trim();
    if (!q) return;
    setTrend(q);
    setLoading(true);
    setError("");
    setMap(null);
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
          case "result":
            setMap(ev.map as SupplyChainMap);
            break;
          case "error":
            setError(ev.message as string);
            break;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "拆解失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">趋势 → 产业链瓶颈点拆解</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          输入一个确定性趋势，AI 按 Serenity 瓶颈点方法拆出产业链分层，并标注 A 股“卡脖子”环节。
        </p>
      </div>

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
            <a href="/settings" className="mt-1 inline-block text-[var(--accent)] underline">前往「设置」配置 LLM →</a>
          )}
        </div>
      )}

      {(loading || content || reasoning || structured || stages.some((s) => s.status !== "pending")) && (
        <ProgressTrace stages={stages} reasoning={reasoning} content={content} structured={structured} running={loading} />
      )}

      {map && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4">
            <p className="text-sm font-medium text-[var(--accent)]">瓶颈点总结</p>
            <p className="mt-1 text-sm leading-6 text-[var(--text)]">{map.summary}</p>
          </div>
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
                </div>
                <p className="mt-1 text-sm text-[var(--text)]">{n.role}</p>
                {n.isChokepoint && n.chokepointReason && (
                  <p className="mt-1 text-xs leading-5 text-[var(--accent)]">为何卡脖子：{n.chokepointReason}</p>
                )}
                {n.tickers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {n.tickers.map((t, j) => {
                      const inner = (
                        <>
                          <span className="font-medium text-[var(--text)]">{t.name}</span>
                          {t.code && <span className="ml-1 font-mono text-xs text-[var(--faint)]">{t.code}</span>}
                          {t.note && <p className="mt-0.5 max-w-[15rem] text-[11px] leading-4 text-[var(--muted)]">{t.note}</p>}
                        </>
                      );
                      return /^\d{6}$/.test(t.code) ? (
                        <Link key={j} href={`/analyze?code=${t.code}`} className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs transition hover:border-[var(--accent-line)]">
                          {inner}
                        </Link>
                      ) : (
                        <div key={j} className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs">{inner}</div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--faint)]">{map.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
