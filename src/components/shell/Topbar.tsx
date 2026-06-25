"use client";

import Link from "next/link";
import { Menu, PanelLeft, PanelLeftClose } from "lucide-react";
import ThemeSwitcher, { ModeToggle } from "@/components/ThemeSwitcher";
import ModelSelector from "@/components/ModelSelector";
import Breadcrumbs from "./Breadcrumbs";

/**
 * 精简顶栏（56px）：移动汉堡 / 桌面折叠按钮 + Logo + 面包屑 + 模型/主题/明暗。
 */
export default function Topbar({
  collapsed,
  onToggleCollapse,
  onToggleMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleMobile: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-[var(--nav-bg)] px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        onClick={onToggleMobile}
        aria-label="打开菜单"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
        className="hidden h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] md:inline-flex"
      >
        {collapsed ? (
          <PanelLeft className="h-5 w-5" />
        ) : (
          <PanelLeftClose className="h-5 w-5" />
        )}
      </button>

      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
      >
        <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
          瓶
        </span>
        <span className="hidden text-[var(--text-sm)] lg:inline">
          Serenity 瓶颈点投研台
        </span>
      </Link>

      <div className="mx-1 hidden h-5 w-px shrink-0 bg-[var(--border)] sm:block" />
      <div className="hidden min-w-0 flex-1 sm:block">
        <Breadcrumbs />
      </div>

      <div className="flex flex-1 sm:flex-none" />

      <div className="flex shrink-0 items-center gap-2">
        <ModelSelector />
        <ThemeSwitcher />
        <ModeToggle />
      </div>
    </header>
  );
}
