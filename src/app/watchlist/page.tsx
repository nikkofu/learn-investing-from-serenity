"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StockLink from "@/components/StockLink";

// ── 类型（与 /api/watchlist/* 对齐）────────────────────────────────────────────
interface FavoriteStock {
  code: string;
  name: string;
  note?: string;
  addedAt: string;
}
interface StockPool {
  id: string;
  name: string;
  codes: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}
type ScreenScope = "scanner" | "momentum" | "arb";
interface SavedScreen {
  id: string;
  name: string;
  scope: ScreenScope;
  params: Record<string, string | number | boolean>;
  createdAt: string;
}

type Tab = "favorites" | "pools" | "screens";

const SCOPE_LABEL: Record<ScreenScope, string> = {
  scanner: "热门股扫描",
  momentum: "动量轮动",
  arb: "套利雷达",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

/** 把筛选参数拼成对应页面的深链。 */
function screenHref(s: SavedScreen): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(s.params)) q.set(k, String(v));
  const base = s.scope === "scanner" ? "/scanner" : s.scope === "momentum" ? "/momentum" : "/arb";
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export default function WatchlistPage() {
  const [tab, setTab] = useState<Tab>("favorites");
  const [favorites, setFavorites] = useState<FavoriteStock[]>([]);
  const [pools, setPools] = useState<StockPool[]>([]);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshAll() {
    setLoading(true);
    try {
      const [f, p, s] = await Promise.all([
        fetch("/api/watchlist/favorites").then((r) => r.json()),
        fetch("/api/watchlist/pools").then((r) => r.json()),
        fetch("/api/watchlist/screens").then((r) => r.json()),
      ]);
      setFavorites(f.favorites ?? []);
      setPools(p.pools ?? []);
      setScreens(s.screens ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  return (
    <div className="w-full space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {([
            ["favorites", `收藏个股（${favorites.length}）`],
            ["pools", `我的股票池（${pools.length}）`],
            ["screens", `保存的筛选（${screens.length}）`],
          ] as Array<[Tab, string]>).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                tab === k
                  ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)]">自选 / 收藏</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          统一管理<strong>收藏个股</strong>、<strong>自定义股票池</strong>（套利雷达即按池内成分两两配对）与<strong>保存的筛选</strong>。
          全部落 <code>.data/</code> 本地持久化，可一键深链到扫描 / 动量 / 套利页复用。仅供研究，不构成投资建议。
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted)]">载入中…</div>
      ) : (
        <>
          {tab === "favorites" && <FavoritesSection favorites={favorites} onChange={setFavorites} pools={pools} onPoolsChange={setPools} />}
          {tab === "pools" && <PoolsSection pools={pools} onChange={setPools} />}
          {tab === "screens" && <ScreensSection screens={screens} onChange={setScreens} />}
        </>
      )}
    </div>
  );
}

