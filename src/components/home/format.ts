import type { KPITone } from "@/components/ui/KPIStat";

/** 涨跌方向 → KPIStat 色调（A 股红涨绿跌由 KPIStat 内部上色）。 */
export function toneOf(pct: number): KPITone {
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
}

/** 带符号百分比，保留两位。 */
export function pctStr(pct: number): string {
  const v = Number.isFinite(pct) ? pct : 0;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/**
 * 涨跌文字色（A 股红涨绿跌，与 KPIStat / 热力图同口径，不随主题色变）。
 * 集中在此，避免在各模块散写颜色值。
 */
export function changeColor(pct: number): string {
  if (pct > 0) return "#ef4444";
  if (pct < 0) return "#10b981";
  return "var(--muted)";
}

/**
 * 板块热力图块配色类（复用 globals.css 的 .heat-* ，与 /sectors 一致）。
 * 阈值与板块页保持同口径。
 */
export function heatClass(pct: number): string {
  if (pct >= 4.0) return "heat-tile heat-up-3";
  if (pct >= 2.0) return "heat-tile heat-up-2";
  if (pct > 0.0) return "heat-tile heat-up-1";
  if (pct === 0) return "heat-tile heat-flat";
  if (pct > -2.0) return "heat-tile heat-dn-1";
  if (pct > -4.0) return "heat-tile heat-dn-2";
  return "heat-tile heat-dn-3";
}
