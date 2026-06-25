"use client";

import type { ReactNode } from "react";

export type TabItem = {
  value: string;
  label: ReactNode;
  count?: number;
};

/**
 * 受控分段切换。推广回测三模式 / momentum 三 Tab 的一致观感。
 */
export default function Tabs({
  items,
  value,
  onChange,
  className = "",
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-1 ${className}`}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--text-sm)] font-medium transition duration-[var(--dur-fast)] ${
              active
                ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {it.label}
            {it.count != null && (
              <span className="tnum text-[var(--text-xs)] text-[var(--faint)]">
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
