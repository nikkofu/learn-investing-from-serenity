"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";

type SyncSourceId = "serenity" | "hotRank" | "industrySectors" | "sectorStocks" | "hotSectors";

interface SyncSourceStatus {
  id: SyncSourceId;
  label: string;
  description: string;
  file: string;
  heavy?: boolean;
  available: boolean;
  count: number;
  lastSyncAt: string | null;
  version: number;
  remoteUpdatedAt?: string | null;
  localRemoteUpdatedAt?: string | null;
  upToDate?: boolean;
}

interface SyncResult {
  id: SyncSourceId;
  ok: boolean;
  count: number;
  message: string;
  durationMs: number;
  version?: number;
  changed?: boolean;
  error?: string;
}

type RunState = "idle" | "running" | "ok" | "err";

interface RowState {
  state: RunState;
  message: string;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "暂未同步";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "暂未同步" : d.toLocaleString("zh-CN");
}

export default function SyncCenterPage() {
  const [sources, setSources] = useState<SyncSourceStatus[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);

  const setRow = (id: string, s: RowState) => setRows((prev) => ({ ...prev, [id]: s }));

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/sync");
      const data = await res.json();
      if (Array.isArray(data.sources)) setSources(data.sources);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  async function syncOne(id: SyncSourceId): Promise<SyncResult | null> {
    setRow(id, { state: "running", message: "同步中…" });
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: id }),
      });
      const data = await res.json();
      const result: SyncResult | undefined = data.result;
      if (!res.ok || !result || !result.ok) {
        const msg = result?.error || data.error || "同步失败";
        setRow(id, { state: "err", message: msg });
        return result ?? null;
      }
      const verTxt = result.version != null ? `v${result.version}` : "";
      const changeTxt = result.changed === false ? "（内容无变化）" : result.changed ? "（内容已更新）" : "";
      setRow(id, { state: "ok", message: `${result.message} ${verTxt}${changeTxt} · 耗时 ${(result.durationMs / 1000).toFixed(1)}s` });
      return result;
    } catch (err) {
      setRow(id, { state: "err", message: err instanceof Error ? err.message : "同步失败" });
      return null;
    }
  }

  async function handleSyncAll() {
    setRunningAll(true);
    for (const s of sources) {
      await syncOne(s.id);
    }
    await fetchStatus();
    setRunningAll(false);
  }

  async function handleSyncSingle(id: SyncSourceId) {
    await syncOne(id);
    await fetchStatus();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据同步中心"
        subtitle={
          <>
            一键依次同步运营所需数据：Serenity 最新消息、热门股票排行、行业板块、个股清单、热门板块、TradingView 热门策略（参考）。
            数据落盘后可供选股/分析与已配置的 LLM 使用。也可由自有程序调用 <code className="text-[var(--accent)]">POST /api/sync</code>（<code>{`{ source: "all" | <id> }`}</code>）。
          </>
        }
        actions={
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={runningAll || loading}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer select-none"
          >
            {runningAll ? "正在依次同步…" : "依次同步全部"}
          </button>
        }
      />

      <div className="space-y-3">
        {loading && sources.length === 0 && (
          <p className="text-sm text-[var(--muted)]">加载状态中…</p>
        )}
        {sources.map((s, i) => {
          const row = rows[s.id] ?? { state: "idle" as RunState, message: "" };
          const dot =
            row.state === "running" ? "bg-amber-400 animate-pulse" :
            row.state === "ok" ? "bg-emerald-500" :
            row.state === "err" ? "bg-red-500" :
            s.available ? "bg-sky-500" : "bg-[var(--faint)]";
          return (
            <div key={s.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[var(--faint)]">{i + 1}</span>
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <h3 className="text-sm font-semibold text-[var(--text)]">{s.label}</h3>
                    {s.heavy && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-500">耗时较长</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{s.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-[var(--faint)]">
                    <span>版本 <b className="text-[var(--accent)]">{s.version > 0 ? `v${s.version}` : "--"}</b></span>
                    <span>记录数 <b className="text-[var(--text)]">{s.count.toLocaleString()}</b></span>
                    <span>上次同步 {fmtTime(s.lastSyncAt)}</span>
                    <span className="truncate" title={s.file}>{s.file}</span>
                  </div>
                  {s.id === "serenity" && s.remoteUpdatedAt != null && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--faint)]">
                      <span>远端更新 {fmtTime(s.remoteUpdatedAt)}</span>
                      {s.upToDate ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-500">已最新</span>
                      ) : (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-500">有新数据，可同步</span>
                      )}
                    </div>
                  )}
                  {row.message && (
                    <p className={`mt-1.5 text-xs ${
                      row.state === "ok" ? "text-emerald-400" :
                      row.state === "err" ? "text-red-400" : "text-[var(--muted)]"
                    }`}>
                      {row.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleSyncSingle(s.id)}
                  disabled={runningAll || row.state === "running"}
                  className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50 cursor-pointer select-none"
                >
                  {row.state === "running" ? "同步中…" : "单独同步"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-5 text-[var(--faint)]">
        数据来自东方财富/腾讯财经及 GitHub 公开接口，仅供研究学习。行情接口有频率限制，「依次同步全部」中「个股清单」会逐板块抓取，耗时可能较长，请耐心等待。
      </p>
    </div>
  );
}
