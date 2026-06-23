import type { Candle } from "./types";

/**
 * LLM 交互式画图：模型把技术分析意图输出为一组结构化「绘图基元」，
 * 前端在 Pro 画布上渲染（横线/趋势线/区间/标注）。所有数值经 sanitize 夹紧与吸附，
 * 杜绝模型给出越界价位或不存在的日期。
 */

export type DrawingColor = "support" | "resistance" | "neutral" | "bull" | "bear";

export interface HLineDrawing {
  type: "hline";
  price: number;
  label: string;
  color?: DrawingColor;
}
export interface TrendlineDrawing {
  type: "trendline";
  from: { date: string; price: number };
  to: { date: string; price: number };
  label: string;
  color?: DrawingColor;
}
export interface ZoneDrawing {
  type: "zone";
  priceLow: number;
  priceHigh: number;
  label: string;
  color?: DrawingColor;
}
export interface MarkerDrawing {
  type: "marker";
  date: string;
  price: number;
  text: string;
  color?: DrawingColor;
}
export type ChartDrawing = HLineDrawing | TrendlineDrawing | ZoneDrawing | MarkerDrawing;

export interface DrawPlan {
  rationale: string;
  drawings: ChartDrawing[];
}

export const MAX_DRAWINGS = 12;
const VALID_COLORS: DrawingColor[] = ["support", "resistance", "neutral", "bull", "bear"];

function asColor(v: unknown): DrawingColor | undefined {
  return typeof v === "string" && (VALID_COLORS as string[]).includes(v) ? (v as DrawingColor) : undefined;
}
function asStr(v: unknown, max = 40): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 把任意日期吸附到 K 线序列里最接近的真实交易日（按时间戳就近）。 */
function snapDate(date: unknown, candles: Candle[], dateSet: Set<string>): string | null {
  if (typeof date !== "string" || candles.length === 0) return null;
  const d = date.trim();
  if (dateSet.has(d)) return d;
  const t = Date.parse(d.replace(" ", "T"));
  if (!Number.isFinite(t)) return null;
  let best = candles[0].date;
  let bestDiff = Infinity;
  for (const c of candles) {
    const ct = Date.parse(c.date.replace(" ", "T"));
    const diff = Math.abs(ct - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c.date;
    }
  }
  return best;
}

/**
 * 校验/夹紧模型给出的绘图计划：价位夹到 [minLow*0.6, maxHigh*1.4]，
 * 日期吸附到真实交易日，丢弃非法基元，最多保留 MAX_DRAWINGS 条。
 */
export function sanitizeDrawPlan(raw: unknown, candles: Candle[]): DrawPlan {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rationale = asStr(obj.rationale, 600);
  const list = Array.isArray(obj.drawings) ? obj.drawings : [];

  if (candles.length === 0) return { rationale, drawings: [] };
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  const pMin = lo * 0.6;
  const pMax = hi * 1.4;
  const clampP = (p: number) => Math.max(pMin, Math.min(pMax, p));
  const dateSet = new Set(candles.map((c) => c.date));

  const out: ChartDrawing[] = [];
  for (const item of list) {
    if (out.length >= MAX_DRAWINGS) break;
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const color = asColor(d.color);
    switch (d.type) {
      case "hline": {
        const price = asNum(d.price);
        if (price === null) break;
        out.push({ type: "hline", price: clampP(price), label: asStr(d.label) || "水平线", color });
        break;
      }
      case "zone": {
        const a = asNum(d.priceLow);
        const b = asNum(d.priceHigh);
        if (a === null || b === null) break;
        const low = clampP(Math.min(a, b));
        const high = clampP(Math.max(a, b));
        out.push({ type: "zone", priceLow: low, priceHigh: high, label: asStr(d.label) || "区间", color });
        break;
      }
      case "trendline": {
        const from = (d.from && typeof d.from === "object" ? d.from : {}) as Record<string, unknown>;
        const to = (d.to && typeof d.to === "object" ? d.to : {}) as Record<string, unknown>;
        const fd = snapDate(from.date, candles, dateSet);
        const td = snapDate(to.date, candles, dateSet);
        const fp = asNum(from.price);
        const tp = asNum(to.price);
        if (!fd || !td || fp === null || tp === null || fd === td) break;
        const a = { date: fd, price: clampP(fp) };
        const b = { date: td, price: clampP(tp) };
        const [first, second] = a.date < b.date ? [a, b] : [b, a];
        out.push({ type: "trendline", from: first, to: second, label: asStr(d.label) || "趋势线", color });
        break;
      }
      case "marker": {
        const date = snapDate(d.date, candles, dateSet);
        const price = asNum(d.price);
        if (!date || price === null) break;
        out.push({ type: "marker", date, price: clampP(price), text: asStr(d.text, 24) || "★", color });
        break;
      }
      default:
        break;
    }
  }
  return { rationale, drawings: out };
}

/** 预设快捷指令（按钮 → 自然语言诉求），供前端按钮与后端兜底共用。 */
export const DRAW_PRESETS: { key: string; label: string; question: string }[] = [
  { key: "sr", label: "支撑阻力", question: "标出当前主要的支撑位与阻力位（用水平线 hline），按强弱给出 2-4 条，并简述依据。" },
  { key: "trend", label: "趋势线", question: "连接近期关键高/低点，画出当前主要的上升或下降趋势线（trendline），可含通道上下轨。" },
  { key: "pattern", label: "形态识别", question: "识别当前最显著的经典技术形态（头肩/双顶双底/三角/旗形/楔形等），用标注 marker 与必要的线标出关键位置。" },
  { key: "zone", label: "买卖区间", question: "给出合理的买入区间与止盈/止损区间（用 zone），并说明触发逻辑与风险。" },
];
