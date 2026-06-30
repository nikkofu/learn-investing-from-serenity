/**
 * 逐根 K 线蜡烛形态识别（对标同花顺主图上的「阳包阴 / 阴包阳 / 锤头 / 倒锤头 / 上吊线 /
 * 射击之星 / 十字星 / 大阳线 / 大阴线」标注）。
 *
 * 纯几何规则：基于单根（实体/上下影比例）与两根关系（吞没），并用「近 5 根均价趋势」区分
 * 同形不同义的一对：下跌中的长下影=锤头(看涨)、上涨中的长下影=上吊线(看跌)；下跌中的长上影=
 * 倒锤头(看涨)、上涨中的长上影=射击之星(看跌)。每根至多取一个最显著形态，避免标注过密。
 */
import type { Candle } from "./types";

export interface CandlePatternHit {
  index: number;
  date: string;
  /** 中文形态名（标在 K 线上）。 */
  label: string;
  /** 表意方向：bull=看涨(红) / bear=看跌(绿) / neutral=中性(灰)。 */
  type: "bull" | "bear" | "neutral";
  /** 简要释义（悬停读数条显示）。 */
  detail: string;
}

/** 近 5 根（不含当根）均价趋势：用于区分锤头/上吊、倒锤头/射击之星。 */
function priorTrend(candles: Candle[], i: number): "up" | "down" | "flat" {
  if (i < 5) return "flat";
  let sum = 0;
  for (let k = i - 5; k < i; k++) sum += candles[k].close;
  const ma = sum / 5;
  const ref = candles[i - 1].close;
  if (ref > ma * 1.005) return "up";
  if (ref < ma * 0.995) return "down";
  return "flat";
}

export function computeCandlePatterns(candles: Candle[]): CandlePatternHit[] {
  const out: CandlePatternHit[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    if (!(range > 0)) continue;
    const body = Math.abs(c.close - c.open);
    const upper = c.high - Math.max(c.open, c.close);
    const lower = Math.min(c.open, c.close) - c.low;
    const bull = c.close >= c.open;
    const base = c.open || c.close || 1;
    const bodyPct = (body / base) * 100; // 实体幅度（%），用于「大阳/大阴」
    const trend = priorTrend(candles, i);
    const push = (label: string, type: CandlePatternHit["type"], detail: string) => {
      out.push({ index: i, date: c.date, label, type, detail });
    };

    // 1) 吞没（两根关系，优先级最高）
    if (i > 0) {
      const p = candles[i - 1];
      const pBody = Math.abs(p.close - p.open);
      const pBull = p.close >= p.open;
      if (pBody > 0 && body > 0) {
        // 阳包阴 = 看涨吞没
        if (!pBull && bull && c.open <= p.close && c.close >= p.open && body > pBody) {
          push("阳包阴", "bull", "看涨吞没：阳线实体完全包住前一阴线，底部反转信号");
          continue;
        }
        // 阴包阳 = 看跌吞没
        if (pBull && !bull && c.open >= p.close && c.close <= p.open && body > pBody) {
          push("阴包阳", "bear", "看跌吞没：阴线实体完全包住前一阳线，顶部反转信号");
          continue;
        }
      }
    }

    const smallBody = body <= range * 0.35;
    // 2) 长下影小实体（锤头 / 上吊线）
    if (smallBody && body > 0 && lower >= body * 2 && upper <= range * 0.2) {
      if (trend === "down") push("锤头", "bull", "下跌中长下影小实体，下方承接强，潜在见底");
      else if (trend === "up") push("上吊线", "bear", "上涨中长下影小实体，警惕高位变盘");
      else push("锤头线", "neutral", "长下影小实体，多空在低位争夺");
      continue;
    }
    // 3) 长上影小实体（倒锤头 / 射击之星）
    if (smallBody && body > 0 && upper >= body * 2 && lower <= range * 0.2) {
      if (trend === "down") push("倒锤头", "bull", "下跌中长上影小实体，潜在反转");
      else if (trend === "up") push("射击之星", "bear", "上涨中长上影小实体，顶部见顶信号");
      else push("倒锤线", "neutral", "长上影小实体，上方抛压明显");
      continue;
    }
    // 4) 十字星
    if (body <= range * 0.1) {
      push("十字星", "neutral", "开收几乎相等，多空僵持、变盘临界");
      continue;
    }
    // 5) 大阳线 / 大阴线（光头光脚式强实体）
    if (body >= range * 0.7 && bodyPct >= 5) {
      if (bull) push("大阳线", "bull", "放量大实体阳线，多方强势主导");
      else push("大阴线", "bear", "大实体阴线，空方强势主导");
      continue;
    }
  }
  return out;
}
