"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Clock,
  CornerDownLeft,
  LineChart,
  CandlestickChart,
  Hash,
  type LucideIcon,
} from "lucide-react";
import {
  NAV_ITEMS,
  ROUTE_META,
  searchNavItems,
} from "@/lib/navConfig";
import {
  getRecentVisits,
  recordPageVisit,
  recordStockVisit,
  type RecentVisit,
} from "@/lib/recentVisits";

/** 唤起命令面板的全局事件名（Topbar 搜索框点击亦派发）。 */
export const OPEN_EVENT = "serenity-open-command-palette";

type Section = "stock" | "page" | "recent";

type Action = {
  id: string;
  section: Section;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** 右侧提示，如「新开页」。 */
  hint?: string;
  run: () => void;
};

const SECTION_LABEL: Record<Section, string> = {
  stock: "个股直达",
  page: "页面",
  recent: "最近访问",
};

function iconForHref(href: string): LucideIcon {
  return NAV_ITEMS.find((i) => i.href === href)?.icon ?? Hash;
}

/**
 * 全局命令面板（⌘K / Ctrl+K）：
 * - 输入页面名 / 拼音 / 英文 模糊跳转（结构性导航，同标签页）。
 * - 输入 6 位代码 → 个股分析 / K 线图表 两个动作（新开页，沿用 v0.47.1 口径）。
 * - 空输入展示最近访问（localStorage）。键盘 ↑↓ 选择 / 回车执行 / Esc 关闭。
 */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentVisit[]>([]);
  const [focusTick, setFocusTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const goPage = useCallback(
    (href: string) => {
      recordPageVisit(href);
      router.push(href);
      setOpen(false);
    },
    [router],
  );

  const openStock = useCallback(
    (base: "/analyze" | "/chart", code: string) => {
      recordStockVisit(code);
      window.open(
        `${base}?code=${code}`,
        "_blank",
        "noopener,noreferrer",
      );
      setOpen(false);
    },
    [],
  );

  // 选中最近个股：回填代码并聚焦输入，露出「分析 / 图表」两个直达动作。
  const selectStockCode = useCallback((code: string) => {
    setQuery(code);
    setActive(0);
    setFocusTick((t) => t + 1);
  }, []);

  // 通过 focusTick 在 effect 中聚焦输入（避免在渲染期访问 ref）。
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [focusTick, open]);

  // 全局快捷键 + 外部唤起事件。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // 打开时复位输入 / 选中、读取最近访问、锁定背景滚动、聚焦输入。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setRecent(getRecentVisits(8));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    const code = query.match(/\d{6}/)?.[0];
    if (code) {
      list.push({
        id: `stock-analyze-${code}`,
        section: "stock",
        icon: LineChart,
        title: `个股分析 · ${code}`,
        subtitle: "AI 可证伪打分 + 基本面",
        hint: "新开页",
        run: () => openStock("/analyze", code),
      });
      list.push({
        id: `stock-chart-${code}`,
        section: "stock",
        icon: CandlestickChart,
        title: `K 线图表 · ${code}`,
        subtitle: "Pro 画布 / 买卖点",
        hint: "新开页",
        run: () => openStock("/chart", code),
      });
    }

    if (query.trim()) {
      for (const hit of searchNavItems(query)) {
        list.push({
          id: `page-${hit.href}`,
          section: "page",
          icon: hit.icon,
          title: hit.label,
          subtitle: hit.group,
          run: () => goPage(hit.href),
        });
      }
      return list;
    }

    // 空输入：展示最近访问。
    for (const v of recent) {
      if (v.type === "page") {
        const meta = ROUTE_META[v.href];
        if (!meta) continue;
        list.push({
          id: `recent-page-${v.href}`,
          section: "recent",
          icon: iconForHref(v.href),
          title: meta.title,
          subtitle: meta.group,
          run: () => goPage(v.href),
        });
      } else {
        list.push({
          id: `recent-stock-${v.code}`,
          section: "recent",
          icon: LineChart,
          title: `个股 · ${v.code}`,
          subtitle: "选择后可直达分析 / 图表",
          run: () => selectStockCode(v.code),
        });
      }
    }
    return list;
  }, [query, recent, goPage, openStock, selectStockCode]);

  // query / 结果变化时复位选中，并保持在范围内。
  useEffect(() => {
    setActive((a) => (a >= actions.length ? 0 : a));
  }, [actions.length]);

  // 选中项滚动进可视区。
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (actions.length ? (a + 1) % actions.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) =>
        actions.length ? (a - 1 + actions.length) % actions.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      actions[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  let lastSection: Section | null = null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label="全局命令面板"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />
      <div
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="搜索页面，或输入 6 位代码直达个股…"
            aria-label="搜索页面或个股代码"
            className="h-12 w-full bg-transparent text-[var(--text-body)] text-[var(--text)] outline-none placeholder:text-[var(--faint)]"
          />
          <kbd className="hidden shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--faint)] sm:inline-block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[54vh] overflow-y-auto px-2 py-2">
          {actions.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--text-sm)] text-[var(--faint)]">
              {query.trim() ? "未找到匹配的页面或个股" : "暂无最近访问"}
            </p>
          ) : (
            actions.map((a, idx) => {
              const showHeader = a.section !== lastSection;
              lastSection = a.section;
              const Icon = a.icon;
              const isActive = idx === active;
              return (
                <div key={a.id}>
                  {showHeader && (
                    <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">
                      {a.section === "recent" && (
                        <Clock className="mr-1 inline h-3 w-3 align-[-1px]" />
                      )}
                      {SECTION_LABEL[a.section]}
                    </p>
                  )}
                  <button
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => a.run()}
                    onMouseMove={() => setActive(idx)}
                    className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition duration-[var(--dur-fast)] ${
                      isActive ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
                    }`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] border transition duration-[var(--dur-fast)] ${
                        isActive
                          ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--inset)] text-[var(--muted)]"
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[var(--text-sm)] ${
                          isActive
                            ? "font-medium text-[var(--accent)]"
                            : "text-[var(--text)]"
                        }`}
                      >
                        {a.title}
                      </span>
                      {a.subtitle && (
                        <span className="block truncate text-[var(--text-xs)] text-[var(--faint)]">
                          {a.subtitle}
                        </span>
                      )}
                    </span>
                    {a.hint && (
                      <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                        {a.hint}
                      </span>
                    )}
                    {isActive && (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--faint)]">
          <span className="flex items-center gap-2">
            <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1 py-0.5">↑↓</kbd>
            选择
            <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1 py-0.5">↵</kbd>
            打开
          </span>
          <span>页面同窗跳转 · 个股新开页</span>
        </div>
      </div>
    </div>
  );
}
