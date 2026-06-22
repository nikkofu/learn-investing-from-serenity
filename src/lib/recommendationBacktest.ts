import type { Candle } from "./types";
import { getKlinesBatch } from "./sources";
import { calculateChipDistribution } from "./quant";
import { priceLimitFraction } from "./portfolioBacktest";

/**
 * 「建议忠实回测」框架。
 *
 * 目的：诚实回答「照策略建议的买卖点操作，历史上是否有较大胜率」。
 *
 * 关键点（直击此前回测的可信度短板）：
 * - **多股票池**：在一个代码池上逐只独立模拟单仓位交易，把所有完成交易**汇总**统计，
 *   而不是只看一只票的几笔——样本量足够才有统计意义。
 * - **无未来函数 / 样本外**：买卖信号在第 t 日只用 ≤t 的数据判定（均线突破/放量/筹码支撑），
 *   且策略**无逐股拟合参数**，故整段历史天然属样本外口径；不再像瓶颈点回测那样把
 *   「当前快照分数」一刀切回灌历史。
 * - **撮合真实性**：复用 A 股涨跌停约束（涨停买不进、跌停卖不出顺延）+ 双边手续费。
 * - **对比基准**：与「同持有期买入持有」（匹配 horizon 的随机入场基线）和「全程买入持有」
 *   对比，衡量择时是否真的带来超额。
 * - **显著性**：胜率对 50% 做单比例 z 检验，给出 z / 近似 p 值与诚实结论。
 *
 * 注意：信号是模型买卖建议（瓶颈点动量突破 + 筹码止损/止盈）的**确定性编码**，
 * 而非逐日重跑 LLM（历史财报快照成本过高）；它度量的是该建议规则的可执行命中率，
 * 是比 LLM 自报或样本内回测更接近真实成功率的代理。
 */

const LIMIT_SLACK = 0.003;
const FEE_DEFAULT_BPS = 30;

export interface RecommendationSeries {
  code: string;
  name: string;
  candles: Candle[]; // 日期升序
}

export interface RecommendationBacktestConfig {
  /** 单边手续费（基点 bps，1bp=0.01%），默认 30。 */
  feeBps?: number;
  /** 止盈目标涨幅，默认 0.35（+35%）。 */
  takeProfitPct?: number;
  /** 预热 K 线根数（仅用于指标、不计交易），默认 30。 */
  warmupBars?: number;
  /** 匹配基线的持有期（交易日），默认取策略平均持有期。 */
  matchedHorizon?: number;
}

export interface ClosedTrade {
  code: string;
  name: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  /** 净收益率 %（含双边手续费）。 */
  returnPct: number;
  holdDays: number;
  exitReason: string;
}

export interface SymbolTradeStats {
  code: string;
  name: string;
  trades: number;
  wins: number;
  winRatePct: number;
  avgReturnPct: number;
  buyHoldPct: number; // 该票测试窗口内全程买入持有收益 %
}

export interface RecommendationBacktestStats {
  symbols: number;
  totalTrades: number;
  wins: number;
  winRatePct: number;
  /** 每笔净收益均值（期望值，含手续费）。 */
  avgReturnPct: number;
  medianReturnPct: number;
  /** 盈亏比：总盈利 / |总亏损|。 */
  profitFactor: number;
  avgHoldDays: number;
  /** 匹配持有期的「随机入场买入持有」基线（同 horizon）。 */
  matchedHorizon: number;
  matchedBaselineWinRatePct: number;
  matchedBaselineAvgReturnPct: number;
  /** 全程买入持有（跨标的平均）。 */
  buyHoldAvgReturnPct: number;
  /** 择时超额：策略每笔均值 − 匹配基线均值。 */
  edgePct: number;
  /** 胜率对 50% 的单比例 z 值与近似双尾 p 值。 */
  zVsCoin: number;
  pVsCoin: number;
  verdict: string;
}

export interface RecommendationBacktestResult {
  config: Required<RecommendationBacktestConfig>;
  perSymbol: SymbolTradeStats[];
  trades: ClosedTrade[];
  stats: RecommendationBacktestStats;
}