// ── 收藏个股 ──────────────────────────────────────────────────────────────────
function FavoritesSection({
  favorites,
  onChange,
  pools,
  onPoolsChange,
}: {
  favorites: FavoriteStock[];
  onChange: (next: FavoriteStock[]) => void;
  pools: StockPool[];
  onPoolsChange: (next: StockPool[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove(code: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/watchlist/favorites?code=${encodeURIComponent(code)}`, { method: "DELETE" });
      const json = await res.json();
      onChange(json.favorites ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function saveAllAsPool() {
    if (favorites.length === 0) return;
    const name = window.prompt("新股票池名称", `收藏池 ${pools.length + 1}`);
    if (name === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/watchlist/pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, codes: favorites.map((f) => f.code) }),
      });
      const json = await res.json();
      if (res.ok) onPoolsChange(json.pools ?? pools);
      else window.alert(json.error ?? "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (favorites.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
        暂无收藏。在动量榜、扫描器等列表点击 <span className="text-amber-400">★</span> 即可收藏个股。
      </div>
    );
  }

  const allCodes = favorites.map((f) => f.code).join(",");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button onClick={saveAllAsPool} disabled={busy} className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent)] hover:opacity-90 disabled:opacity-50">
          全部存为股票池
        </button>
        <Link href={`/scanner?codes=${allCodes}&title=${encodeURIComponent("我的收藏")}`} className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
          扫描全部收藏
        </Link>
        <Link href={`/momentum?codes=${allCodes}`} className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
          动量打分全部收藏
        </Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-3 py-2 font-medium">代码 / 名称</th>
              <th className="px-3 py-2 font-medium">备注</th>
              <th className="px-3 py-2 font-medium">收藏时间</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {favorites.map((f) => (
              <tr key={f.code} className="border-b border-[var(--border)]">
                <td className="px-3 py-2"><StockLink code={f.code} name={f.name} newTab /></td>
                <td className="px-3 py-2 text-[var(--muted)]">{f.note || "—"}</td>
                <td className="px-3 py-2 tabular-nums text-[var(--faint)]">{fmtDate(f.addedAt)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => remove(f.code)} disabled={busy} className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] hover:border-red-500/40 hover:text-red-400 disabled:opacity-50">
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 我的股票池 ────────────────────────────────────────────────────────────────
function PoolsSection({ pools, onChange }: { pools: StockPool[]; onChange: (next: StockPool[]) => void }) {
  const [name, setName] = useState("");
  const [codesText, setCodesText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist/pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, codes: codesText, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "保存失败");
      onChange(json.pools ?? pools);
      setName("");
      setCodesText("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/watchlist/pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, codes: editText }),
      });
      const json = await res.json();
      if (res.ok) {
        onChange(json.pools ?? pools);
        setEditId(null);
      } else {
        window.alert(json.error ?? "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("确认删除该股票池？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/watchlist/pools?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      onChange(json.pools ?? pools);
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">新建股票池</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="如：白酒龙头 / 我的核心池" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">备注（可选）</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">成分股（6 位代码，逗号/空格/换行分隔）</span>
          <textarea value={codesText} onChange={(e) => setCodesText(e.target.value)} rows={3} className={`${inputCls} font-mono`} placeholder="600519,000858,300750 ..." />
        </label>
        <div className="flex items-center gap-3">
          <button onClick={create} disabled={busy} className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50">
            {busy ? "保存中…" : "保存股票池"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {pools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">暂无股票池。</div>
      ) : (
        <div className="space-y-3">
          {pools.map((p) => {
            const codesStr = p.codes.join(",");
            return (
              <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-[var(--text)]">
                    {p.name} <span className="ml-1 text-xs font-normal text-[var(--faint)]">{p.codes.length} 只 · 更新于 {fmtDate(p.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Link href={`/scanner?codes=${codesStr}&title=${encodeURIComponent(p.name)}`} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">扫描</Link>
                    <Link href={`/momentum?codes=${codesStr}`} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">动量</Link>
                    <Link href={`/arb?codes=${codesStr}`} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">套利</Link>
                    <button onClick={() => { setEditId(editId === p.id ? null : p.id); setEditText(codesStr); }} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--text)]">编辑</button>
                    <button onClick={() => remove(p.id)} disabled={busy} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:border-red-500/40 hover:text-red-400 disabled:opacity-50">删除</button>
                  </div>
                </div>
                {p.note && <div className="text-xs text-[var(--muted)]">{p.note}</div>}
                {editId === p.id ? (
                  <div className="space-y-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className={`${inputCls} w-full font-mono`} />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(p.id)} disabled={busy} className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50">保存</button>
                      <button onClick={() => setEditId(null)} className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">取消</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {p.codes.map((c) => (
                      <span key={c} className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-xs">
                        <StockLink code={c} newTab />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 保存的筛选 ────────────────────────────────────────────────────────────────
function ScreensSection({ screens, onChange }: { screens: SavedScreen[]; onChange: (next: SavedScreen[]) => void }) {
  const [busy, setBusy] = useState(false);

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/watchlist/screens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      onChange(json.screens ?? screens);
    } finally {
      setBusy(false);
    }
  }

  if (screens.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
        暂无保存的筛选。在套利雷达 / 动量轮动页设置好参数后，点「保存筛选」即可在此一键复用。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {screens.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="min-w-0">
            <div className="font-semibold text-[var(--text)]">
              {s.name} <span className="ml-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs font-normal text-[var(--muted)]">{SCOPE_LABEL[s.scope]}</span>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-[var(--faint)]">
              {Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join(" · ") || "（无参数）"}
            </div>
          </div>
          <div className="flex gap-1.5 text-xs">
            <Link href={screenHref(s)} className="rounded border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 font-semibold text-[var(--accent)] hover:opacity-90">应用</Link>
            <button onClick={() => remove(s.id)} disabled={busy} className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--muted)] hover:border-red-500/40 hover:text-red-400 disabled:opacity-50">删除</button>
          </div>
        </div>
      ))}
    </div>
  );
}
