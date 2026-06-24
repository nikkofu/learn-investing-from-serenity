import type { Candle } from "./types";
import { DEFAULT_COST_MODEL, buyShares, sellProceeds } from "./costs";
import { atrWilder, type BacktestResult, type TradeAction } from "./quant";
import {
  sma,
  computeRSI,
  computeMACD,
  computeKDJ,
  computeBOLL,
  computeResonance,
} from "./indicators";

/**
 * 经典技术指标策略组（对标 TradingView「七个值得尝试的指标」：RSI / 移动均线 / MACD /
 * 布林带 / 斐波那契回撤 / 随机指标(KDJ) / 成交量）。
 *
 * 设计立场——「比单指标更优」：原文反复强调「任何单一指标都应与其他指标结合使用」，但仅
 * 演示了各指标的教科书裸用法（RSI<30 抄底、触布林下轨买、MACD 一金叉就追…）。这些裸口径
 * 在 A 股最大的坑是「下跌趋势里指标长期超卖、抄在半山腰」「震荡里假金叉反复打脸」。本组策略
 * 在每个指标上叠加三层改进，且全部遵守本项目约束（A 股主板、纯多头、含双边手续费）：
 *   1) regime 过滤：用 MA60 中期趋势闸门，只在「非确认下行」时入场，避开接飞刀；
 *   2) 多重确认：金叉要在零轴之上 / 突破要带量 / 回踩要 KDJ 低位金叉企稳；
 *   3) ATR 自适应跟踪止损：回撤距离随个股真实波动伸缩（高波动给宽、低波动收紧），不猜顶。
 *
 * 每个策略带独立 id 与版本号（在 strategies.ts 登记），便于后续单独迭代升级而互不影响。
 * 全部以单股 BacktestResult 形式产出，自动接入 /backtest/strategy 证明引擎与 /analyze。
 */

/** 持仓上下文（供主动离场回调判断）。 */
interface HoldState {
  buyPrice: number;
  buyIndex: number;
  highSinceEntry: number;
  barsHeld: number;
}

/** 信号式回测规格：预热根数 + 入场/离场回调 + ATR 跟踪止损参数。 */
interface SignalSpec {
  /** 首个可交易下标（预热不计交易，需覆盖最长指标窗口，如 MA60 取 60）。 */
  warmup: number;
  /** 入场信号：仅用 ≤ i 的数据，命中返回买入理由，否则 null。 */
  entry: (i: number) => string | null;
  /** 主动离场信号（ATR 跟踪止损之外的策略性卖点）：命中返回理由，否则 null。 */
  exit: (i: number, st: HoldState) => string | null;
  /** ATR 跟踪止损乘数（0=关闭）。回撤% = clamp(mult×ATR%, floorPct, ceilPct)。 */
  atrMult: number;
  atrFloorPct: number;
  atrCeilPct: number;
}

/**
 * 由策略净值曲线计算年化夏普（与 quant.ts 同口径：日收益、无风险=0、年化 sqrt(252)、样本方差 n-1）。
 * quant.ts 的同名实现为模块私有，此处复刻以避免破坏其封装。
 */
