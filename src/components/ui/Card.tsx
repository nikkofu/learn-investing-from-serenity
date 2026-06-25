import type { ReactNode } from "react";

const PAD = { none: "", sm: "p-3", md: "p-4", lg: "p-5" } as const;

/**
 * 标准卡片容器：统一 --surface 底 + --border 描边 + --radius-lg 圆角 + --shadow-sm。
 * interactive 时 hover 抬升并高亮描边（用于可点模块卡）。
 */
export default function Card({
  children,
  className = "",
  padding = "lg",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  padding?: keyof typeof PAD;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] ${PAD[padding]} ${
        interactive
          ? "transition duration-[var(--dur)] hover:border-[var(--accent-line)] hover:shadow-[var(--shadow-md)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
