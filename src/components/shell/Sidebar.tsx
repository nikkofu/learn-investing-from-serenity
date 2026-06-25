"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, activeHref } from "@/lib/navConfig";

/**
 * 侧边导航：5 大分组 + 当前项高亮（左侧 accent 竖条 + accent-soft 底）。
 * collapsed=true 时收为图标栏（64px），悬停 title 提示。
 * onNavigate 用于移动抽屉点击后关闭。
 */
export default function Sidebar({
  collapsed,
  onNavigate,
  className = "",
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <aside
      className={`flex flex-col gap-4 border-r border-[var(--border)] bg-[var(--surface)] py-4 ${
        collapsed ? "w-16 px-2" : "w-60 px-3"
      } ${className}`}
    >
      {NAV_GROUPS.map((g) => (
        <div key={g.id} className="flex flex-col gap-0.5">
          {g.label &&
            (collapsed ? (
              <div className="mx-1.5 mb-1 mt-0.5 border-t border-[var(--border)]" />
            ) : (
              <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">
                {g.label}
              </p>
            ))}
          {g.items.map((it) => {
            const isActive = active === it.href;
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={onNavigate}
                title={collapsed ? it.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[var(--text-sm)] transition duration-[var(--dur-fast)] ${
                  isActive
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                } ${collapsed ? "justify-center" : ""}`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
                )}
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                {!collapsed && <span className="truncate">{it.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
