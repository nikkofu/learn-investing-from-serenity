"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui";
import { NAV_ITEMS } from "@/lib/navConfig";

/** 快捷研究入口：常用工作流页一键直达（新开页）。 */
const WORKFLOW_HREFS = ["/scanner", "/mining", "/backtest", "/arb", "/momentum", "/compare"] as const;

export default function QuickLinks() {
  const items = WORKFLOW_HREFS.map((href) => NAV_ITEMS.find((n) => n.href === href)).filter(
    (n): n is NonNullable<typeof n> => Boolean(n),
  );

  return (
    <Card className="flex h-full flex-col gap-3">
      <SectionTitle title="快捷研究入口" desc="常用工作流一键直达" />
      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 transition duration-[var(--dur)] hover:border-[var(--accent-line)] hover:bg-[var(--hover)]"
            >
              <Icon className="h-5 w-5 text-[var(--muted)] transition group-hover:text-[var(--accent)]" />
              <span className="text-[var(--text-sm)] text-[var(--text)]">{it.label}</span>
            </Link>
          );
        })}
      </div>
      <p className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--faint)]">
        <Compass className="h-3.5 w-3.5" /> 更多入口见左侧导航
      </p>
    </Card>
  );
}
