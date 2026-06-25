import type { ReactNode } from "react";

/**
 * 区块小标题：左侧标题 + 可选描述，右侧可选「查看全部 →」等操作。
 */
export default function SectionTitle({
  title,
  desc,
  action,
  className = "",
}: {
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[var(--text-h2)] font-semibold leading-[var(--lh-h2)] text-[var(--text)]">
          {title}
        </h2>
        {desc != null && (
          <p className="mt-0.5 text-[var(--text-sm)] leading-[var(--lh-sm)] text-[var(--muted)]">
            {desc}
          </p>
        )}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
