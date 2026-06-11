"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "概览" },
  { href: "/methodology", label: "方法论 / 知识库" },
  { href: "/map", label: "趋势→产业链" },
  { href: "/analyze", label: "个股分析" },
  { href: "/settings", label: "设置" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0f17]/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-3 sm:gap-2">
        <Link href="/" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-500/15 text-emerald-400">瓶</span>
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
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
