"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 股票池 / 筛选 工具条（动量、套利等页通用）：
 *  - 「载入股票池」下拉：从 /api/watchlist/pools 取已存池，回填当前代码框。
 *  - 「存为股票池」：把当前代码列表保存为命名股票池。
 *  - 「保存筛选」（传入 screen 时显示）：把当前参数集存为命名筛选，可在 /watchlist 一键复用。
 */

interface Pool {
  id: string;
  name: string;
  codes: string[];
}

export type ScreenScope = "scanner" | "momentum" | "arb";

export default function PoolControls({
  codes,
  onLoad,
  screen,
  className,
}: {
  /** 当前已识别的 6 位代码列表。 */
  codes: string[];
  /** 选择已存池后的回填回调。 */
  onLoad: (codes: string[]) => void;
  /** 提供则显示「保存筛选」。 */
  screen?: { scope: ScreenScope; params: Record<string, string | number | boolean> };
  className?: string;
}) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function loadPools() {
    setOpen((v) => !v);
    if (pools) return;
    try {
      const json = await fetch("/api/watchlist/pools").then((r) => r.json());
      setPools(json.pools ?? []);
    } catch {
      setPools([]);
    }
  }

  function flash(text: string) {
    setMsg(text);
    window.setTimeout(() => setMsg(null), 2500);
  }

  async function saveAsPool() {
    if (codes.length === 0) {
      flash("当前没有可保存的代码");
      return;
    }
    const name = window.prompt("新股票池名称", "");
    if (name === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/watchlist/pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, codes }),
      });
      const json = await res.json();
      if (res.ok) {
        setPools(json.pools ?? null);
        flash(`已保存（${codes.length} 只）`);
      } else flash(json.error ?? "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveScreen() {
    if (!screen) return;
    const name = window.prompt("新筛选名称", "");
    if (name === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/watchlist/screens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scope: screen.scope, params: screen.params }),
      });
      const json = await res.json();
      flash(res.ok ? "筛选已保存" : json.error ?? "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const btnCls = "rounded border border-[var(--border)] px-2.5 py-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50";

  return (
    <div ref={boxRef} className={`relative flex flex-wrap items-center gap-1.5 text-xs ${className ?? ""}`}>
      <div className="relative">
        <button type="button" onClick={loadPools} className={btnCls}>载入股票池 ▾</button>
        {open && (
          <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-60 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
            {pools === null ? (
              <div className="px-3 py-2 text-[var(--faint)]">载入中…</div>
            ) : pools.length === 0 ? (
              <div className="px-3 py-2 text-[var(--faint)]">暂无已存股票池</div>
            ) : (
              pools.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onLoad(p.codes); setOpen(false); flash(`已载入「${p.name}」`); }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[var(--hover)]"
                >
                  <span className="truncate text-[var(--text)]">{p.name}</span>
                  <span className="shrink-0 text-[var(--faint)]">{p.codes.length} 只</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <button type="button" onClick={saveAsPool} disabled={busy} className={btnCls}>存为股票池</button>
      {screen && <button type="button" onClick={saveScreen} disabled={busy} className={btnCls}>保存筛选</button>}
      {msg && <span className="text-[var(--accent)]">{msg}</span>}
    </div>
  );
}
