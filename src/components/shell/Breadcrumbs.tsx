"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ROUTE_META, activeHref } from "@/lib/navConfig";

/**
 * 顶栏面包屑：基于 pathname 渲染「分组 / 父级 / 当前页」层级。
 * 仅用 pathname，避免 useSearchParams 的 Suspense 约束。
 */
export default function Breadcrumbs() {
  const pathname = usePathname();
  const ah = activeHref(pathname);
  const meta = ROUTE_META[pathname] ?? (ah ? ROUTE_META[ah] : undefined);
  if (!meta) return null;

  const crumbs: { label: string; href?: string }[] = [{ label: meta.group }];
  if (meta.parent && ROUTE_META[meta.parent]) {
    crumbs.push({ label: ROUTE_META[meta.parent].title, href: meta.parent });
  }
  crumbs.push({ label: meta.title });

  return (
    <nav
      aria-label="面包屑"
      className="flex min-w-0 items-center gap-1 text-[var(--text-sm)] text-[var(--muted)]"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
            )}
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-[var(--text)]">
                {c.label}
              </Link>
            ) : (
              <span
                className={`truncate ${last ? "font-medium text-[var(--text)]" : ""}`}
              >
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
