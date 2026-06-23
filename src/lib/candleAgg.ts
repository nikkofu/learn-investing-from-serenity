import type { Candle } from "./types";

function getYearWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const numberOfDays = Math.floor((d.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((numberOfDays + oneJan.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

function aggregate(daily: Candle[], keyOf: (d: string) => string): Candle[] {
  if (!daily || daily.length === 0) return [];
  const groups = new Map<string, Candle[]>();
  for (const c of daily) {
    const key = keyOf(c.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const out: Candle[] = [];
  for (const [, arr] of groups.entries()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const open = arr[0].open;
    const close = arr[arr.length - 1].close;
    const high = Math.max(...arr.map((w) => w.high));
    const low = Math.min(...arr.map((w) => w.low));
    const volume = arr.reduce((s, w) => s + (w.volume || 0), 0);
    const amount = arr.reduce((s, w) => s + (w.amount || 0), 0);
    out.push({
      date: arr[arr.length - 1].date,
      open,
      close,
      high,
      low,
      volume,
      amount,
      changePct: Number((((close - open) / (open || 1)) * 100).toFixed(2)),
      turnoverPct: Number(arr.reduce((s, w) => s + (w.turnoverPct || 0), 0).toFixed(2)),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateWeeklyCandles(daily: Candle[]): Candle[] {
  return aggregate(daily, getYearWeek);
}

export function aggregateMonthlyCandles(daily: Candle[]): Candle[] {
  return aggregate(daily, (d) => d.slice(0, 7));
}

export function candlesByPeriod(daily: Candle[], period: "1D" | "1W" | "1M"): Candle[] {
  if (period === "1W") return aggregateWeeklyCandles(daily);
  if (period === "1M") return aggregateMonthlyCandles(daily);
  return daily;
}
