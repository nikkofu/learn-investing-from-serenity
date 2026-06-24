"use client";

import { useEffect, useState } from "react";

/**
 * 全站通用的「★ 收藏」开关。落库走 /api/watchlist/favorites。
 *
 * 多个按钮共享一份内存中的收藏集合（模块级单例 + 订阅），首屏只拉取一次，
 * 点击乐观更新、失败回滚，避免每个按钮各自请求整份清单。
 */

let favSet: Set<string> | null = null;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function ensureLoaded(): Promise<void> {
  if (favSet) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = fetch("/api/watchlist/favorites")
      .then((r) => r.json())
      .then((j: { favorites?: Array<{ code: string }> }) => {
        favSet = new Set((j.favorites ?? []).map((f) => f.code));
        notify();
      })
      .catch(() => {
        favSet = new Set();
      });
  }
  return loadPromise;
}

async function toggleFavorite(code: string, name?: string): Promise<void> {
  await ensureLoaded();
  const set = favSet!;
  const wasFav = set.has(code);
  // 乐观更新
  if (wasFav) set.delete(code);
  else set.add(code);
  notify();
  try {
    if (wasFav) {
      await fetch(`/api/watchlist/favorites?code=${encodeURIComponent(code)}`, { method: "DELETE" });
    } else {
      await fetch("/api/watchlist/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name }),
      });
    }
  } catch {
    // 回滚
    if (wasFav) set.add(code);
    else set.delete(code);
    notify();
  }
}

export default function FavoriteButton({
  code,
  name,
  className,
}: {
  code: string;
  name?: string;
  className?: string;
}) {
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    ensureLoaded();
    return () => {
      listeners.delete(rerender);
    };
  }, []);

  const fav = favSet?.has(code) ?? false;

  return (
    <button
      type="button"
      disabled={busy}
      title={fav ? "取消收藏" : "收藏个股"}
      aria-label={fav ? "取消收藏" : "收藏个股"}
      aria-pressed={fav}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setBusy(true);
        await toggleFavorite(code, name);
        setBusy(false);
      }}
      className={`inline-flex items-center justify-center leading-none transition disabled:opacity-50 ${
        fav ? "text-amber-400" : "text-[var(--faint)] hover:text-amber-400"
      } ${className ?? ""}`}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 17.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85z" />
      </svg>
    </button>
  );
}
