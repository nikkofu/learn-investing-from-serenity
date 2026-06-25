"use client";

import { useMemo, useState, type ReactNode } from "react";

export type ColumnAlign = "left" | "right" | "center";
export type SortDir = "asc" | "desc";

export type Column<T> = {
  key: string;
  header: ReactNode;
  align?: ColumnAlign;
  sortable?: boolean;
  render?: (row: T, index: number) => ReactNode;
  /** 提供后该列可排序；返回 number 或 string 作排序键。 */
  sortValue?: (row: T) => number | string;
  className?: string;
};

function alignCls(a?: ColumnAlign): string {
  if (a === "right") return "text-right";
  if (a === "center") return "text-center";
  return "text-left";
}

/**
 * 通用数据表：粘性表头 + 可排序列 + 行 hover + 等宽数字对齐。
 * 提炼自 v0.46 回测表的 TradingView 化能力，供全站复用。
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  className = "",
  emptyText = "暂无数据",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  initialSort?: { key: string; dir: SortDir };
  className?: string;
  emptyText?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(
    initialSort ?? null,
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sortValue) return rows;
    const sv = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  };

  return (
    <div
      className={`overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] ${className}`}
    >
      <table className="w-full border-collapse text-[var(--text-sm)]">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--border)]">
          <tr>
            {columns.map((c) => {
              const dir = sort && sort.key === c.key ? sort.dir : null;
              return (
                <th
                  key={c.key}
                  onClick={c.sortable ? () => toggle(c.key) : undefined}
                  className={`tnum whitespace-nowrap px-3 py-2.5 text-[var(--text-xs)] font-semibold text-[var(--muted)] ${alignCls(
                    c.align,
                  )} ${
                    c.sortable
                      ? "cursor-pointer select-none hover:text-[var(--text)]"
                      : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {c.sortable && (
                      <span className="text-[10px] opacity-70">
                        {dir === "desc" ? "▼" : dir === "asc" ? "▲" : "↕"}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-[var(--muted)]"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className="border-t border-[var(--border)] transition duration-[var(--dur-fast)] hover:bg-[var(--hover)]"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${alignCls(c.align)} ${c.className ?? ""}`}
                  >
                    {c.render
                      ? c.render(row, i)
                      : String(
                          (row as Record<string, unknown>)[c.key] ?? "",
                        )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
