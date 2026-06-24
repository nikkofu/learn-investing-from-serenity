"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeSwitcher, { ModeToggle } from "@/components/ThemeSwitcher";
import ModelSelector from "@/components/ModelSelector";

const LINKS = [
  { href: "/", label: "概览" },
  { href: "/methodology", label: "方法论 / 知识库" },
  { href: "/map", label: "趋势→产业链" },
  { href: "/analyze", label: "个股分析" },
  { href: "/watchlist", label: "自选 / 收藏" },
  { href: "/scanner", label: "热门股扫描" },
  { href: "/mining", label: "智能挖掘" },
  { href: "/backtest", label: "回测" },
  { href: "/momentum", label: "动量轮动" },
  { href: "/arb", label: "套利雷达" },
  { href: "/alerts", label: "盘中盯盘" },
  { href: "/strategies", label: "策略市场" },
  { href: "/paper", label: "纸面交易" },
  { href: "/sectors", label: "板块热力" },
  { href: "/sync", label: "数据同步" },
  { href: "/settings", label: "设置" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--nav-bg)] backdrop-blur">
      <nav className="flex w-full items-center gap-1 px-4 py-3 sm:gap-2 sm:px-6 lg:px-8">
        <Link href="/" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">瓶</span>
          <span className="hidden sm:inline">Serenity 瓶颈点投研台</span>
        </Link>
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector />
          <ThemeSwitcher />
          <ModeToggle />
        </div>
      </nav>
    </header>
  );
}
