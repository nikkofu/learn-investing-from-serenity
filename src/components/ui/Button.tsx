import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 border border-transparent",
  secondary:
    "border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]",
  ghost:
    "border border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]",
  danger: "bg-red-500 text-white hover:bg-red-600 border border-transparent",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-[var(--text-xs)]",
  md: "px-3.5 py-2 text-[var(--text-sm)]",
};

/**
 * 统一按钮：variant（primary/secondary/ghost/danger）× size（sm/md）。
 * 透传原生 button 属性（onClick/disabled/type 等）。
 */
export default function Button({
  children,
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] font-medium transition duration-[var(--dur-fast)] disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
