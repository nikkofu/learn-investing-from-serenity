import type { TradeAction } from "./quant";

export interface PerformanceReport {
  tradingDays: number;
  years: number;
  totalReturn: number; // 策略累计收益 %
  stockTotalReturn: number; // 同期个股 %
  annReturn: number; // 年化收益 %
  annVol: number; // 年化波动 %
  sharpe: number; // 年化夏普（rf=0）
  sortino: number; // 年化索提诺（下行波动）
  calmar: number; // 年化收益 / |最大回撤|
  maxDrawdown: number; // 最大回撤 %（<=0）
  maxDdPeakDate: string;
  maxDdTroughDate: string;
  profitFactor: number; // 毛盈 / 毛亏（无亏损时为 Infinity）
  winRate: number; // 平仓胜率 %
  roundTrips: number; // 平仓笔数（有盈亏的卖出）
  avgWin: number; // 平均盈利 %
  avgLoss: number; // 平均亏损 %（<=0）
  payoff: number; // 盈亏比 = 平均盈利 / |平均亏损|
  maxConsecLoss: number; // 最大连续亏损笔数
  avgHoldingDays: number; // 平均持仓天数（FIFO 配对，近似）
  exposure: number; // 持仓占比 %（净值发生变化的交易日占比，近似）
  drawdownSeries: number[]; // 逐日回撤 %（<=0），与 history 对齐
}

type HistoryPoint = { date: string; strategyWorth: number; stockWorth: number };

function dayDiff(a: string, b: string): number {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 86400000));
}

const EMPTY: PerformanceReport = {
  tradingDays: 0,
  years: 0,
  totalReturn: 0,
  stockTotalReturn: 0,
  annReturn: 0,
  annVol: 0,
  sharpe: 0,
  sortino: 0,
  calmar: 0,
  maxDrawdown: 0,
  maxDdPeakDate: "",
  maxDdTroughDate: "",
  profitFactor: 0,
  winRate: 0,
  roundTrips: 0,
  avgWin: 0,
  avgLoss: 0,
  payoff: 0,
  maxConsecLoss: 0,
  avgHoldingDays: 0,
  exposure: 0,
  drawdownSeries: [],
};

/**
 * 由净值序列 + 交易明细计算标准化绩效报表（对标 TradingView Strategy Tester / 券商回测报告）。
 * 收益率类指标走净值曲线（含空仓 0 收益日）；交易类指标（胜率/盈亏比/连亏/持仓天数）走平仓卖出的 profitPct。
 */
export function computePerformanceReport(history: HistoryPoint[], trades: TradeAction[]): PerformanceReport {
  if (!history || history.length < 2) return { ...EMPTY };

  const first = history[0].strategyWorth;
  const last = history[history.length - 1].strategyWorth;
  const stockFirst = history[0].stockWorth;
  const stockLast = history[history.length - 1].stockWorth;

  const totalReturn = first > 0 ? (last / first - 1) * 100 : 0;
  const stockTotalReturn = stockFirst > 0 ? (stockLast / stockFirst - 1) * 100 : 0;

  // 日收益
  const rets: number[] = [];
  let changedDays = 0;
  for (let k = 1; k < history.length; k++) {
    const prev = history[k - 1].strategyWorth;
    if (prev > 0) {
      const r = history[k].strategyWorth / prev - 1;
      rets.push(r);
      if (Math.abs(r) > 1e-9) changedDays++;
    }
  }
  const tradingDays = history.length;
  const years = tradingDays / 252;

  const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
  const sd = Math.sqrt(variance);
  const downVar = rets.length ? rets.reduce((s, r) => s + (r < 0 ? r * r : 0), 0) / rets.length : 0;
  const downSd = Math.sqrt(downVar);

  const annReturn = years > 0 && first > 0 && last > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : 0;
  const annVol = sd * Math.sqrt(252) * 100;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  const sortino = downSd > 0 ? (mean / downSd) * Math.sqrt(252) : 0;

  // 最大回撤
  let peak = history[0].strategyWorth;
  let curPeakDate = history[0].date;
  let maxDrawdown = 0;
  let maxDdPeakDate = "";
  let maxDdTroughDate = "";
  const drawdownSeries: number[] = [];
  for (const h of history) {
    if (h.strategyWorth > peak) {
      peak = h.strategyWorth;
      curPeakDate = h.date;
    }
    const dd = peak > 0 ? (h.strategyWorth / peak - 1) * 100 : 0;
    drawdownSeries.push(dd);
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      maxDdPeakDate = curPeakDate;
      maxDdTroughDate = h.date;
    }
  }
  const calmar = maxDrawdown < 0 ? annReturn / Math.abs(maxDrawdown) : 0;

  // 交易类指标：以有 profitPct 的卖出为一次平仓
  const closes = trades.filter((t) => t.type === "sell" && t.profitPct != null);
  const wins = closes.filter((t) => (t.profitPct ?? 0) > 0);
  const losses = closes.filter((t) => (t.profitPct ?? 0) <= 0);
  const grossWin = wins.reduce((s, t) => s + (t.profitPct ?? 0), 0);
  const grossLoss = losses.reduce((s, t) => s + (t.profitPct ?? 0), 0); // <=0
  const profitFactor = grossLoss < 0 ? grossWin / Math.abs(grossLoss) : grossWin > 0 ? Infinity : 0;
  const winRate = closes.length ? (wins.length / closes.length) * 100 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const payoff = avgLoss < 0 ? avgWin / Math.abs(avgLoss) : 0;

  let maxConsecLoss = 0;
  let streak = 0;
  for (const t of closes) {
    if ((t.profitPct ?? 0) <= 0) {
      streak++;
      if (streak > maxConsecLoss) maxConsecLoss = streak;
    } else {
      streak = 0;
    }
  }

  // 持仓天数：按时间顺序 FIFO 配对买/卖（忽略分批仓位，取近似）
  const buyQueue: string[] = [];
  let holdSum = 0;
  let holdCount = 0;
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of ordered) {
    if (t.type === "buy") {
      buyQueue.push(t.date);
    } else if (buyQueue.length > 0) {
      const b = buyQueue.shift()!;
      holdSum += dayDiff(b, t.date);
      holdCount++;
    }
  }
  const avgHoldingDays = holdCount ? holdSum / holdCount : 0;
  const exposure = rets.length ? (changedDays / rets.length) * 100 : 0;

  const r2 = (v: number) => Number(v.toFixed(2));
  const r1 = (v: number) => Number(v.toFixed(1));
  return {
    tradingDays,
    years: r2(years),
    totalReturn: r1(totalReturn),
    stockTotalReturn: r1(stockTotalReturn),
    annReturn: r1(annReturn),
    annVol: r1(annVol),
    sharpe: r2(sharpe),
    sortino: r2(sortino),
    calmar: r2(calmar),
    maxDrawdown: r1(maxDrawdown),
    maxDdPeakDate,
    maxDdTroughDate,
    profitFactor: Number.isFinite(profitFactor) ? r2(profitFactor) : profitFactor,
    winRate: r1(winRate),
    roundTrips: closes.length,
    avgWin: r1(avgWin),
    avgLoss: r1(avgLoss),
    payoff: r2(payoff),
    maxConsecLoss,
    avgHoldingDays: r1(avgHoldingDays),
    exposure: r1(exposure),
    drawdownSeries,
  };
}