function annualizedSharpe(history: { strategyWorth: number }[]): number {
  const rets: number[] = [];
  for (let k = 1; k < history.length; k++) {
    const prev = history[k - 1].strategyWorth;
    if (prev > 0) rets.push(history[k].strategyWorth / prev - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return Number(((mean / sd) * Math.sqrt(252)).toFixed(2));
}

const EMPTY: BacktestResult = { winRate: 0, sharpe: 0, strategyReturn: 0, stockReturn: 0, trades: [], history: [] };

/**
 * 通用「信号式」单股回测状态机：整仓买卖、100k 起始资金、走 A 股 costs 模型双边手续费、
 * 内建 ATR 自适应跟踪止损，统一产出 BacktestResult（净值曲线对照「同期买入持有」基线）。
 * 把各策略的差异收敛到 entry/exit 两个回调，保证口径与统计一致、便于横向对照与迭代。
 */
function runSignalBacktest(candles: Candle[], spec: SignalSpec): BacktestResult {
  const n = candles.length;
  if (n < spec.warmup + 5) return EMPTY;

  const closes = candles.map((c) => c.close);
  const atr = atrWilder(candles, 14);

  const history: BacktestResult["history"] = [];
  const trades: TradeAction[] = [];
  let cash = 100000;
  let shares = 0;
  let holding = false;
  let st: HoldState = { buyPrice: 0, buyIndex: 0, highSinceEntry: 0, barsHeld: 0 };
  let winCount = 0;
  let tradeCount = 0;

  const start = spec.warmup;
  const initialStockWorth = closes[start];

  for (let i = start; i < n; i++) {
    const close = closes[i];
    const date = candles[i].date;

    if (!holding) {
      const reason = spec.entry(i);
      if (reason) {
        shares = buyShares(cash, close, DEFAULT_COST_MODEL);
        cash = 0;
        holding = true;
        st = { buyPrice: close, buyIndex: i, highSinceEntry: close, barsHeld: 0 };
        trades.push({ type: "buy", date, price: close, reason });
      }
    } else {
      st.barsHeld = i - st.buyIndex;
      if (close > st.highSinceEntry) st.highSinceEntry = close;

      let sellReason: string | null = null;
      if (spec.atrMult > 0) {
        const atrPct = close > 0 ? (atr[i] / close) * 100 : 0;
        const distPct = Math.min(spec.atrCeilPct, Math.max(spec.atrFloorPct, spec.atrMult * atrPct));
        const stop = st.highSinceEntry * (1 - distPct / 100);
        if (close <= stop) {
          sellReason = `【ATR 自适应跟踪止损】自持仓高点 ${st.highSinceEntry.toFixed(2)} 元回撤超 ${distPct.toFixed(1)}%（≈${spec.atrMult}×ATR(14)），收盘 ${close.toFixed(2)} 元触线，让利润奔跑、回撤即止。`;
        }
      }
      if (!sellReason) sellReason = spec.exit(i, st);

      if (sellReason) {
        cash = sellProceeds(shares, close, DEFAULT_COST_MODEL);
        shares = 0;
        holding = false;
        tradeCount++;
        if (close > st.buyPrice) winCount++;
        trades.push({ type: "sell", date, price: close, reason: sellReason, profitPct: ((close - st.buyPrice) / st.buyPrice) * 100 });
      }
    }

    const worth = holding ? shares * close : cash;
    history.push({
      date,
      strategyWorth: Number(worth.toFixed(0)),
      stockWorth: Number(((close / initialStockWorth) * 100000).toFixed(0)),
    });
  }

  const finalWorth = holding ? shares * closes[n - 1] : cash;
  const strategyReturn = ((finalWorth - 100000) / 100000) * 100;
  const stockReturn = ((closes[n - 1] - initialStockWorth) / initialStockWorth) * 100;
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  return {
    winRate: Number(winRate.toFixed(1)),
    sharpe: annualizedSharpe(history),
    strategyReturn: Number(strategyReturn.toFixed(2)),
    stockReturn: Number(stockReturn.toFixed(2)),
    trades,
    history,
  };
}

const fin = Number.isFinite;

/** 量能代理：换手率优先，缺失降级用成交量（比值口径，与 quant.ts 一致）。 */
function volProxyOf(candles: Candle[]): number[] {
  return candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 1,
  );
}

/** 滚动均值（窗口 w，含当根）。 */
function rollingMean(arr: number[], i: number, w: number): number {
  const start = Math.max(0, i - w + 1);
  let s = 0;
  for (let k = start; k <= i; k++) s += arr[k];
  return s / (i - start + 1);
}

/**
 * 策略①：RSI 超卖回归（趋势过滤版）—— rsi-reversion-v1。
 *
 * 比原文「RSI 跌破 30 即买」更优在哪：A 股单边下跌里 RSI 会长期钝化在 30 以下，裸抄必接飞刀。
 * 改进：①只认 RSI「上穿 30」的修复瞬间（动量真的回头），不是单纯低于 30；②叠加 MA60 闸门，
 * 仅在「价在 MA60 之上或 MA60 近 20 日不下行」时入场，过滤确认下行段；③离场用 RSI 高位回落
 * (上穿后回落破 70) 落袋 + 跌破 MA20 认错 + ATR 跟踪止损三选一。
 */
export function runRsiReversionV1(candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const rsi = computeRSI(candles, 14);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  const regimeOk = (i: number) =>
    (fin(ma60[i]) && closes[i] >= ma60[i]) || (fin(ma60[i]) && fin(ma60[i - 20]) && ma60[i] >= ma60[i - 20]);

  return runSignalBacktest(candles, {
    warmup: 60,
    atrMult: 2.5,
    atrFloorPct: 6,
    atrCeilPct: 18,
    entry: (i) => {
      if (!fin(rsi[i]) || !fin(rsi[i - 1])) return null;
      const crossUp30 = rsi[i - 1] < 30 && rsi[i] >= 30;
      if (crossUp30 && regimeOk(i)) {
        return `【RSI 超卖修复·趋势过滤】RSI(14) 自 ${rsi[i - 1].toFixed(1)} 上穿 30 至 ${rsi[i].toFixed(1)}（超卖动量回头），且价位于 MA60 趋势闸门内（非确认下行），低吸博反弹。`;
      }
      return null;
    },
    exit: (i) => {
      if (fin(rsi[i]) && fin(rsi[i - 1]) && rsi[i - 1] > 70 && rsi[i] <= 70) {
        return `【RSI 高位回落止盈】RSI(14) 自 ${rsi[i - 1].toFixed(1)} 回落下穿 70，超买动能衰竭，落袋。`;
      }
      if (fin(ma20[i]) && closes[i] < ma20[i] && fin(rsi[i]) && rsi[i] < 50) {
        return `【跌破 MA20 认错】收盘跌破 20 日线且 RSI<50，反弹逻辑走坏，离场。`;
      }
      return null;
    },
  });
}

/**
 * 策略②：MACD 零轴上金叉趋势跟随 —— macd-zero-trend-v1。
 *
 * 比原文「MACD 一金叉就买」更优在哪：震荡市里 DIF/DEA 在零轴下方反复缠绕、假金叉频发。
 * 改进：①只认「零轴之上」的金叉（DIF>0，即已处多头能量区），滤掉弱势区诱多；②叠加 MA60
 * 上行闸门 + 放量确认（5 日量能 > 20 日的 1.2 倍）；③离场用 MACD 死叉 / 跌破 MA20 + ATR 跟踪止损。
 */
export function runMacdZeroTrendV1(candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const { dif, dea } = computeMACD(candles, 12, 26, 9);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const vol = volProxyOf(candles);

  const trendOk = (i: number) =>
    (fin(ma60[i]) && closes[i] >= ma60[i]) || (fin(ma60[i]) && fin(ma60[i - 20]) && ma60[i] >= ma60[i - 20]);

  return runSignalBacktest(candles, {
    warmup: 60,
    atrMult: 3.0,
    atrFloorPct: 7,
    atrCeilPct: 22,
    entry: (i) => {
      if (!fin(dif[i]) || !fin(dea[i]) || !fin(dif[i - 1]) || !fin(dea[i - 1])) return null;
      const goldenCross = dif[i - 1] <= dea[i - 1] && dif[i] > dea[i];
      const aboveZero = dif[i] > 0;
      const volOk = rollingMean(vol, i, 5) > rollingMean(vol, i, 20) * 1.2;
      if (goldenCross && aboveZero && trendOk(i) && volOk) {
        return `【MACD 零轴上金叉·趋势跟随】DIF(${dif[i].toFixed(3)}) 在零轴上方上穿 DEA，MA60 趋势闸门通过且 5 日量能放大至 20 日的 ${(rollingMean(vol, i, 5) / Math.max(1e-9, rollingMean(vol, i, 20))).toFixed(1)} 倍，顺势追多。`;
      }
      return null;
    },
    exit: (i) => {
      if (fin(dif[i]) && fin(dea[i]) && fin(dif[i - 1]) && fin(dea[i - 1]) && dif[i - 1] >= dea[i - 1] && dif[i] < dea[i]) {
        return `【MACD 死叉离场】DIF 下穿 DEA，多头动能转弱，离场。`;
      }
      if (fin(ma20[i]) && closes[i] < ma20[i]) {
        return `【跌破 MA20 离场】收盘跌破 20 日线，短期趋势走坏，离场。`;
      }
      return null;
    },
  });
}

/**
 * 策略③：布林带挤压突破 —— boll-squeeze-v1。
 *
 * 比原文「触布林下轨即买、触上轨即卖」更优在哪：那是均值回归口径，在单边趋势里触下轨抄底会被
 * 反复埋（趋势走轨）。本策略反向取用布林带的「波动率」属性做动量：①先识别「挤压」（带宽处于近
 * 100 日的低 40 分位，波动收敛 = 变盘前夜）；②挤压后收盘向上突破上轨 + 放量 = 选择方向向上，追
 * 突破；③跌破中轨(MA20) 即离场 + ATR 跟踪止损。与本项目已有的「网格·均值回归」（箱体里低吸高抛）
 * 形成趋势 / 震荡互补，而非重复。
 */
export function runBollSqueezeV1(candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const { mid, upper, lower } = computeBOLL(candles, 20, 2);
  const vol = volProxyOf(candles);

  // 带宽 = (上轨−下轨)/中轨，衡量波动收敛/扩张。
  const bandwidth = closes.map((_, i) => (fin(upper[i]) && fin(lower[i]) && fin(mid[i]) && mid[i] > 0 ? (upper[i] - lower[i]) / mid[i] : NaN));
  // 挤压判定：当根带宽 ≤ 近 100 日有效带宽的 40 分位（波动收敛）。
  const isSqueeze = (i: number): boolean => {
    if (!fin(bandwidth[i])) return false;
    const start = Math.max(0, i - 99);
    const arr = bandwidth.slice(start, i + 1).filter((x) => fin(x)).sort((a, b) => a - b);
    if (arr.length < 20) return false;
    const p40 = arr[Math.floor(arr.length * 0.4)];
    return bandwidth[i] <= p40;
  };

  return runSignalBacktest(candles, {
    warmup: 60,
    atrMult: 3.0,
    atrFloorPct: 7,
    atrCeilPct: 22,
    entry: (i) => {
      if (!fin(upper[i]) || !fin(upper[i - 1])) return null;
      const freshBreak = closes[i] > upper[i] && closes[i - 1] <= upper[i - 1];
      const volOk = rollingMean(vol, i, 5) > rollingMean(vol, i, 20) * 1.2;
      if (freshBreak && isSqueeze(i - 1) && volOk) {
        return `【布林挤压突破】带宽收敛至近 100 日低 40 分位（变盘前夜）后，收盘 ${closes[i].toFixed(2)} 元放量突破布林上轨 ${upper[i].toFixed(2)} 元，选择向上、追动量突破。`;
      }
      return null;
    },
    exit: (i) => {
      if (fin(mid[i]) && closes[i] < mid[i]) {
        return `【跌破布林中轨(MA20)】收盘跌破中轨 ${mid[i].toFixed(2)} 元，突破动能衰竭，离场。`;
      }
      return null;
    },
  });
}

/**
 * 策略④：斐波那契回踩 + KDJ 低位金叉 —— fib-kdj-pullback-v1。
 *
 * 比原文「画斐波那契回撤线找支撑」更优在哪：原文只教画 23.6/38.2/50/61.8% 水平线、靠肉眼看支撑，
 * 既无趋势前提也无入场触发。改进：①只在上升趋势中用（MA60 近 20 日上行），顺势回踩才有意义；
 * ②自动取近 40 日波段低→高，计算 38.2~61.8% 黄金回撤区；③价回踩进该区且 KDJ 低位金叉（K 上穿 D 且
 * D<45）企稳才买——把「随机指标(KDJ)」作为斐波那契支撑的二次确认（原文第 6 个指标）；④目标位看回
 * 波段高点，跌破 61.8% 即认结构破位止损 + ATR 跟踪止损。一策略同时覆盖原文「斐波那契」与「随机指标」两项。
 */
export function runFibKdjPullbackV1(candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const ma60 = sma(closes, 60);
  const { k, d } = computeKDJ(candles, 9, 3, 3);

  const W = 40;
  const swingHi = closes.map((_, i) => Math.max(...closes.slice(Math.max(0, i - W + 1), i + 1)));
  const swingLo = closes.map((_, i) => Math.min(...closes.slice(Math.max(0, i - W + 1), i + 1)));

  const uptrend = (i: number) => fin(ma60[i]) && fin(ma60[i - 20]) && ma60[i] > ma60[i - 20];

  return runSignalBacktest(candles, {
    warmup: 60,
    atrMult: 2.5,
    atrFloorPct: 6,
    atrCeilPct: 18,
    entry: (i) => {
      const hi = swingHi[i];
      const lo = swingLo[i];
      if (!(hi > lo)) return null;
      const fib382 = hi - 0.382 * (hi - lo);
      const fib618 = hi - 0.618 * (hi - lo);
      const inZone = closes[i] <= fib382 && closes[i] >= fib618;
      const kdjGold = fin(k[i]) && fin(d[i]) && fin(k[i - 1]) && fin(d[i - 1]) && k[i - 1] <= d[i - 1] && k[i] > d[i] && d[i] < 45;
      if (uptrend(i) && inZone && kdjGold) {
        return `【斐波那契回踩 + KDJ 低位金叉】上升趋势中价回踩 38.2%~61.8% 黄金回撤区（${fib618.toFixed(2)}~${fib382.toFixed(2)} 元），且 KDJ 低位金叉（D=${d[i].toFixed(0)}<45）企稳，顺势买回踩，目标看波段高 ${hi.toFixed(2)} 元。`;
      }
      return null;
    },
    exit: (i, stt) => {
      const hi = swingHi[i];
      const lo = swingLo[i];
      const fib618 = hi - 0.618 * (hi - lo);
      if (hi > lo && closes[i] < fib618 * 0.97) {
        return `【跌破 61.8% 回撤·结构破位】收盘 ${closes[i].toFixed(2)} 元跌破 61.8% 黄金分割位 ${fib618.toFixed(2)} 元，回踩转破位，止损离场。`;
      }
      if (closes[i] >= stt.buyPrice * 1.0 && fin(d[i]) && d[i] > 80 && fin(k[i]) && fin(k[i - 1]) && k[i - 1] >= d[i - 1] && k[i] < d[i]) {
        return `【KDJ 高位死叉止盈】K 在高位（D=${d[i].toFixed(0)}>80）下穿 D，波段动能见顶，落袋。`;
      }
      return null;
    },
  });
}

/**
 * 策略⑤（旗舰）：多指标共振 —— confluence-v1。
 *
 * 直接回应原文反复强调的「任何单一指标都应与其他指标结合使用」：复用本项目的 computeResonance
 * 多指标共振扫描（MACD 金叉 / RSI 超卖修复 / KDJ 低位金叉 / 触布林下轨反抽 / 放量上涨），要求 ≥3 个
 * 指标同向共振且 MA60 趋势闸门通过才入场——把原文 7 个指标里的 5 个（MACD/RSI/随机指标/布林/成交量）
 * 拧成一股绳，单指标的噪声被多指标一致性显著抑制。离场：出现 ≥2 指标的看跌共振翻空，或 ATR 跟踪止损。
 */
export function runConfluenceV1(candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const ma60 = sma(closes, 60);
  const macd = computeMACD(candles, 12, 26, 9);
  const rsi = computeRSI(candles, 14);
  const kdj = computeKDJ(candles, 9, 3, 3);
  const boll = computeBOLL(candles, 20, 2);
  const points = computeResonance(candles, macd, rsi, kdj, boll, 2);

  const bull = new Array<number>(candles.length).fill(0);
  const bullReason = new Array<string>(candles.length).fill("");
  const bear = new Array<number>(candles.length).fill(0);
  for (const p of points) {
    if (p.dir === "bull") {
      bull[p.index] = p.score;
      bullReason[p.index] = p.reasons.join(" + ");
    } else {
      bear[p.index] = p.score;
    }
  }

  const trendOk = (i: number) =>
    (fin(ma60[i]) && closes[i] >= ma60[i]) || (fin(ma60[i]) && fin(ma60[i - 20]) && ma60[i] >= ma60[i - 20]);

  return runSignalBacktest(candles, {
    warmup: 60,
    atrMult: 3.0,
    atrFloorPct: 7,
    atrCeilPct: 22,
    entry: (i) => {
      if (bull[i] >= 3 && trendOk(i)) {
        return `【多指标共振·${bull[i]} 项同向】${bullReason[i]}（MACD/RSI/KDJ/布林/量能 ≥3 指标看多共振 + MA60 趋势闸门），多指标一致性入场。`;
      }
      return null;
    },
    exit: (i) => {
      if (bear[i] >= 2) {
        return `【看跌共振翻空】出现 ${bear[i]} 项指标看跌共振，多指标一致性转弱，离场。`;
      }
      return null;
    },
  });
}
