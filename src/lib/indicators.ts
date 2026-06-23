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
