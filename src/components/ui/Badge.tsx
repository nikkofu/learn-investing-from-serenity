import type { ReactNode } from "react";

export type BadgeTone =
  | "accent"
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "neutral";

/**
 * 语义徽章。注意：tone 表达「语义状态」（成功/警告/危险等），
 * 不用于表达 A 股涨跌方向——涨跌请用热力图 token（红涨绿跌）。
 */
const TONES: Record<BadgeTone, string> = {
  accent:
    "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]",
  success: "bg-emerald-500/12 text-emerald-400 border-emerald-500/30",
  warn: "bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]",
  danger: "bg-red-500/12 text-red-400 border-red-500/30",
  info: "bg-sky-500/12 text-sky-400 border-sky-500/30",
  neutral: "bg-[var(--panel)] text-[var(--muted)] border-[var(--border)]",
};

export default function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[var(--text-xs)] font-medium leading-[var(--lh-xs)] ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
