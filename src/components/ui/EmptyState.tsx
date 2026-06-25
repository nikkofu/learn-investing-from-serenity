import type { ReactNode } from "react";

/**
 * 统一空 / 失败占位：图标 + 标题 + 描述 + 可选操作。
 * 替代各页裸 loading / 空白文字。
 */
export default function EmptyState({
  icon,
  title,
  desc,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] px-6 py-10 text-center ${className}`}
    >
      {icon != null && <div className="text-[var(--faint)]">{icon}</div>}
      <p className="text-[var(--text-h3)] font-semibold leading-[var(--lh-h3)] text-[var(--text)]">
        {title}
      </p>
      {desc != null && (
        <p className="max-w-sm text-[var(--text-sm)] leading-[var(--lh-sm)] text-[var(--muted)]">
          {desc}
        </p>
      )}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
