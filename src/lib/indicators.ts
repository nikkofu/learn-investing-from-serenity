import type { Candle } from "./types";

/**
 * 技术指标计算（副图/叠加用）。
 * 约定：返回数组与输入 K 线等长，预热不足处填 NaN（渲染端跳过 NaN）。
 * 口径对齐通达信/同花顺常见默认，便于用户拿券商软件数值校验。
 */

/** 标准 EMA：ema[0]=values[0]，ema[i]=values[i]*k + ema[i-1]*(1-k)，k=2/(n+1)。 */
export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 简单移动均线 SMA。 */
export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export interface MacdResult {
  dif: number[];
  dea: number[];
  macd: number[];
}

/** MACD（默认 12/26/9）；柱 macd = (DIF-DEA)*2，对齐通达信口径。 */
export function computeMACD(candles: Candle[], fast = 12, slow = 26, signal = 9): MacdResult {
  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const dea = ema(dif, signal);
  const macd = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, macd };
}

/** RSI（Wilder 平滑，默认 14）。 */
export function computeRSI(candles: Candle[], period = 14): number[] {
  const closes = candles.map((c) => c.close);
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface KdjResult {
  k: number[];
  d: number[];
  j: number[];
}

/** KDJ（默认 9,3,3）；K/D 用 1/3 平滑、种子 50，对齐通达信口径。 */
export function computeKDJ(candles: Candle[], n = 9, kP = 3, dP = 3): KdjResult {
  const len = candles.length;
  const k: number[] = new Array(len).fill(NaN);
  const d: number[] = new Array(len).fill(NaN);
  const j: number[] = new Array(len).fill(NaN);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < len; i++) {
    const start = Math.max(0, i - n + 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (let w = start; w <= i; w++) {
      if (candles[w].low < lo) lo = candles[w].low;
      if (candles[w].high > hi) hi = candles[w].high;
    }
    const rsv = hi === lo ? 100 : ((candles[i].close - lo) / (hi - lo)) * 100;
    const curK = prevK + (rsv - prevK) / kP;
    const curD = prevD + (curK - prevD) / dP;
    k[i] = curK;
    d[i] = curD;
    j[i] = 3 * curK - 2 * curD;
    prevK = curK;
    prevD = curD;
  }
  return { k, d, j };
}

export interface BollResult {
  mid: number[];
  upper: number[];
  lower: number[];
}

/** 布林带（默认 20, 2）；mid=SMA20，带宽=±mult×总体标准差。 */
export function computeBOLL(candles: Candle[], period = 20, mult = 2): BollResult {
  const closes = candles.map((c) => c.close);
  const mid = sma(closes, period);
  const upper: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    const m = mid[i];
    for (let w = i - period + 1; w <= i; w++) {
      const diff = closes[w] - m;
      sumSq += diff * diff;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export interface ResonancePoint {
  /** 共振首次成立的 K 线下标（episode 的起点；连续共振只取上升沿一次）。 */
  index: number;
  /** 方向：看多（bull）/ 看空（bear）/ 多空分歧（neutral，多空各 ≥minScore 同时成立）。 */
  dir: "bull" | "bear" | "neutral";
  /** 命中同向指标数（2-5，含成交量确认；中性时取多空两侧较大者）。 */
  score: number;
  /** 命中的指标信号说明（用于悬停/依据；中性时含「看多 …」「看空 …」两组）。 */
  reasons: string[];
}

/**
 * 多指标共振扫描：逐根检查 MACD/RSI/KDJ/BOLL + 成交量的同向信号，
 * 当同一窗口内 ≥minScore 个指标给出同向信号时，认定为「共振点」。
 * 信号口径（与 A 股券商软件常见用法一致）：
 *   MACD 金叉/死叉（DIF 上/下穿 DEA）
 *   RSI 超卖修复（上穿 30）/ 超买回落（下穿 70）
 *   KDJ 低位金叉（D<40 处 K 上穿 D）/ 高位死叉（D>60 处 K 下穿 D）
 *   BOLL 触下轨反抽 / 触上轨回落
 *   成交量：放量阳线（量 ≥ 1.5×近 5 日均量且收阳）做多确认 / 放量阴线做空确认——
 *           量是价的确认而非独立方向，放量印证同向指标，缩量背离则不计。
 * 用 2 根窗口聚合（信号很少恰好同根触发），并仅在 episode 上升沿输出一次，避免连续打标。
 * 多空两侧同时达 minScore 时记为「分歧（中性）」，提示信号相互打架、需谨慎。
 */
export function computeResonance(
  candles: Candle[],
  macd: MacdResult,
  rsi: number[],
  kdj: KdjResult,
  boll: BollResult,
  minScore = 2
): ResonancePoint[] {
  const n = candles.length;
  if (n < 2) return [];
  const closes = candles.map((c) => c.close);
  const mk = () => new Array<boolean>(n).fill(false);
  const macdBull = mk(), macdBear = mk();
  const rsiBull = mk(), rsiBear = mk();
  const kdjBull = mk(), kdjBear = mk();
  const bollBull = mk(), bollBear = mk();
  const volBull = mk(), volBear = mk();
  const fin = Number.isFinite;
  const VOL_MA = 5;       // 均量窗口
  const VOL_SURGE = 1.5;  // 放量阈值（≥1.5×均量）

  for (let i = 1; i < n; i++) {
    if (fin(macd.dif[i]) && fin(macd.dea[i]) && fin(macd.dif[i - 1]) && fin(macd.dea[i - 1])) {
      if (macd.dif[i - 1] <= macd.dea[i - 1] && macd.dif[i] > macd.dea[i]) macdBull[i] = true;
      if (macd.dif[i - 1] >= macd.dea[i - 1] && macd.dif[i] < macd.dea[i]) macdBear[i] = true;
    }
    if (fin(rsi[i]) && fin(rsi[i - 1])) {
      if (rsi[i - 1] < 30 && rsi[i] >= 30) rsiBull[i] = true;
      if (rsi[i - 1] > 70 && rsi[i] <= 70) rsiBear[i] = true;
    }
    if (fin(kdj.k[i]) && fin(kdj.d[i]) && fin(kdj.k[i - 1]) && fin(kdj.d[i - 1])) {
      if (kdj.k[i - 1] <= kdj.d[i - 1] && kdj.k[i] > kdj.d[i] && kdj.d[i] < 40) kdjBull[i] = true;
      if (kdj.k[i - 1] >= kdj.d[i - 1] && kdj.k[i] < kdj.d[i] && kdj.d[i] > 60) kdjBear[i] = true;
    }
    if (fin(boll.lower[i]) && fin(boll.lower[i - 1]) && closes[i - 1] <= boll.lower[i - 1] && closes[i] > boll.lower[i]) bollBull[i] = true;
    if (fin(boll.upper[i]) && fin(boll.upper[i - 1]) && closes[i - 1] >= boll.upper[i - 1] && closes[i] < boll.upper[i]) bollBear[i] = true;

    if (i >= VOL_MA) {
      let sum = 0;
      let ok = true;
      for (let j = i - VOL_MA; j < i; j++) {
        const v = candles[j].volume;
        if (!fin(v) || v <= 0) { ok = false; break; }
        sum += v;
      }
      const vi = candles[i].volume;
      if (ok && fin(vi) && sum > 0) {
        const surge = vi >= (sum / VOL_MA) * VOL_SURGE;
        if (surge) {
          const up = candles[i].close > candles[i].open;
          const down = candles[i].close < candles[i].open;
          if (up) volBull[i] = true;
          else if (down) volBear[i] = true;
        }
      }
    }
  }

  const fired = (ev: boolean[], i: number) => ev[i] || (i > 0 && ev[i - 1]);
  const out: ResonancePoint[] = [];
  let prevDir: "bull" | "bear" | "neutral" | null = null;
  for (let i = 1; i < n; i++) {
    const bull: string[] = [];
    if (fired(macdBull, i)) bull.push("MACD金叉");
    if (fired(rsiBull, i)) bull.push("RSI超卖修复");
    if (fired(kdjBull, i)) bull.push("KDJ低位金叉");
    if (fired(bollBull, i)) bull.push("触下轨反抽");
    if (fired(volBull, i)) bull.push("放量上涨");
    const bear: string[] = [];
    if (fired(macdBear, i)) bear.push("MACD死叉");
    if (fired(rsiBear, i)) bear.push("RSI超买回落");
    if (fired(kdjBear, i)) bear.push("KDJ高位死叉");
    if (fired(bollBear, i)) bear.push("触上轨回落");
    if (fired(volBear, i)) bear.push("放量下跌");

    // 好 / 坏 / 中性三分：多空两侧均达标 → 分歧（中性）；仅一侧达标 → 看多 / 看空。
    let dir: "bull" | "bear" | "neutral" | null = null;
    if (bull.length >= minScore && bear.length >= minScore) dir = "neutral";
    else if (bull.length >= minScore) dir = "bull";
    else if (bear.length >= minScore) dir = "bear";

    if (dir && dir !== prevDir) {
      const score = dir === "bull" ? bull.length : dir === "bear" ? bear.length : Math.max(bull.length, bear.length);
      const reasons = dir === "neutral" ? [`看多 ${bull.join("/")}`, `看空 ${bear.join("/")}`] : dir === "bull" ? bull : bear;
      out.push({ index: i, dir, score, reasons });
    }
    prevDir = dir;
  }
  return out;
}

export interface PatternSignal {
  /** 信号所在 K 线下标。 */
  index: number;
  /** 类别：顶背离 / 底背离 / 天量 / 地量。 */
  kind: "topDivergence" | "bottomDivergence" | "volumeClimax" | "volumeDry";
  /** 方向语义：看多（bull）/ 看空（bear）/ 中性（neutral，量能极值需结合价位判断）。 */
  dir: "bull" | "bear" | "neutral";
  /** 简短标签（标记文案，如「顶背离」「天量」）。 */
  label: string;
  /** 判断说明（悬停/读数条展示，解释信号含义与操作含义）。 */
  detail: string;
}

/** 摆动高点下标：high[i] 严格不低于左右各 k 根（i±k 范围内的最大值）。需未来 k 根确认。 */
function pivotHighIndices(highs: number[], k: number): number[] {
  const out: number[] = [];
  for (let i = k; i < highs.length - k; i++) {
    let isPivot = true;
    for (let w = i - k; w <= i + k; w++) {
      if (w === i) continue;
      if (highs[w] > highs[i]) { isPivot = false; break; }
    }
    if (isPivot) out.push(i);
  }
  return out;
}

/** 摆动低点下标：low[i] 严格不高于左右各 k 根（i±k 范围内的最小值）。需未来 k 根确认。 */
function pivotLowIndices(lows: number[], k: number): number[] {
  const out: number[] = [];
  for (let i = k; i < lows.length - k; i++) {
    let isPivot = true;
    for (let w = i - k; w <= i + k; w++) {
      if (w === i) continue;
      if (lows[w] < lows[i]) { isPivot = false; break; }
    }
    if (isPivot) out.push(i);
  }
  return out;
}

/**
 * 通用形态扫描：顶背离 / 底背离 / 天量 / 地量，做标记 + 判断说明。
 *   顶背离：相邻摆动高点「价创新高、RSI 走低」——上涨动能衰竭，看空。
 *   底背离：相邻摆动低点「价创新低、RSI 抬高」——下跌动能衰竭，看多。
 *   天量　：成交量 ≥ N 日均量的 climaxMult 倍且为局部峰值——剧烈换手/高潮，常见于转折，中性需结合价位。
 *   地量　：成交量 ≤ N 日均量的 dryRatio 且为局部谷值——交投极清淡，地量后常酝酿变盘，中性。
 * 口径与 A 股惯例一致：方向语义（看多/看空）用于配色（红涨绿跌），量能极值标中性（橙）。
 */
export function computePatternSignals(
  candles: Candle[],
  rsi: number[],
  opts: { pivotK?: number; volMa?: number; climaxMult?: number; dryRatio?: number; maxGap?: number } = {}
): PatternSignal[] {
  const { pivotK = 4, volMa = 20, climaxMult = 2.8, dryRatio = 0.5, maxGap = 90 } = opts;
  const n = candles.length;
  const out: PatternSignal[] = [];
  if (n < pivotK * 2 + 2) return out;
  const fin = Number.isFinite;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // —— 背离：相邻摆动高/低点对比价格与 RSI 走向 ——
  const ph = pivotHighIndices(highs, pivotK);
  for (let p = 1; p < ph.length; p++) {
    const a = ph[p - 1], b = ph[p];
    if (b - a > maxGap || b - a < pivotK) continue;
    if (!fin(rsi[a]) || !fin(rsi[b])) continue;
    if (highs[b] > highs[a] && rsi[b] < rsi[a] - 1) {
      out.push({
        index: b,
        kind: "topDivergence",
        dir: "bear",
        label: "顶背离",
        detail: `价创新高（${highs[a].toFixed(2)}→${highs[b].toFixed(2)}）但 RSI 走低（${rsi[a].toFixed(0)}→${rsi[b].toFixed(0)}）：上涨动能衰竭，警惕见顶回落`,
      });
    }
  }
  const pl = pivotLowIndices(lows, pivotK);
  for (let p = 1; p < pl.length; p++) {
    const a = pl[p - 1], b = pl[p];
    if (b - a > maxGap || b - a < pivotK) continue;
    if (!fin(rsi[a]) || !fin(rsi[b])) continue;
    if (lows[b] < lows[a] && rsi[b] > rsi[a] + 1) {
      out.push({
        index: b,
        kind: "bottomDivergence",
        dir: "bull",
        label: "底背离",
        detail: `价创新低（${lows[a].toFixed(2)}→${lows[b].toFixed(2)}）但 RSI 抬高（${rsi[a].toFixed(0)}→${rsi[b].toFixed(0)}）：下跌动能衰竭，关注企稳反弹`,
      });
    }
  }

  // —— 量能极值：天量（局部峰值且远超均量）/ 地量（局部谷值且远低于均量） ——
  const vols = candles.map((c) => (fin(c.volume) ? c.volume : 0));
  const volMaArr = sma(vols, volMa);
  const half = Math.max(2, Math.round(pivotK / 2));
  for (let i = volMa; i < n; i++) {
    const ma = volMaArr[i];
    if (!fin(ma) || ma <= 0) continue;
    const v = vols[i];
    if (v <= 0) continue;
    const ratio = v / ma;
    // 局部窗口极值判定，避免连续打标
    let isMax = true, isMin = true;
    for (let w = Math.max(0, i - half); w <= Math.min(n - 1, i + half); w++) {
      if (w === i) continue;
      if (vols[w] >= v) isMax = false;
      if (vols[w] <= v) isMin = false;
    }
    if (ratio >= climaxMult && isMax) {
      const updown = candles[i].close >= candles[i].open ? "放量上攻" : "放量下杀";
      out.push({
        index: i,
        kind: "volumeClimax",
        dir: "neutral",
        label: "天量",
        detail: `成交量达 ${volMa} 日均量的 ${ratio.toFixed(1)} 倍（${updown}）：多空剧烈换手，天量常见于趋势高潮或转折，需结合价位研判`,
      });
    } else if (ratio <= dryRatio && isMin) {
      out.push({
        index: i,
        kind: "volumeDry",
        dir: "neutral",
        label: "地量",
        detail: `成交量仅为 ${volMa} 日均量的 ${(ratio * 100).toFixed(0)}%：交投极清淡，地量见地价，缩量后常酝酿变盘`,
      });
    }
  }

  out.sort((x, y) => x.index - y.index);
  return out;
}