// ── 统计工具 ────────────────────────────────────────────────────────────────
/** 标准正态 CDF（Abramowitz-Stegun 7.1.26 erf 近似）。 */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 + 0.5 * y : 0.5 - 0.5 * y;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── 单只交易模拟（信号因果、含撮合约束）──────────────────────────────────────
function simulateSymbol(
  s: RecommendationSeries,
  cfg: Required<RecommendationBacktestConfig>,
): ClosedTrade[] {
  const candles = s.candles;
  const N = candles.length;
  if (N < cfg.warmupBars + 5) return [];
  const fee = cfg.feeBps / 10_000;
  const limitFrac = priceLimitFraction(s.code, s.name);
  const prices = candles.map((c) => c.close);
  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );

  const ma20: number[] = [];
  const vMa5: number[] = [];
  const vMa20: number[] = [];
  for (let i = 0; i < N; i++) {
    ma20.push(i < 19 ? prices[i] : prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20);
    vMa5.push(i < 4 ? volProxy[i] : volProxy.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5);
    vMa20.push(i < 19 ? volProxy[i] : volProxy.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20);
  }

  const dayReturn = (i: number): number | null => {
    if (i < 1 || prices[i - 1] <= 0) return null;
    return prices[i] / prices[i - 1] - 1;
  };
  const atLimitUp = (i: number) => {
    const r = dayReturn(i);
    return r !== null && r >= limitFrac - LIMIT_SLACK;
  };
  const atLimitDown = (i: number) => {
    const r = dayReturn(i);
    return r !== null && r <= -(limitFrac - LIMIT_SLACK);
  };

  const out: ClosedTrade[] = [];
  let holding = false;
  let buyPrice = 0;
  let buyDate = "";
  let buyIdx = 0;

  const startIdx = Math.max(20, cfg.warmupBars);
  for (let i = startIdx; i < N; i++) {
    const close = prices[i];
    const recent = prices.slice(Math.max(0, i - 10), i);
    const plateau =
      recent.length >= 5 && (Math.max(...recent) - Math.min(...recent)) / Math.min(...recent) < 0.08;
    const subHistory = candles.slice(Math.max(0, i - 120), i + 1);
    const chip = calculateChipDistribution(subHistory, close, true);
    const support = chip.priceLow70;
    const win = prices.slice(Math.max(0, i - 120), i + 1);
    const lo = Math.min(...win);
    const hi = Math.max(...win);
    const rangePos = hi > lo ? (close - lo) / (hi - lo) : 0.5;

    if (!holding) {
      const goldCross = close > ma20[i] && prices[i - 1] <= ma20[i - 1] && vMa5[i] > vMa20[i] * 1.3;
      const vcp = close > ma20[i] && plateau && close > Math.max(...recent) && vMa5[i] > vMa20[i] * 1.3;
      if ((goldCross || vcp) && !atLimitUp(i)) {
        holding = true;
        buyPrice = close;
        buyDate = candles[i].date;
        buyIdx = i;
      }
    } else {
      const supportBroken = close < support * 0.95;
      const takeProfit = close >= buyPrice * (1 + cfg.takeProfitPct);
      const climax = rangePos > 0.95 && !!candles[i].turnoverPct && candles[i].turnoverPct > 15;
      const lastBar = i === N - 1;
      if ((supportBroken || takeProfit || climax || lastBar) && !atLimitDown(i)) {
        const net = (close * (1 - fee)) / (buyPrice * (1 + fee)) - 1;
        out.push({
          code: s.code,
          name: s.name,
          buyDate,
          sellDate: candles[i].date,
          buyPrice,
          sellPrice: close,
          returnPct: Number((net * 100).toFixed(2)),
          holdDays: i - buyIdx,
          exitReason: supportBroken ? "跌破筹码支撑止损" : takeProfit ? "达到止盈目标" : climax ? "高位天量滞涨" : "窗口末强制平仓",
        });
        holding = false;
      }
    }
  }
  return out;
}

/** 匹配持有期的「随机入场买入持有」基线：在 warmup 后的每个交易日入场、持有 horizon 天。 */
function matchedBaseline(
  series: RecommendationSeries[],
  horizon: number,
  warmupBars: number,
): { winRatePct: number; avgReturnPct: number } {
  let wins = 0;
  let count = 0;
  let sum = 0;
  for (const s of series) {
    const p = s.candles.map((c) => c.close);
    const start = Math.max(20, warmupBars);
    for (let i = start; i + horizon < p.length; i++) {
      if (p[i] <= 0) continue;
      const r = p[i + horizon] / p[i] - 1;
      sum += r;
      count++;
      if (r > 0) wins++;
    }
  }
  if (count === 0) return { winRatePct: 0, avgReturnPct: 0 };
  return {
    winRatePct: Number(((wins / count) * 100).toFixed(1)),
    avgReturnPct: Number(((sum / count) * 100).toFixed(2)),
  };
}

