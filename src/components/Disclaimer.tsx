import { NFA, ARB_BOUNDARY, BACKTEST_BOUNDARY, FUNDAMENTALS_BOUNDARY, AI_BOUNDARY } from "@/lib/disclaimers";

const TEXT = {
  nfa: NFA,
  arb: ARB_BOUNDARY,
  backtest: BACKTEST_BOUNDARY,
  fundamentals: FUNDAMENTALS_BOUNDARY,
  ai: AI_BOUNDARY,
} as const;

export type DisclaimerVariant = keyof typeof TEXT;

/**
 * 「诚实边界」统一渲染组件（文案取自 src/lib/disclaimers.ts，§6 唯一可信源）。
 * 用于各页底部的标准免责注脚，保证全站口径与样式一致。
 */
export default function Disclaimer({
  variant = "nfa",
  className = "",
}: {
  variant?: DisclaimerVariant;
  className?: string;
}) {
  return (
    <p className={`text-[11px] leading-relaxed text-[var(--faint)] ${className}`}>{TEXT[variant]}</p>
  );
}
