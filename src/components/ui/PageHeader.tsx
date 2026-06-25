import type { ReactNode } from "react";

/**
 * 统一页头：标题 + 可选副标题 + 右侧操作区。
 * before 槽位用于挂面包屑等层级提示（v0.48.1 接入）。
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  before,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  before?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 ${className}`}>
      {before != null && <div className="mb-2">{before}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[var(--text-h1)] font-semibold leading-[var(--lh-h1)] tracking-tight text-[var(--text)]">
            {title}
          </h1>
          {subtitle != null && (
            <p className="mt-1 text-[var(--text-sm)] leading-[var(--lh-sm)] text-[var(--muted)]">
              {subtitle}
            </p>
          )}
        </div>
        {actions != null && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