export function runRecommendationBacktest(
  series: RecommendationSeries[],
  cfg: RecommendationBacktestConfig = {},
): RecommendationBacktestResult {
  const full: Required<RecommendationBacktestConfig> = {
    feeBps: Math.max(0, cfg.feeBps ?? FEE_DEFAULT_BPS),
    takeProfitPct: cfg.takeProfitPct ?? 0.35,
    warmupBars: Math.max(20, cfg.warmupBars ?? 30),
    matchedHorizon: cfg.matchedHorizon ?? 0, // 0 = 取策略平均持有期
  };

  const trades: ClosedTrade[] = [];
  const perSymbol: SymbolTradeStats[] = [];
  for (const s of series) {
    const t = simulateSymbol(s, full);
    trades.push(...t);
    const rets = t.map((x) => x.returnPct);
    const wins = rets.filter((r) => r > 0).length;
    const p = s.candles.map((c) => c.close);
    const buyHold = p.length > full.warmupBars ? (p[p.length - 1] / p[Math.max(20, full.warmupBars)] - 1) * 100 : 0;
    perSymbol.push({
      code: s.code,
      name: s.name,
      trades: t.length,
      wins,
      winRatePct: t.length ? Number(((wins / t.length) * 100).toFixed(1)) : 0,
      avgReturnPct: rets.length ? Number((rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2)) : 0,
      buyHoldPct: Number(buyHold.toFixed(2)),
    });
  }

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.returnPct > 0).length;
  const rets = trades.map((t) => t.returnPct);
  const grossWin = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(rets.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  const avgReturnPct = totalTrades ? rets.reduce((a, b) => a + b, 0) / totalTrades : 0;
  const avgHoldDays = totalTrades ? trades.reduce((a, t) => a + t.holdDays, 0) / totalTrades : 0;

  const horizon = full.matchedHorizon > 0 ? full.matchedHorizon : Math.max(1, Math.round(avgHoldDays));
  const baseline = matchedBaseline(series, horizon, full.warmupBars);
  const buyHoldAvg = perSymbol.length
    ? perSymbol.reduce((a, s) => a + s.buyHoldPct, 0) / perSymbol.length
    : 0;

  const winRatePct = totalTrades ? (wins / totalTrades) * 100 : 0;
  const pHat = totalTrades ? wins / totalTrades : 0;
  const z = totalTrades > 0 ? (pHat - 0.5) / Math.sqrt(0.25 / totalTrades) : 0;
  const pVsCoin = Number((2 * (1 - normCdf(Math.abs(z)))).toFixed(4));
  const edge = avgReturnPct - baseline.avgReturnPct;

  let verdict: string;
  if (totalTrades < 30) {
    verdict = `样本不足（完成交易 ${totalTrades} 笔 < 30），无法得出有统计意义的结论；请扩大股票池或拉长区间。`;
  } else if (z > 1.96 && edge > 0) {
    verdict = `在该样本上：胜率 ${winRatePct.toFixed(1)}% 显著高于掷硬币（z=${z.toFixed(2)}, p=${pVsCoin}），且每笔均值 ${avgReturnPct.toFixed(2)}% 高于同持有期买入持有基线 ${baseline.avgReturnPct.toFixed(2)}%（择时超额 +${edge.toFixed(2)}pp）。注意这仍是历史回测，不构成未来保证。`;
  } else if (z > 1.96 && edge <= 0) {
    verdict = `胜率 ${winRatePct.toFixed(1)}% 虽显著高于 50%（z=${z.toFixed(2)}），但每笔均值未超过同持有期买入持有基线（择时超额 ${edge.toFixed(2)}pp ≤ 0）——高胜率主要靠小赢多次、并未跑赢「一直持有」，不能证明择时有超额价值。`;
  } else {
    verdict = `胜率 ${winRatePct.toFixed(1)}% 对 50% 不显著（z=${z.toFixed(2)}, p=${pVsCoin}）——在该样本上无法证明策略优于随机/买入持有。`;
  }

  return {
    config: full,
    perSymbol: perSymbol.sort((a, b) => b.trades - a.trades),
    trades: trades.sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1)),
    stats: {
      symbols: series.length,
      totalTrades,
      wins,
      winRatePct: Number(winRatePct.toFixed(1)),
      avgReturnPct: Number(avgReturnPct.toFixed(2)),
      medianReturnPct: Number(median(rets).toFixed(2)),
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? Infinity : 0,
      avgHoldDays: Number(avgHoldDays.toFixed(1)),
      matchedHorizon: horizon,
      matchedBaselineWinRatePct: baseline.winRatePct,
      matchedBaselineAvgReturnPct: baseline.avgReturnPct,
      buyHoldAvgReturnPct: Number(buyHoldAvg.toFixed(2)),
      edgePct: Number(edge.toFixed(2)),
      zVsCoin: Number(z.toFixed(2)),
      pVsCoin,
      verdict,
    },
  };
}

/** 便捷入口：代码清单 → 批量取日 K → 运行建议忠实回测。 */
export async function backtestRecommendationByCodes(
  codes: string[],
  cfg: RecommendationBacktestConfig = {},
  opts: { limit?: number; names?: Record<string, string> } = {},
): Promise<RecommendationBacktestResult> {
  const limit = Math.max(120, Math.min(800, opts.limit ?? 500));
  const klineMap = await getKlinesBatch(codes, limit, "baidu-first");
  const series: RecommendationSeries[] = [];
  for (const code of codes) {
    const item = klineMap.get(code);
    if (!item || item.candles.length < 60) continue;
    series.push({
      code,
      name: opts.names?.[code] ?? code,
      candles: [...item.candles].sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
  }
  if (series.length === 0) throw new Error("无可用 K 线数据，无法回测");
  return runRecommendationBacktest(series, cfg);
}
