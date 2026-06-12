"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeSwitcher from "@/components/ThemeSwitcher";

const LINKS = [
  { href: "/", label: "概览" },
  { href: "/methodology", label: "方法论 / 知识库" },
  { href: "/map", label: "趋势→产业链" },
  { href: "/analyze", label: "个股分析" },
  { href: "/scanner", label: "热门股扫描" },
  { href: "/settings", label: "设置" },
];

export default function Nav() {
  const pathname = usePathname();
  const [config, setConfig] = useState<{ provider: string; model: string } | null>(null);

  useEffect(() => {
    function fetchConfig() {
      fetch("/api/config")
        .then((res) => res.json())
        .then((data) => {
          if (data && data.provider && data.model) {
            setConfig({ provider: data.provider, model: data.model });
          } else {
            setConfig(null);
          }
        })
        .catch(() => {});
    }

    fetchConfig();

    window.addEventListener("llm-config-updated", fetchConfig);
    return () => {
      window.removeEventListener("llm-config-updated", fetchConfig);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--nav-bg)] backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-3 sm:gap-2">
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
        {config && (
          <div className="hidden lg:flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-mono text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-[var(--text)]">{config.provider}</span>
            <span className="opacity-40">/</span>
            <span className="max-w-[120px] truncate" title={config.model}>
              {config.model}
            </span>
          </div>
        )}
        <ThemeSwitcher />
      </nav>
    </header>
  );
}
