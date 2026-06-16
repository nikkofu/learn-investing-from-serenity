"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const THEMES = [
  {
    id: "pine-frost",
    label: "松针寒绿",
    desc: "经典翡翠墨绿 · 稳健平和",
    accent: "#10b981",
    bg: "#090c10",
    colors: ["#10b981", "#34d399", "#0f9f7f", "#0a7a61"],
  },
  {
    id: "indigo-aurora",
    label: "极光靛蓝",
    desc: "深空魔幻夜蓝 · 科技探索",
    accent: "#818cf8",
    bg: "#090a10",
    colors: ["#818cf8", "#a5b4fc", "#6366f1", "#4f46e5"],
  },
  {
    id: "sunset-coral",
    label: "日落珊瑚",
    desc: "暖意落日红粉 · 活泼灵动",
    accent: "#ff5a79",
    bg: "#0e0507",
    colors: ["#ff385c", "#ff5a79", "#ff8ba1", "#d90b30"],
  },
  {
    id: "bronze-amber",
    label: "古铜暖金",
    desc: "复古金棕微醺 · 沉稳高雅",
    accent: "#f59e0b",
    bg: "#14110f",
    colors: ["#f59e0b", "#fbbf24", "#cc5a01", "#964000"],
  },
  {
    id: "obsidian-cyber",
    label: "黑曜极客",
    desc: "超现实荧光青 · 未来极客",
    accent: "#22d3ee",
    bg: "#070b0e",
    colors: ["#22d3ee", "#67e8f9", "#38bdf8", "#00839c"],
  },
] as const;

export const MODES = [
  { id: "light", label: "明亮", icon: "☀️" },
  { id: "dark", label: "暗黑", icon: "🌙" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ModeId = (typeof MODES)[number]["id"];

const THEME_STORAGE_KEY = "serenity-theme";
const MODE_STORAGE_KEY = "serenity-mode";

const DEFAULT_THEME: ThemeId = "pine-frost";
const DEFAULT_MODE: ModeId = "dark";

let currentTheme: ThemeId = DEFAULT_THEME;
let currentMode: ModeId = DEFAULT_MODE;

if (typeof window !== "undefined") {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId;
    if (savedTheme && THEMES.some((t) => t.id === savedTheme)) {
      currentTheme = savedTheme;
    }
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY) as ModeId;
    if (savedMode && MODES.some((m) => m.id === savedMode)) {
      currentMode = savedMode;
    }
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return `${currentTheme}:${currentMode}`;
}

function getServerSnapshot() {
  return `${DEFAULT_THEME}:${DEFAULT_MODE}`;
}

async function updateConfig(themeId: ThemeId, modeId: ModeId) {
  currentTheme = themeId;
  currentMode = modeId;

  if (typeof window !== "undefined") {
    document.documentElement.setAttribute("data-theme", themeId);
    document.documentElement.setAttribute("data-mode", modeId);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
      localStorage.setItem(MODE_STORAGE_KEY, modeId);
    } catch {
      /* ignore */
    }
  }

  listeners.forEach((l) => l());

  try {
    await fetch("/api/theme", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ theme: themeId, mode: modeId }),
    });
  } catch (err) {
    console.error("Failed to persist theme/mode settings to server:", err);
  }
}

export default function ThemeSwitcher() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [themeStr, modeStr] = snapshot.split(":");
  const theme = (themeStr as ThemeId) || DEFAULT_THEME;
  const mode = (modeStr as ModeId) || DEFAULT_MODE;

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

  // 保证根节点属性持久同步
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("data-mode", mode);
    }
  }, [theme, mode]);

  const activeTheme = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="选择系统配色"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer"
      >
        <span
          className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-white/20"
          style={{ background: activeTheme.accent }}
        />
        <span className="hidden sm:inline">{activeTheme.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 6" className="opacity-60" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-60 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] p-2.5 shadow-xl">
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold tracking-wider text-[var(--faint)] uppercase block px-1 select-none">
              配色方案 (Color Theme)
            </span>
            <div className="space-y-1">
              {THEMES.map((t) => {
                const sel = t.id === theme;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      updateConfig(t.id, mode);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--hover)] cursor-pointer ${
                      sel ? "bg-[var(--hover)]" : ""
                    }`}
                  >
                    <span className="flex h-4.5 w-14 shrink-0 overflow-hidden rounded-md border border-[var(--border)]">
                      {t.colors.map((c, i) => (
                        <span key={i} className="h-full flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-[var(--text)]">{t.label}</span>
                      <span className="block text-[10px] text-[var(--faint)] truncate">{t.desc}</span>
                    </span>
                    {sel && (
                      <svg width="12" height="12" viewBox="0 0 14 14" className="shrink-0 text-[var(--accent)]" aria-hidden>
                        <path d="M2 7.5l3.2 3.2L12 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModeToggle() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [themeStr, modeStr] = snapshot.split(":");
  const theme = (themeStr as ThemeId) || DEFAULT_THEME;
  const mode = (modeStr as ModeId) || DEFAULT_MODE;

  const toggleMode = () => {
    const nextMode = mode === "light" ? "dark" : "light";
    updateConfig(theme, nextMode);
  };

  const isDark = mode === "dark";

  return (
    <button
      onClick={toggleMode}
      className="relative flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)] transition-all hover:bg-[var(--hover)] hover:text-[var(--text)] focus:outline-none cursor-pointer"
      aria-label={isDark ? "切换至明亮模式" : "切换至暗黑模式"}
    >
      <div className="relative h-4.5 w-4.5">
        {/* 太阳图标 */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`absolute inset-0 h-full w-full transition-all duration-500 ease-out transform ${
            isDark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"
          }`}
        >
          <circle cx="12" cy="12" r="5" fill="currentColor" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>

        {/* 月亮图标 */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`absolute inset-0 h-full w-full transition-all duration-500 ease-out transform ${
            isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0"
          }`}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      </div>
    </button>
  );
}
