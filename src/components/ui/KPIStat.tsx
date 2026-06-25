import type { ReactNode } from "react";

export type KPITone = "up" | "down" | "flat" | "neutral";

// A 股惯例：红涨绿跌（与全站热力图一致，不随主题色变）。
const TONE_COLOR: Record<KPITone, string> = {
  up: "#ef4444",
  down: "#10b981",
  flat: "var(--muted)",
  neutral: "var(--text)",
};

const ARROW: Record<KPITone, string> = {
  up: "▲",
  down: "▼",
  flat: "·",
  neutral: "",
};

/**
 * 指标卡：标签 + 大号等宽数字 + 可选涨跌变化（A 股红涨绿跌）。
 */
export default function KPIStat({
  label,
  value,
  delta,
  tone = "neutral",
  hint,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: KPITone;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[var(--text-xs)] leading-[var(--lh-xs)] text-[var(--muted)]">
        {label}
      </span>
      <span
        className="tnum font-mono text-[22px] font-semibold leading-7"
        style={{ color: TONE_COLOR[tone] }}
      >
        {value}
      </span>
      {delta != null && (
        <span
          className="tnum text-[var(--text-xs)] leading-[var(--lh-xs)]"
          style={{ color: TONE_COLOR[tone] }}
        >
          {ARROW[tone] && <span className="mr-0.5">{ARROW[tone]}</span>}
          {delta}
        </span>
      )}
      {hint != null && (
        <span className="text-[var(--text-xs)] leading-[var(--lh-xs)] text-[var(--faint)]">
          {hint}
        </span>
      )}
    </div>
  );
}
