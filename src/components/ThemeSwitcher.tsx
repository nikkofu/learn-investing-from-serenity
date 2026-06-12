"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const THEMES = [
  { id: "emerald", label: "翡翠墨黑", desc: "深色 · 翡翠绿", bg: "#0b0f17", accent: "#10b981" },
  { id: "azure", label: "宝蓝咨询", desc: "海军蓝 · 宝蓝", bg: "#0a0f1e", accent: "#4f9cff" },
  { id: "violet", label: "午夜紫金", desc: "深色 · 紫 + 金", bg: "#120c1f", accent: "#a78bfa" },
  { id: "teal", label: "石墨青橙", desc: "石板灰 · 青 + 橙", bg: "#0e1316", accent: "#2dd4bf" },
  { id: "cream", label: "奶油浅色", desc: "浅色 · 森绿", bg: "#f6f4ee", accent: "#047857" },
  { id: "aurora-frost", label: "极光冰川", desc: "渐变 · 冰川蓝 (毛玻璃)", bg: "linear-gradient(135deg, #090a0f, #131722)", accent: "#38bdf8" },
  { id: "lava-gold", label: "熔岩赤金", desc: "渐变 · 熔岩金 (毛玻璃)", bg: "linear-gradient(135deg, #0a0807, #17120e)", accent: "#f59e0b" },
  { id: "rainforest-mist", label: "雨林寒露", desc: "渐变 · 雨林绿 (毛玻璃)", bg: "linear-gradient(135deg, #f3f5f3, #e8efe9)", accent: "#059669" },
  { id: "glacier-aurora", label: "冰川极光", desc: "渐变 · 冰川蓝 (投研风)", bg: "linear-gradient(135deg, #edf3f8, #e3edf5)", accent: "#0284c7" },
  { id: "champagne-scroll", label: "香槟宣纸", desc: "渐变 · 香槟金 (书香风)", bg: "linear-gradient(135deg, #faf7f2, #eae3d2)", accent: "#c2410c" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
const STORAGE_KEY = "serenity-theme";
const DEFAULT_THEME: ThemeId = "emerald";

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): ThemeId {
  return (document.documentElement.dataset.theme as ThemeId) || DEFAULT_THEME;
}
function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}
function setTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export default function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="切换配色"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
      >
        <span
          className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-white/20"
          style={{ background: active.accent }}
        />
        <span className="hidden sm:inline">配色</span>
        <svg width="10" height="10" viewBox="0 0 10 6" className="opacity-60" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] p-1 shadow-xl">
          {THEMES.map((t) => {
            const sel = t.id === theme;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-[var(--hover)] ${
                  sel ? "bg-[var(--hover)]" : ""
                }`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1 ring-inset ring-white/10"
                  style={{ background: t.bg }}
                >
                  <span className="h-3.5 w-3.5 rounded-full" style={{ background: t.accent }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--text)]">{t.label}</span>
                  <span className="block text-[11px] text-[var(--faint)]">{t.desc}</span>
                </span>
                {sel && (
                  <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-[var(--accent)]" aria-hidden>
                    <path d="M2 7.5l3.2 3.2L12 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
