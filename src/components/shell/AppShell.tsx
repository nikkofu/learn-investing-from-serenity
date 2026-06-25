"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CommandPalette from "./CommandPalette";
import { recordPageVisit } from "@/lib/recentVisits";

const LS_KEY = "serenity-sidebar-collapsed";

/**
 * 应用外壳：组合精简顶栏 + 可折叠侧边栏 + 主内容 + 页脚，响应式。
 * 桌面侧栏 sticky 可折叠（记忆 localStorage）；窄屏转抽屉式 + 遮罩。
 */
export default function AppShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY) === "1") setCollapsed(true);
    } catch {}
  }, []);

  // 记录页面访问，供命令面板「最近访问」消费。
  useEffect(() => {
    recordPageVisit(pathname);
  }, [pathname]);

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onToggleMobile={() => setMobileOpen(true)}
      />
      <div className="flex flex-1">
        {/* 桌面侧栏 */}
        <div className="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-y-auto md:block">
          <Sidebar collapsed={collapsed} className="h-full" />
        </div>

        {/* 移动抽屉 */}
        {mobileOpen && (
          <div className="fixed inset-0 z-[60] md:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0 overflow-y-auto shadow-[var(--shadow-lg)]">
              <Sidebar
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
                className="min-h-full"
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
          {footer}
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
