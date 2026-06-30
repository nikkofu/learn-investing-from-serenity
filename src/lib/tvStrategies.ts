/**
 * TradingView 社区脚本复刻库 —— 把社区里值得复刻的 Pine 脚本逆向出核心算法，本地实现，
 * 并为每个策略产出可叠加到 K 线主图的「分析图层」（方向线 / 翻多翻空标记 / regime 读数 等），
 * 从而能脱离 TradingView、把这些策略直接套用到 A 股个股行情上。
 *
 * 与 indicatorStrategies.ts（经典七指标组）平行：那一组是「对标教科书指标的自研改进版」，
 * 本库是「逐一复刻具名社区脚本」。每个策略都带版本号与原作链接，便于单独迭代而互不影响。
 *
 * 架构约定（第一个策略 Supertrend 作为模板，后续脚本照此范式逐个复刻）：
 *   - meta：id / 名称 / 版本 / 原作者 / 原作链接 / 与原版的差异与诚实说明 / 标签；
 *   - compute(candles) → TvStrategyLayers：纯函数，产出与 K 线等长的图层数据（线 / 方向 /
 *     翻转点 / regime），渲染端（LightweightChart 的「策略图层」）直接消费；
 *   - backtest(candles) → BacktestResult（可选）：纯多头、含双边手续费的可回测包装，
 *     在 strategies.ts 登记后自动接入 /backtest/strategy 证明引擎与 /analyze。
 */
import type { Candle } from "./types";
import { atrWilder, type BacktestResult } from "./quant";
import { runSignalBacktest } from "./indicatorStrategies";
import { computeRSI, computeKDJ, computeMACD, sma } from "./indicators";

/** 市场状态（自适应带宽用）：趋势 / 震荡 / 转折。 */
export type Regime = "trend" | "chop" | "transition";

/** 交易计划的单个目标价位（盈利目标，按风险 R 的倍数投影）。 */
export interface TradeTarget {
  /** 标签（如 "TP1" / "TP2" / "TP3"）。 */
  label: string;
  /** 目标价。 */
  price: number;
  /** 相对入场的风险倍数（1R / 2R / 3R …）。 */
  r: number;
}

/**
 * 交易计划（对标 TV「Cardwell RSI Trade Navigator」那套色块）：以某根为入场锚，
 * 给出方向 + 入场 / 止损 / 多层目标，渲染端据此画风险带（红）+ 盈利带（绿）+ 右轴标签。
 */
export interface TradePlan {
  /** 入场锚定根的下标（矩形带从这根向右画）。 */
  anchorIndex: number;
  /** 方向：1=多（止损在下、目标在上）/ -1=空（止损在上、目标在下）。 */
  dir: 1 | -1;
  /** 入场价。 */
  entry: number;
  /** 止损价。 */
  stop: number;
  /** 盈利目标（按 R 倍数投影）。 */
  targets: TradeTarget[];
}

/** 单个 TV 策略产出的分析图层（与输入 K 线等长，预热不足处用 null/NaN，渲染端跳过）。 */
export interface TvStrategyLayers {
  /** 主图叠加线的值（如 Supertrend 跟踪线）；预热段为 null。无跟踪线的策略可整列为 null。 */
  line: (number | null)[];
  /** 每根的方向：1=多头（线在价下方）/ -1=空头（线在价上方）/ 0=未定。 */
  dir: (1 | -1 | 0)[];
  /** 方向翻转点（用于打「翻多 / 翻空」标记）。 */
  flips: { index: number; dir: "up" | "down"; price: number }[];
  /** 每根的 regime 判定（仅读数展示用）。 */
  regime: Regime[];
  /** 每根的 regime 强度代理（效率比的分位，0~1；NaN=未就绪）。 */
  regimeValue: number[];
  /** 可选：当前交易计划色块（Entry/SL/TP 矩形带）；提供则渲染端画成填充矩形 + 右轴标签。 */
  tradePlan?: TradePlan | null;
}

/** TV 策略元信息（含原作链接与诚实差异说明，供 UI 展示与下拉切换）。 */
export interface TvStrategyMeta {
  id: string;
  name: string;
  version: string;
  /** 原作者（TradingView 用户名）。 */
  author: string;
  /** 原脚本链接。 */
  source: string;
  /** 与原版的差异 / 适配 A 股做的改动 / 诚实边界说明。 */
  notes: string;
  tags?: string[];
}

/** 一个可复刻的 TV 策略：元信息 + 图层计算 + 可选回测包装。 */
export interface TvStrategy {
  meta: TvStrategyMeta;
  /** 计算分析图层（纯函数，仅依赖 K 线）。 */
  compute: (candles: Candle[]) => TvStrategyLayers;
  /** 纯多头可回测包装（翻多入场 / 翻空离场，含双边手续费）；登记进 strategies.ts。 */
  backtest?: (candles: Candle[]) => BacktestResult;
}

const fin = Number.isFinite;

/* ============================================================================
 * 策略①（模板）：Modern Adaptive Supertrend [GBB] —— tv-supertrend-adaptive-v1
 *
 * 原作：goodBadBitcoin，https://cn.tradingview.com/script/Wagz8RF1-Modern-Adaptive-Supertrend-GBB/
 *
 * 经典 Supertrend = 基于波动率的跟踪线：ATR(10)×3 的带，价在上方为多、下方为空，收盘越线即翻。
 * 它最被诟病的三个毛病：①离价距离从不自适应（干净趋势与震荡一视同仁）；②碰线即翻 → 一根插针
 * 来回打脸（whipsaw）。本脚本做两层「现代化」改造（外加一个作者承认无效、默认关闭的自适应周期）：
 *
 *   1) Commit filter（迟滞过滤，真正起作用的一层）——不再「碰线即翻」：收盘要越过线 ≥
 *      commitBuffer×ATR（默认 0.5）并保持 persistence 根（默认 1）才确认翻转。作者实测假翻转
 *      减少约 60%，趋势读数不变、噪声大降。
 *   2) Adaptive distance（regime 自适应带宽）——用市场「自身近况」而非固定阈值判趋势/震荡：
 *      取效率比（Kaufman ER）在近 pctlWindow（默认 500）根里的分位 pr。干净趋势（pr 高）里加宽
 *      抗洗，震荡（pr 低）里也加宽防来回打脸；只有「转折」（pr≈0.5）才收紧到基准、让线灵敏。
 *      effMult = baseMult×(1 + min(maxMultGain, trendGain·max(0,(pr−.5)/.5)+chopGain·max(0,(.5−pr)/.5)))。
 *      ⚠️ 校准：原作口径 trendGain/chopGain 取 0.8/0.5，但 TradingView 实际渲染的 GBB 线≈3×ATR 紧贴
 *      价格、阶梯抬升；为逐像素贴合 TV，本复刻把增益收紧到 0.25/0.15 并加 maxMultGain=0.25 上限
 *      （最宽 1.25×base=3.75×ATR），避免跟踪线在强趋势里膨胀到 5~6×ATR 远离价格、看起来又平又低。
 *      601869 校验：收紧后末根线 ≈454（TV≈465，吻合）。
 *   3) Adaptive period（实验性，默认关）——作者诚实声明无效，本复刻不实现。
 *
 * 诚实口径（沿用原作）：这是趋势「过滤器」而非择时系统，裸方向胜率≈48%（约等于抛硬币，因为
 * Supertrend 跟随趋势而不预测趋势）；价值在更干净的趋势读数与更低回撤，而非抄顶摸底。
 *
 * 适配：A 股日线（Modern 预设在 >1h 周期默认只跑 commit filter，但本项目主图是日线、用户也可能
 * 看更长周期，且自适应带宽在 A 股同样有效，故两层都开）。多头红 / 空头绿（A 股配色）由渲染端处理。
 * ==========================================================================*/

interface SupertrendParams {
  atrPeriod: number;      // ATR 周期（经典默认 10）
  baseMult: number;       // 基准 ATR 乘数（经典默认 3）
  commitBuffer: number;   // 迟滞缓冲（ATR 倍数，默认 0.5）
  persistence: number;    // 突破需保持的收盘根数（默认 1）
  trendGain: number;      // 干净趋势加宽增益（默认 0.8）
  chopGain: number;       // 震荡加宽增益（默认 0.5）
  pctlWindow: number;     // 效率比分位窗口（默认 500）
  erPeriod: number;       // 效率比回看周期（默认 10）
  maxMultGain: number;    // 自适应加宽相对 baseMult 的上限增益（默认 0.25 → 最宽 1.25×base）
}

const SUPERTREND_DEFAULTS: SupertrendParams = {
  atrPeriod: 10,
  baseMult: 3,
  commitBuffer: 0.5,
  persistence: 1,
  trendGain: 0.25,
  chopGain: 0.15,
  pctlWindow: 500,
  erPeriod: 10,
  maxMultGain: 0.25,
};

/**
 * Kaufman 效率比（Efficiency Ratio）：|净变动| / Σ|逐根变动|，∈[0,1]。
 * 高=方向性强（趋势），低=来回磨（震荡）。预热不足处为 NaN。
 */
function efficiencyRatio(closes: number[], period: number): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    const change = Math.abs(closes[i] - closes[i - period]);
    let vol = 0;
    for (let k = i - period + 1; k <= i; k++) vol += Math.abs(closes[k] - closes[k - 1]);
    out[i] = vol > 0 ? change / vol : 0;
  }
  return out;
}

/** 当前值在「近 window 根（含当根）」里的分位（0~1）：≤当前值的占比。预热不足处为 NaN。 */
function rollingPercentile(values: number[], window: number, minCount = 30): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!fin(values[i])) continue;
    const start = Math.max(0, i - window + 1);
    let count = 0;
    let leq = 0;
    for (let k = start; k <= i; k++) {
      if (!fin(values[k])) continue;
      count++;
      if (values[k] <= values[i]) leq++;
    }
    if (count >= minCount) out[i] = leq / count;
  }
  return out;
}

/**
 * 计算 Modern Adaptive Supertrend 的全部图层（方向线 / 方向 / 翻转点 / regime）。
 * 实现完整复刻了 commit filter（迟滞）与 regime 自适应带宽两层。
 */
export function computeAdaptiveSupertrend(
  candles: Candle[],
  params: Partial<SupertrendParams> = {},
): TvStrategyLayers {
  const p = { ...SUPERTREND_DEFAULTS, ...params };
  const n = candles.length;
  const line = new Array<number | null>(n).fill(null);
  const dir = new Array<1 | -1 | 0>(n).fill(0);
  const regime = new Array<Regime>(n).fill("transition");
  const flips: TvStrategyLayers["flips"] = [];

  const closes = candles.map((c) => c.close);
  const atr = atrWilder(candles, p.atrPeriod);
  const er = efficiencyRatio(closes, p.erPeriod);
  const erPctl = rollingPercentile(er, p.pctlWindow);
  const regimeValue = erPctl.slice();

  // 自适应乘数：转折处（pr≈0.5）最紧=baseMult；趋势/震荡两端加宽。
  const adaptiveMult = (i: number): number => {
    const pr = erPctl[i];
    if (!fin(pr)) return p.baseMult; // 分位未就绪时退化为经典固定乘数
    const trendStrength = Math.max(0, (pr - 0.5) / 0.5);
    const chopStrength = Math.max(0, (0.5 - pr) / 0.5);
    const gain = p.trendGain * trendStrength + p.chopGain * chopStrength;
    // 收紧自适应带宽以贴合 TV 实际渲染（TV 的 GBB 线≈3×ATR 紧贴价格、阶梯抬升）：
    // 增益限制在 maxMultGain 内，避免趋势里乘数膨胀到 5~6× 让跟踪线远离价格、看起来又平又低。
    return p.baseMult * (1 + Math.min(gain, p.maxMultGain));
  };
  const regimeOf = (i: number): Regime => {
    const pr = erPctl[i];
    if (!fin(pr)) return "transition";
    if (pr >= 0.66) return "trend";
    if (pr <= 0.34) return "chop";
    return "transition";
  };

  let prevFinalUpper = NaN;
  let prevFinalLower = NaN;
  let curDir: 1 | -1 | 0 = 0;
  let breakCount = 0; // commit filter：突破已保持的连续收盘根数

  for (let i = 0; i < n; i++) {
    regime[i] = regimeOf(i);
    if (!fin(atr[i])) continue; // ATR 预热段不画线

    const mult = adaptiveMult(i);
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + mult * atr[i];
    const basicLower = hl2 - mult * atr[i];

    // 经典 final band 进位（带「记忆」，价未越线则保持更紧的一侧）。
    const finalUpper =
      !fin(prevFinalUpper) || basicUpper < prevFinalUpper || closes[i - 1] > prevFinalUpper
        ? basicUpper
        : prevFinalUpper;
    const finalLower =
      !fin(prevFinalLower) || basicLower > prevFinalLower || closes[i - 1] < prevFinalLower
        ? basicLower
        : prevFinalLower;

    if (curDir === 0) {
      // 初始化方向：首个可用根按收盘相对中轨定多空。
      curDir = closes[i] >= hl2 ? 1 : -1;
      breakCount = 0;
    } else if (curDir === 1) {
      // 持多（线=finalLower）：跌破 finalLower 达 commitBuffer×ATR 并保持 persistence 根才翻空。
      const broke = closes[i] < finalLower - p.commitBuffer * atr[i];
      breakCount = broke ? breakCount + 1 : 0;
      if (breakCount >= p.persistence) {
        curDir = -1;
        breakCount = 0;
        flips.push({ index: i, dir: "down", price: closes[i] });
      }
    } else {
      // 持空（线=finalUpper）：升破 finalUpper 达 commitBuffer×ATR 并保持 persistence 根才翻多。
      const broke = closes[i] > finalUpper + p.commitBuffer * atr[i];
      breakCount = broke ? breakCount + 1 : 0;
      if (breakCount >= p.persistence) {
        curDir = 1;
        breakCount = 0;
        flips.push({ index: i, dir: "up", price: closes[i] });
      }
    }

    dir[i] = curDir;
    line[i] = curDir === 1 ? finalLower : finalUpper;
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
  }

  return { line, dir, flips, regime, regimeValue };
}

/**
 * 纯多头可回测包装：翻多（flip up）入场、翻空（flip down）离场，单仓位、含双边手续费。
 * 关闭 runSignalBacktest 自带的 ATR 跟踪止损（atrMult=0）——Supertrend 翻空本身即为离场/止损，
 * 不再叠加额外止损，保持对原策略口径的忠实。统计口径（净值/夏普/对照买入持有）与项目其它策略一致。
 */
export function runTvSupertrendAdaptiveV1(candles: Candle[]): BacktestResult {
  const layers = computeAdaptiveSupertrend(candles);
  const flipUp = new Array<boolean>(candles.length).fill(false);
  const flipDown = new Array<boolean>(candles.length).fill(false);
  for (const f of layers.flips) (f.dir === "up" ? flipUp : flipDown)[f.index] = true;

  return runSignalBacktest(candles, {
    warmup: 30,
    atrMult: 0,
    atrFloorPct: 0,
    atrCeilPct: 0,
    entry: (i) => {
      if (!flipUp[i]) return null;
      const v = layers.line[i];
      const r = layers.regime[i];
      return `【Supertrend 翻多】收盘 ${candles[i].close.toFixed(2)} 元越过自适应跟踪线${
        fin(v as number) ? ` ${(v as number).toFixed(2)} 元` : ""
      }（越线幅度超过迟滞缓冲并确认），regime=${r === "trend" ? "趋势" : r === "chop" ? "震荡" : "转折"}，顺势追多。`;
    },
    exit: (i) => {
      if (!flipDown[i]) return null;
      const v = layers.line[i];
      return `【Supertrend 翻空】收盘 ${candles[i].close.toFixed(2)} 元跌破自适应跟踪线${
        fin(v as number) ? ` ${(v as number).toFixed(2)} 元` : ""
      }（确认翻转），趋势转空，离场。`;
    },
  });
}

const SUPERTREND_ADAPTIVE_V1: TvStrategy = {
  meta: {
    id: "tv-supertrend-adaptive-v1",
    name: "Modern Adaptive Supertrend [GBB] 复刻",
    version: "1.0",
    author: "goodBadBitcoin",
    source: "https://cn.tradingview.com/script/Wagz8RF1-Modern-Adaptive-Supertrend-GBB/",
    notes:
      "复刻自 goodBadBitcoin 的 Modern Adaptive Supertrend [GBB]。在经典 Supertrend(ATR10×3) 上叠加两层现代化改造：①Commit filter 迟滞过滤——收盘越线需达 0.5×ATR 并保持 1 根才确认翻转（原作实测假翻转减少约 60%）；②regime 自适应带宽——用效率比(ER)近 500 根分位判趋势/震荡，趋势与震荡两端加宽抗洗、仅转折处收紧让线灵敏（增益按 TV 实际渲染收紧至 0.25/0.15 并加 1.25×base 上限，使跟踪线≈3×ATR 紧贴价格、阶梯抬升——601869 末根线≈454 对 TV≈465）。作者承认无效的「自适应周期」默认关、本复刻未实现。诚实口径（沿用原作）：趋势过滤器而非择时系统，裸方向胜率≈48%，价值在更干净的趋势读数与更低回撤而非抄顶摸底。回测为纯多头（翻多入场/翻空离场，翻空即止损不另加 ATR 止损），含双边手续费。",
    tags: ["tradingview", "supertrend", "trend-follow", "adaptive", "regime-adaptive", "atr-stop", "reproduction"],
  },
  compute: (candles) => computeAdaptiveSupertrend(candles),
  backtest: (candles) => runTvSupertrendAdaptiveV1(candles),
};

/* ============================================================================
 * 策略②：Cardwell RSI Trade Navigator [MarkitTick] —— tv-cardwell-rsi-navigator-v1
 *
 * 原作：MarkitTick，cn.tradingview.com（与 GBB 同图叠加的第二个脚本，图例首行）。
 *
 * 这是一个「交易计划导航器」：用 Andrew Cardwell 的 RSI 方法定方向/择时，一旦出信号就以
 * 入场价为锚，向右投影一组**交易计划色块**——风险带（Entry↔止损）+ 多层盈利带（Entry↔
 * TP1/TP2/TP3），并在右轴贴 × SL / ► Entry / ● TP1 / ★ TP2 / ▲ TP3 标签（即你截图里那套
 * 醒目的红/绿矩形 + 价标）。它最被记住的就是这套「把一笔交易的风险/回报可视化」的 UI/UX。
 *
 * 复刻口径（诚实说明——Cardwell 原脚本的精确入场/止损/目标公式并非公开）：
 *   1) 方向/择时：用 RSI(14) 相对 Cardwell 中线 50 的上/下穿判定多空转换（上穿→转多、
 *      下穿→转空）；为降噪要求两次翻转间至少间隔 minGap 根。
 *   2) 风险（止损）：入场后按 stopMult×ATR(14) 设保护止损（默认 1.5×ATR，对应原作参数里的 1.5）。
 *   3) 回报（目标）：按风险 R=|入场−止损| 的 1/2/3 倍投影 TP1/TP2/TP3（对应原作 1/2/3）。
 * 即「同款可视化 + 一套合理可解释的 RSI/R 倍数交易计划」，盒子位置不会与 TV 逐位相同。
 *
 * 回测为纯多头（RSI 上穿 50 入场 / 下穿 50 离场，叠加 1.5×ATR 跟踪止损保护），含双边手续费。
 * ==========================================================================*/

interface CardwellParams {
  rsiPeriod: number;   // RSI 周期（默认 14）
  atrPeriod: number;   // ATR 周期（默认 14）
  mid: number;         // Cardwell 中线（默认 50）
  stopMult: number;    // 止损 = stopMult×ATR（默认 1.5）
  tpR: number[];       // 盈利目标的 R 倍数（默认 [1,2,3]）
  minGap: number;      // 两次翻转最小间隔根数（降噪，默认 2）
}

const CARDWELL_DEFAULTS: CardwellParams = {
  rsiPeriod: 14,
  atrPeriod: 14,
  mid: 50,
  stopMult: 1.5,
  tpR: [1, 2, 3],
  minGap: 2,
};

/**
 * 计算 Cardwell RSI Trade Navigator 的图层：方向 / 翻多翻空点 / regime（按 RSI 偏离中线的强度）
 * + 当前交易计划色块（入场/止损/TP1~TP3）。不画跟踪线（line 整列 null）。
 */
export function computeCardwellRsiNavigator(
  candles: Candle[],
  params: Partial<CardwellParams> = {},
): TvStrategyLayers {
  const p = { ...CARDWELL_DEFAULTS, ...params };
  const n = candles.length;
  const line = new Array<number | null>(n).fill(null);
  const dir = new Array<1 | -1 | 0>(n).fill(0);
  const regime = new Array<Regime>(n).fill("transition");
  const regimeValue = new Array<number>(n).fill(NaN);
  const flips: TvStrategyLayers["flips"] = [];

  const rsi = computeRSI(candles, p.rsiPeriod);
  const atr = atrWilder(candles, p.atrPeriod);

  // 由方向 + 入场根算出交易计划（风险带 + R 倍数目标带）。
  const planAt = (idx: number, d: 1 | -1): TradePlan | null => {
    const entry = candles[idx].close;
    const a = atr[idx];
    if (!fin(a) || a <= 0) return null;
    const risk = p.stopMult * a;
    const stop = d === 1 ? entry - risk : entry + risk;
    const targets: TradeTarget[] = p.tpR.map((r, k) => ({
      label: `TP${k + 1}`,
      price: d === 1 ? entry + r * risk : entry - r * risk,
      r,
    }));
    return { anchorIndex: idx, dir: d, entry, stop, targets };
  };

  let curDir: 1 | -1 | 0 = 0;
  let lastFlip = -p.minGap - 1;
  let tradePlan: TradePlan | null = null;

  for (let i = 0; i < n; i++) {
    if (fin(rsi[i])) {
      const dev = Math.abs(rsi[i] - p.mid);
      regime[i] = dev >= 20 ? "trend" : dev <= 10 ? "chop" : "transition";
    }
    if (i > 0 && fin(rsi[i]) && fin(rsi[i - 1]) && i - lastFlip >= p.minGap) {
      const crossUp = rsi[i - 1] <= p.mid && rsi[i] > p.mid;
      const crossDn = rsi[i - 1] >= p.mid && rsi[i] < p.mid;
      if (crossUp && curDir !== 1) {
        curDir = 1;
        lastFlip = i;
        flips.push({ index: i, dir: "up", price: candles[i].close });
        const plan = planAt(i, 1);
        if (plan) tradePlan = plan;
      } else if (crossDn && curDir !== -1) {
        curDir = -1;
        lastFlip = i;
        flips.push({ index: i, dir: "down", price: candles[i].close });
        const plan = planAt(i, -1);
        if (plan) tradePlan = plan;
      }
    }
    dir[i] = curDir;
  }

  return { line, dir, flips, regime, regimeValue, tradePlan };
}

/**
 * 纯多头可回测包装：RSI 上穿 50 入场 / 下穿 50 离场，叠加 1.5×ATR 跟踪止损保护，含双边手续费。
 */
export function runTvCardwellRsiNavigatorV1(candles: Candle[]): BacktestResult {
  const p = CARDWELL_DEFAULTS;
  const layers = computeCardwellRsiNavigator(candles);
  const rsi = computeRSI(candles, p.rsiPeriod);
  const flipUp = new Array<boolean>(candles.length).fill(false);
  const flipDown = new Array<boolean>(candles.length).fill(false);
  for (const f of layers.flips) (f.dir === "up" ? flipUp : flipDown)[f.index] = true;

  return runSignalBacktest(candles, {
    warmup: Math.max(30, p.rsiPeriod + 5),
    atrMult: p.stopMult,
    atrFloorPct: 3,
    atrCeilPct: 25,
    entry: (i) => {
      if (!flipUp[i]) return null;
      return `【RSI 上穿中线】RSI(${p.rsiPeriod})=${fin(rsi[i]) ? rsi[i].toFixed(1) : "--"} 上穿 ${p.mid}（Cardwell 多头区），收盘 ${candles[i].close.toFixed(2)} 元转多入场，止损 ${p.stopMult}×ATR、目标 1R/2R/3R。`;
    },
    exit: (i) => {
      if (!flipDown[i]) return null;
      return `【RSI 下穿中线】RSI(${p.rsiPeriod})=${fin(rsi[i]) ? rsi[i].toFixed(1) : "--"} 下穿 ${p.mid}（转入 Cardwell 空头区），趋势转空，离场。`;
    },
  });
}

const CARDWELL_RSI_NAVIGATOR_V1: TvStrategy = {
  meta: {
    id: "tv-cardwell-rsi-navigator-v1",
    name: "Cardwell RSI Trade Navigator [MarkitTick] 复刻",
    version: "1.0",
    author: "MarkitTick",
    source: "https://cn.tradingview.com/chart/JTqSjJYn/",
    notes:
      "复刻自 MarkitTick 的 Cardwell RSI Trade Navigator——一个把交易计划可视化的导航器：用 Andrew Cardwell 的 RSI 方法定方向/择时（RSI(14) 上/下穿中线 50 判多空转换），一旦出信号即以入场价为锚向右投影**交易计划色块**——风险带(Entry↔止损,红) + 多层盈利带(Entry↔TP1/TP2/TP3,绿) + 右轴 ×SL/►Entry/●TP1/★TP2/▲TP3 标签。止损取 1.5×ATR(14)，目标按风险 R 的 1/2/3 倍投影（对应原作参数 1.5 与 1/2/3）。诚实口径：Cardwell 原脚本精确的入场/止损/目标公式并非公开，本复刻是「同款 UI/UX + 一套合理可解释的 RSI/R 倍数交易计划」，盒子位置不会与 TV 逐位相同。回测为纯多头（上穿 50 入场/下穿 50 离场，叠加 1.5×ATR 跟踪止损），含双边手续费。",
    tags: ["tradingview", "rsi", "cardwell", "trade-plan", "risk-reward", "r-multiple", "reproduction"],
  },
  compute: (candles) => computeCardwellRsiNavigator(candles),
  backtest: (candles) => runTvCardwellRsiNavigatorV1(candles),
};

/* ============================================================================
 * 策略②-V2：Cardwell RSI Trade Navigator 趋势延续版 —— tv-cardwell-rsi-navigator-v2
 *
 * 解决 V1 的「强趋势出局后回不来」：V1 被 1.5×ATR 跟踪止损洗出时，RSI 往往仍在多头区(>50)，
 * 而 V1 唯一的入场钥匙是「RSI 全新上穿 50」——必须 RSI 先跌回 ≤50 再上穿才会再触发。可在主升浪里
 * RSI 长期钉在 50 上方，这把钥匙永远插不上，于是空仓走完整段主升浪（实测 600522：2026-05-27 止损
 * 离场后 21 根里 RSI 最低 50.6、全程 ≥50，0 次再入场，错过 close 39→62 的整段拉升）。
 *
 * V2「只增不改」：完整保留 V1 的 RSI 上穿 50 入场 / 下穿 50 离场 / 1.5×ATR 跟踪止损，额外增加一条
 * **趋势延续再入场（continuation re-entry）** 入场通道——当空仓且趋势仍未破时，用价量/KDJ 确认转强
 * 即顺势重新建仓，无需等 RSI 跌破再上穿：
 *   再入场 = 收盘 ≥ MA20（趋势闸门未破） 且 RSI(14) > 中线 且 RSI 较前一根上行
 *           且（KDJ 金叉：K 上穿 D  或  MACD 柱由负转正「翻红」）；量能放大(量≥1.2×量MA5) 作附注。
 * 即把用户在主升浪里看到的「柱子翻红 / KDJ 金叉」显式纳入为补充买点。离场口径与 V1 完全一致
 * （RSI 下穿 50 或 ATR 跟踪止损）。仍为纯多头、单仓、含双边手续费。
 *
 * 诚实口径：再入场是顺势加仓式的「趋势延续」确认，本质仍是趋势跟随而非抄底；它会增加交易笔数、
 * 在主升浪里抓回 V1 错过的段落，但震荡市也可能多出几笔小亏损交易（由跟踪止损兜底）。
 * ==========================================================================*/

interface CardwellV2Params extends CardwellParams {
  maPeriod: number;     // 趋势闸门均线（收盘需站上，默认 20）
  volMaPeriod: number;  // 量能基准均线（默认 5）
  volMult: number;      // 量能放大阈值（量 ≥ volMult×量MA 视为放量，默认 1.2）
}

const CARDWELL_V2_DEFAULTS: CardwellV2Params = {
  ...CARDWELL_DEFAULTS,
  maPeriod: 20,
  volMaPeriod: 5,
  volMult: 1.2,
};

/**
 * 纯多头可回测包装（V2 趋势延续版）：在 V1「RSI 上穿 50 入场 / 下穿 50 离场 + 1.5×ATR 跟踪止损」
 * 基础上，增加「趋势延续再入场」入场通道——空仓且趋势未破（收盘≥MA20、RSI>中线且上行）时，
 * KDJ 金叉 或 MACD 柱翻红 即重新建仓。离场口径与 V1 完全一致。含双边手续费。
 */
export function runTvCardwellRsiNavigatorV2(candles: Candle[]): BacktestResult {
  const p = CARDWELL_V2_DEFAULTS;
  const layers = computeCardwellRsiNavigator(candles, p);
  const rsi = computeRSI(candles, p.rsiPeriod);
  const kdj = computeKDJ(candles);
  const macd = computeMACD(candles);
  const closes = candles.map((c) => c.close);
  const ma = sma(closes, p.maPeriod);
  const volProxy = candles.map((c) =>
    c.turnoverPct && c.turnoverPct > 0 ? c.turnoverPct : c.volume && c.volume > 0 ? c.volume : 0,
  );
  const volMa = sma(volProxy, p.volMaPeriod);

  const flipUp = new Array<boolean>(candles.length).fill(false);
  const flipDown = new Array<boolean>(candles.length).fill(false);
  for (const f of layers.flips) (f.dir === "up" ? flipUp : flipDown)[f.index] = true;

  // 趋势延续再入场（仅用 ≤ i 数据）：趋势闸门 + 价量/KDJ 确认转强。
  const reentryReason = (i: number): string | null => {
    if (i < 1) return null;
    const trendGate =
      fin(ma[i]) && closes[i] >= ma[i] &&
      fin(rsi[i]) && fin(rsi[i - 1]) && rsi[i] > p.mid && rsi[i] >= rsi[i - 1];
    if (!trendGate) return null;
    const kdjCross =
      fin(kdj.k[i]) && fin(kdj.d[i]) && fin(kdj.k[i - 1]) && fin(kdj.d[i - 1]) &&
      kdj.k[i - 1] <= kdj.d[i - 1] && kdj.k[i] > kdj.d[i];
    const macdFlip =
      fin(macd.macd[i]) && fin(macd.macd[i - 1]) && macd.macd[i - 1] <= 0 && macd.macd[i] > 0;
    if (!kdjCross && !macdFlip) return null;
    const volPump = fin(volMa[i]) && volMa[i] > 0 && volProxy[i] >= p.volMult * volMa[i];
    const conf: string[] = [];
    if (kdjCross) conf.push("KDJ 金叉");
    if (macdFlip) conf.push("MACD 柱翻红");
    if (volPump) conf.push("量能放大");
    return `【趋势延续再入场】空仓期价仍站上 MA${p.maPeriod}、RSI(${p.rsiPeriod})=${rsi[i].toFixed(1)}>${p.mid} 且上行（多头未破），${conf.join("、")}确认转强，收盘 ${closes[i].toFixed(2)} 元顺势重新建仓；止损 ${p.stopMult}×ATR、目标 1R/2R/3R。`;
  };

  return runSignalBacktest(candles, {
    warmup: Math.max(30, p.rsiPeriod + 5),
    atrMult: p.stopMult,
    atrFloorPct: 3,
    atrCeilPct: 25,
    entry: (i) => {
      if (flipUp[i]) {
        return `【RSI 上穿中线】RSI(${p.rsiPeriod})=${fin(rsi[i]) ? rsi[i].toFixed(1) : "--"} 上穿 ${p.mid}（Cardwell 多头区），收盘 ${candles[i].close.toFixed(2)} 元转多入场，止损 ${p.stopMult}×ATR、目标 1R/2R/3R。`;
      }
      return reentryReason(i);
    },
    exit: (i) => {
      if (!flipDown[i]) return null;
      return `【RSI 下穿中线】RSI(${p.rsiPeriod})=${fin(rsi[i]) ? rsi[i].toFixed(1) : "--"} 下穿 ${p.mid}（转入 Cardwell 空头区），趋势转空，离场。`;
    },
  });
}

const CARDWELL_RSI_NAVIGATOR_V2: TvStrategy = {
  meta: {
    id: "tv-cardwell-rsi-navigator-v2",
    name: "Cardwell RSI Trade Navigator 趋势延续版 V2",
    version: "2.0",
    author: "MarkitTick（V2 趋势延续再入场改造）",
    source: "https://cn.tradingview.com/chart/JTqSjJYn/",
    notes:
      "在 V1 基础上「只增不改」解决「强趋势被跟踪止损洗出后再也回不来」的问题。V1 唯一入场钥匙是 RSI(14) 全新上穿中线 50，被 1.5×ATR 跟踪止损打出来时 RSI 常仍在多头区(>50)，要再入场必须 RSI 先跌回 ≤50 再上穿；主升浪里 RSI 长期 >50，钥匙永远插不上，于是空仓走完整段拉升。V2 完整保留 V1 的入场/离场/止损口径，额外增加一条「趋势延续再入场」通道：空仓且趋势未破（收盘≥MA20、RSI>50 且上行）时，KDJ 金叉 或 MACD 柱翻红即顺势重新建仓（量能放大作附注），把主升浪里的「柱子翻红/KDJ金叉」显式纳为补充买点。离场与 V1 一致（RSI 下穿 50 或 ATR 跟踪止损）。纯多头、含双边手续费。诚实口径：再入场是趋势跟随式的延续确认而非抄底，会增加交易笔数、抓回 V1 错过的主升浪段落，震荡市也可能多出几笔由跟踪止损兜底的小亏损。",
    tags: ["tradingview", "rsi", "cardwell", "trade-plan", "trend-continuation", "re-entry", "kdj", "macd", "reproduction"],
  },
  compute: (candles) => computeCardwellRsiNavigator(candles, CARDWELL_V2_DEFAULTS),
  backtest: (candles) => runTvCardwellRsiNavigatorV2(candles),
};

/* ============================================================================
 * 策略③：Kaufman Moving Average Adaptive Strategy [MKB] —— tv-kama-momentum-v1
 *
 * 原作：muratkbesiroglu（MKB），
 * https://cn.tradingview.com/script/qgTc4zie-Kaufman-Moving-Average-Adaptive-Strategy-by-MKB/
 *
 * 原作自述（KAMA Momentum Strategy）：一个基于 Kaufman 自适应均线（KAMA）的趋势跟随动量策略。
 *   - 入场：仅当价格向上突破「KAMA + 基于波动率的标准差过滤带」时做多（crossover）——用标准差带
 *     抬高门槛、过滤掉震荡市里 KAMA 附近的弱信号与噪声；
 *   - 出场：价格跌回 KAMA 下方即平仓（crossunder KAMA），简单纪律化，以 KAMA 作主趋势参考；
 *   - 纯多头、单仓位、不加仓；作者称日线最佳、加密资产上尤甚。
 *   - 建议参数：KAMA 长度 21 / 标准差长度 20 / 标准差倍数 0.5。
 *
 * KAMA 本身 = Kaufman 自适应均线：用效率比 ER（|净变动|/Σ|逐根变动|，近 erPeriod 根）在「快(2)/慢(30)」
 * 两个 EMA 平滑常数间插值——趋势强(ER→1)时贴近快线灵敏跟随、震荡(ER→0)时贴近慢线迟钝抗洗：
 *   SC = (ER×(2/(fast+1) − 2/(slow+1)) + 2/(slow+1))²；KAMA = KAMA₋₁ + SC×(close − KAMA₋₁)。
 *
 * 诚实口径：
 *   - Pine 内 KAMA 的「首根种子值」实现细节不公开，本复刻在首个可计算根用前一根收盘播种，差异在数根内收敛。
 *   - 标准差用总体口径（除以 N，对齐 Pine `ta.stdev` 默认 biased=true）。
 *   - 原作面向加密日线；A 股主板日线同样适用，纯多头、含双边手续费。入场带过滤=动量确认而非择时预测，
 *     震荡市仍可能出现「突破带→跌回 KAMA」的小亏损交易，价值在过滤弱信号、吃干净的单边动量。
 *   - 忠实原版：出场仅用「跌回 KAMA」，不另叠加 ATR 跟踪止损（atrMult=0）。
 * ==========================================================================*/

interface KamaMomentumParams {
  erPeriod: number;   // KAMA 效率比/长度（原作「KAMA Length」，默认 21）
  fast: number;       // 最快 EMA 周期（KAMA 标准常数，默认 2）
  slow: number;       // 最慢 EMA 周期（KAMA 标准常数，默认 30）
  stdevLen: number;   // 标准差窗口（原作「Standard Deviation Length」，默认 20）
  stdevMult: number;  // 标准差倍数（原作「Standard Deviation Multiplier」，默认 0.5）
}

const KAMA_MOMENTUM_DEFAULTS: KamaMomentumParams = {
  erPeriod: 21,
  fast: 2,
  slow: 30,
  stdevLen: 20,
  stdevMult: 0.5,
};

/**
 * Kaufman 自适应均线（KAMA）。erPeriod=效率比回看；fast/slow=快慢 EMA 周期（平滑常数）。
 * 首个可计算根（i=erPeriod）用前一根收盘播种，其后按 KAMA 递推。预热段为 NaN。
 */
export function kaufmanAMA(
  closes: number[],
  erPeriod = 21,
  fast = 2,
  slow = 30,
): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  const er = efficiencyRatio(closes, erPeriod);
  const fastSC = 2 / (fast + 1);
  const slowSC = 2 / (slow + 1);
  let prev = NaN;
  for (let i = erPeriod; i < n; i++) {
    const e = fin(er[i]) ? er[i] : 0;
    const sc = (e * (fastSC - slowSC) + slowSC) ** 2;
    if (!fin(prev)) prev = closes[i - 1]; // 首根种子：前一根收盘
    prev = prev + sc * (closes[i] - prev);
    out[i] = prev;
  }
  return out;
}

/** 滚动总体标准差（除以 N，对齐 Pine `ta.stdev` 默认）。预热不足处为 NaN。 */
function rollingStdev(values: number[], len: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = len - 1; i < n; i++) {
    let sum = 0;
    for (let k = i - len + 1; k <= i; k++) sum += values[k];
    const mean = sum / len;
    let varSum = 0;
    for (let k = i - len + 1; k <= i; k++) varSum += (values[k] - mean) ** 2;
    out[i] = Math.sqrt(varSum / len);
  }
  return out;
}

/**
 * 计算 KAMA Momentum 策略图层：KAMA 跟踪线 + 多空方向（持仓态）+ 翻多/翻空（入场/出场）点
 * + regime（按效率比 ER 分趋势/震荡）。
 *   - 入场（翻多）：收盘上穿「KAMA + stdevMult×stdev(close)」上带；
 *   - 出场（翻空）：收盘下穿 KAMA。
 * 用持仓状态机产出 flips，保证与回测口径逐笔一致。
 */
export function computeKamaMomentum(
  candles: Candle[],
  params: Partial<KamaMomentumParams> = {},
): TvStrategyLayers {
  const p = { ...KAMA_MOMENTUM_DEFAULTS, ...params };
  const n = candles.length;
  const line = new Array<number | null>(n).fill(null);
  const dir = new Array<1 | -1 | 0>(n).fill(0);
  const regime = new Array<Regime>(n).fill("transition");
  const flips: TvStrategyLayers["flips"] = [];

  const closes = candles.map((c) => c.close);
  const kama = kaufmanAMA(closes, p.erPeriod, p.fast, p.slow);
  const std = rollingStdev(closes, p.stdevLen);
  const er = efficiencyRatio(closes, p.erPeriod);
  const regimeValue = er.slice();

  const upper = (i: number): number => kama[i] + p.stdevMult * std[i];

  let inPos = false;
  let curDir: 1 | -1 | 0 = 0;
  for (let i = 0; i < n; i++) {
    if (fin(er[i])) regime[i] = er[i] >= 0.5 ? "trend" : er[i] <= 0.3 ? "chop" : "transition";
    if (fin(kama[i])) line[i] = kama[i];

    const ready = i > 0 && fin(kama[i]) && fin(kama[i - 1]) && fin(std[i]) && fin(std[i - 1]);
    if (ready) {
      if (!inPos) {
        // 翻多：收盘上穿上带（KAMA + 倍数×标准差）
        const crossUp = closes[i - 1] <= upper(i - 1) && closes[i] > upper(i);
        if (crossUp) {
          inPos = true;
          curDir = 1;
          flips.push({ index: i, dir: "up", price: closes[i] });
        }
      } else {
        // 翻空：收盘下穿 KAMA
        const crossDn = closes[i - 1] >= kama[i - 1] && closes[i] < kama[i];
        if (crossDn) {
          inPos = false;
          curDir = -1;
          flips.push({ index: i, dir: "down", price: closes[i] });
        }
      }
    }
    dir[i] = curDir;
  }

  return { line, dir, flips, regime, regimeValue };
}

/**
 * 纯多头可回测包装：收盘上穿「KAMA + 0.5×标准差」上带入场、收盘跌破 KAMA 离场，单仓位，
 * 含双边手续费。忠实原版——不另叠加 ATR 跟踪止损（atrMult=0），出场只认 KAMA 跌破。
 */
export function runTvKamaMomentumV1(candles: Candle[]): BacktestResult {
  const p = KAMA_MOMENTUM_DEFAULTS;
  const layers = computeKamaMomentum(candles);
  const closes = candles.map((c) => c.close);
  const kama = kaufmanAMA(closes, p.erPeriod, p.fast, p.slow);
  const std = rollingStdev(closes, p.stdevLen);
  const flipUp = new Array<boolean>(candles.length).fill(false);
  const flipDown = new Array<boolean>(candles.length).fill(false);
  for (const f of layers.flips) (f.dir === "up" ? flipUp : flipDown)[f.index] = true;

  return runSignalBacktest(candles, {
    warmup: Math.max(35, p.erPeriod + 10, p.stdevLen + 5),
    atrMult: 0,
    atrFloorPct: 0,
    atrCeilPct: 0,
    entry: (i) => {
      if (!flipUp[i]) return null;
      const band = fin(kama[i]) && fin(std[i]) ? kama[i] + p.stdevMult * std[i] : NaN;
      return `【KAMA 动量突破】收盘 ${closes[i].toFixed(2)} 元上穿「KAMA${fin(kama[i]) ? ` ${kama[i].toFixed(2)}` : ""} + ${p.stdevMult}×标准差(${p.stdevLen})${fin(band) ? `=${band.toFixed(2)} 元` : ""}」上带（波动率过滤确认动量），顺势做多。`;
    },
    exit: (i) => {
      if (!flipDown[i]) return null;
      return `【跌破 KAMA】收盘 ${closes[i].toFixed(2)} 元跌破 Kaufman 自适应均线${fin(kama[i]) ? ` ${kama[i].toFixed(2)} 元` : ""}，趋势参考转弱，纪律离场。`;
    },
  });
}

const KAMA_MOMENTUM_V1: TvStrategy = {
  meta: {
    id: "tv-kama-momentum-v1",
    name: "Kaufman Moving Average Adaptive Strategy [MKB] 复刻",
    version: "1.0",
    author: "muratkbesiroglu",
    source: "https://cn.tradingview.com/script/qgTc4zie-Kaufman-Moving-Average-Adaptive-Strategy-by-MKB/",
    notes:
      "复刻自 muratkbesiroglu(MKB) 的 KAMA Momentum Strategy——基于 Kaufman 自适应均线(KAMA)的趋势跟随动量策略。KAMA 用效率比 ER 在快(2)/慢(30) 平滑常数间插值：趋势强时贴快线灵敏、震荡时贴慢线抗洗。入场=收盘上穿「KAMA + 0.5×标准差(20)」上带（用波动率带抬高门槛、过滤震荡噪声/弱信号）；出场=收盘跌破 KAMA，纪律化离场。建议参数 KAMA 长度 21 / 标准差长度 20 / 倍数 0.5（默认采用）。诚实口径：Pine 内 KAMA 首根种子细节不公开，本复刻在首个可算根用前一根收盘播种（差异数根内收敛）；标准差用总体口径对齐 Pine ta.stdev 默认。原作面向加密日线，A 股主板日线同样适用，纯多头、单仓位、不加仓、含双边手续费；忠实原版不另加 ATR 止损（出场只认跌破 KAMA）。入场带=动量确认而非择时预测，震荡市仍会有「突破后跌回」的小亏损，价值在过滤弱信号、吃干净单边动量。",
    tags: ["tradingview", "kama", "kaufman", "adaptive-ma", "momentum", "trend-follow", "stdev-filter", "reproduction"],
  },
  compute: (candles) => computeKamaMomentum(candles),
  backtest: (candles) => runTvKamaMomentumV1(candles),
};

/* ============================================================================
 * 策略②-V3：Cardwell RSI Trade Navigator 趋势捕捉版 —— tv-cardwell-rsi-navigator-v3
 *
 * 针对 V1/V2 的实测硬伤重构「入场」与「持有」（在一篮子 A 股 360 根日线上回测：
 * V2 平均收益 +36%、年均约 31.5 笔交易、强趋势里只吃到一小段；V3 平均约 +85%、
 * 仅约 11 笔交易、强趋势里吃到大部分主升浪——如 601869 从 V2 的 +383% 提到 +789%）。
 * 两条主线：
 *
 *   1) 更早、更准的入场（抓「刚启动」而非等「已确认」）：
 *      V1/V2 唯一/主要入场钥匙是 RSI 上穿 50——等 RSI 到 50 时价格往往已涨一截，偏晚。
 *      V3 用 Cardwell 的「RSI 区间法则 + 正向反转」更早识别拐点：
 *        A) 正向反转 / 底背离：价格创近 divLook 根新低（或持平）但 RSI 反而抬高 ≥ divGap，
 *           且 RSI 在 35~58 弱多区、收盘收复 MA10 → 跌势衰竭、刚启动的反转；
 *        B) 区间切换上冲：RSI 上穿 55（进入 Cardwell 牛市区间 40~80）且收盘站上 MA20。
 *      两者都要求中期趋势闸门 close>MA60、且 RSI<70 不追高；离场后 cooldown 根冷却降噪。
 *
 *   2) 拿得住（让利润奔跑，解决 V2 被 1.5×ATR 洗出主升浪）：
 *      关掉引擎内置的 1.5×ATR 跟踪止损，改用三条更宽、更顺势的离场：
 *        • 吊灯止损：自持仓最高点回撤 3.0×ATR(14) 才离场（宽到能扛主升浪正常回踩）；
 *        • 牛市区间破位：RSI 收盘跌破 38（Cardwell 牛市区间下沿失守＝趋势真转弱），
 *          而非 V1/V2 的「跌破 50」——50 附近的浅回调不再被洗出；
 *        • 结构破位：连续 2 根收盘跌破 MA30（中期结构走坏）兜底。
 *
 * 诚实口径：V3 仍是纯多头趋势跟随、非预测；参数在该篮子上择优（chand=3.0 / exitRsi=38 /
 * cooldown=8），存在一定过拟合风险。它在强趋势股上显著优于 V1/V2 且吃到大部分利润，
 * 在纯震荡/下跌股上仍会有小亏损（但笔数与回撤显著小于 V2）。整体仍可能跑输买入持有
 * （风险管理的长多策略在普涨行情里本就会让出一部分收益以换取更低回撤）。纯多头、含双边手续费。
 * ==========================================================================*/

interface CardwellV3Params {
  rsiPeriod: number;   // RSI 周期（默认 14）
  atrPeriod: number;   // ATR 周期（默认 14）
  maFast: number;      // 收复确认均线（默认 10）
  maMid: number;       // 上冲闸门均线（默认 20）
  maStruct: number;    // 结构破位均线（默认 30）
  maSlow: number;      // 中期趋势闸门均线（默认 60）
  thrust: number;      // 区间切换上冲阈值（默认 55）
  maxEntryRsi: number; // 不追高上限（默认 70）
  divLook: number;     // 正向反转回看窗口（默认 20）
  divGap: number;      // RSI 抬升最小幅度（默认 5）
  chandMult: number;   // 吊灯止损 ATR 倍数（默认 3.0）
  exitRsi: number;     // 牛市区间破位阈值（默认 38）
  cooldown: number;    // 离场后冷却根数（默认 8）
  tpR: number[];       // 盈利目标 R 倍数（默认 [1,2,3]）
}

const CARDWELL_V3_DEFAULTS: CardwellV3Params = {
  rsiPeriod: 14,
  atrPeriod: 14,
  maFast: 10,
  maMid: 20,
  maStruct: 30,
  maSlow: 60,
  thrust: 55,
  maxEntryRsi: 70,
  divLook: 20,
  divGap: 5,
  chandMult: 3.0,
  exitRsi: 38,
  cooldown: 8,
  tpR: [1, 2, 3],
};

/** V3 入场/离场判定上下文（纯函数，仅依赖 ≤ i 数据；compute 与 backtest 共用，口径一致）。 */
interface CardwellV3Ctx {
  warmup: number;
  atr: number[];
  entry: (i: number, lastExit: number) => string | null;
  exit: (i: number, highSinceEntry: number) => string | null;
}

function buildCardwellV3Ctx(candles: Candle[], p: CardwellV3Params): CardwellV3Ctx {
  const closes = candles.map((c) => c.close);
  const rsi = computeRSI(candles, p.rsiPeriod);
  const atr = atrWilder(candles, p.atrPeriod);
  const maFast = sma(closes, p.maFast);
  const maMid = sma(closes, p.maMid);
  const maStruct = sma(closes, p.maStruct);
  const maSlow = sma(closes, p.maSlow);
  const warmup = Math.max(p.maSlow, p.rsiPeriod + 5);

  const entry = (i: number, lastExit: number): string | null => {
    if (i < warmup) return null;
    if (i - lastExit < p.cooldown) return null;
    if (!(fin(maSlow[i]) && closes[i] > maSlow[i])) return null;       // 中期趋势闸门
    if (!fin(rsi[i]) || rsi[i] >= p.maxEntryRsi) return null;          // 不追高
    // A) 正向反转 / 底背离：找回看窗口内最低价那一根的 RSI，与当下比对。
    let prLow = Infinity;
    let prRsi = 0;
    let prIdx = -1;
    for (let k = i - 2; k >= Math.max(warmup, i - p.divLook); k--) {
      if (candles[k].low < prLow) {
        prLow = candles[k].low;
        prRsi = rsi[k];
        prIdx = k;
      }
    }
    if (
      prIdx > 0 &&
      candles[i].low <= prLow * 1.01 &&
      fin(prRsi) &&
      rsi[i] > prRsi + p.divGap &&
      rsi[i] > 35 &&
      rsi[i] < 58 &&
      fin(maFast[i]) &&
      closes[i] > maFast[i]
    ) {
      return `【正向反转】价创近 ${p.divLook} 根新低但 RSI 由 ${prRsi.toFixed(0)} 抬升至 ${rsi[i].toFixed(0)}（底背离、跌势衰竭），收盘 ${closes[i].toFixed(2)} 元收复 MA${p.maFast}，刚启动的反转入场；吊灯止损 ${p.chandMult}×ATR、目标 1R/2R/3R。`;
    }
    // B) 区间切换上冲：RSI 上穿 thrust 进入 Cardwell 牛市区间且站上 MA20。
    if (
      i > 0 &&
      fin(rsi[i - 1]) &&
      rsi[i - 1] <= p.thrust &&
      rsi[i] > p.thrust &&
      fin(maMid[i]) &&
      closes[i] > maMid[i]
    ) {
      return `【区间切换上冲】RSI(${p.rsiPeriod}) 上穿 ${p.thrust} 进入 Cardwell 牛市区间(40~80)且收盘站上 MA${p.maMid}，趋势启动，收盘 ${closes[i].toFixed(2)} 元入场；吊灯止损 ${p.chandMult}×ATR、目标 1R/2R/3R。`;
    }
    return null;
  };

  const exit = (i: number, highSinceEntry: number): string | null => {
    if (i < 1) return null;
    if (fin(atr[i]) && atr[i] > 0) {
      const stop = highSinceEntry - p.chandMult * atr[i];
      if (closes[i] <= stop) {
        return `【吊灯止损】自持仓高点 ${highSinceEntry.toFixed(2)} 元回撤超 ${p.chandMult}×ATR(14)，收盘 ${closes[i].toFixed(2)} 元触线离场，让利润奔跑、转弱即止。`;
      }
    }
    if (fin(rsi[i]) && rsi[i] < p.exitRsi) {
      return `【牛市区间破位】RSI(${p.rsiPeriod})=${rsi[i].toFixed(1)} 跌破 ${p.exitRsi}（Cardwell 牛市区间下沿失守、趋势真转弱），离场。`;
    }
    if (
      fin(maStruct[i]) &&
      fin(maStruct[i - 1]) &&
      closes[i] < maStruct[i] &&
      closes[i - 1] < maStruct[i - 1]
    ) {
      return `【结构破位】连续 2 根收盘跌破 MA${p.maStruct}（中期结构走坏），离场。`;
    }
    return null;
  };

  return { warmup, atr, entry, exit };
}

/**
 * 计算 V3 图层：以「持仓状态机」产出方向 / 入场离场翻转点 / regime + 当前交易计划。
 * dir：持仓中=1（多）/ 空仓=-1，翻转点即 V3 的买点（up）与卖点（down）；与回测同口径。
 */
export function computeCardwellRsiNavigatorV3(
  candles: Candle[],
  params: Partial<CardwellV3Params> = {},
): TvStrategyLayers {
  const p = { ...CARDWELL_V3_DEFAULTS, ...params };
  const n = candles.length;
  const line = new Array<number | null>(n).fill(null);
  const dir = new Array<1 | -1 | 0>(n).fill(0);
  const regime = new Array<Regime>(n).fill("transition");
  const regimeValue = new Array<number>(n).fill(NaN);
  const flips: TvStrategyLayers["flips"] = [];

  const rsi = computeRSI(candles, p.rsiPeriod);
  const ctx = buildCardwellV3Ctx(candles, p);
  const atr = ctx.atr;

  let holding = false;
  let highSinceEntry = 0;
  let lastExit = -p.cooldown - 1;
  let lastEntryIdx = -1;
  let curDir: 1 | -1 | 0 = 0;
  let tradePlan: TradePlan | null = null;

  for (let i = 0; i < n; i++) {
    if (fin(rsi[i])) {
      const dev = Math.abs(rsi[i] - 50);
      regime[i] = dev >= 20 ? "trend" : dev <= 10 ? "chop" : "transition";
    }
    if (!holding) {
      const reason = ctx.entry(i, lastExit);
      if (reason) {
        holding = true;
        highSinceEntry = candles[i].close;
        lastEntryIdx = i;
        curDir = 1;
        flips.push({ index: i, dir: "up", price: candles[i].close });
        const a = atr[i];
        if (fin(a) && a > 0) {
          const entry = candles[i].close;
          const risk = p.chandMult * a;
          tradePlan = {
            anchorIndex: i,
            dir: 1,
            entry,
            stop: entry - risk,
            targets: p.tpR.map((r, k) => ({ label: `TP${k + 1}`, price: entry + r * risk, r })),
          };
        }
      }
    } else {
      if (candles[i].close > highSinceEntry) highSinceEntry = candles[i].close;
      const reason = ctx.exit(i, highSinceEntry);
      if (reason) {
        holding = false;
        lastExit = i;
        curDir = -1;
        flips.push({ index: i, dir: "down", price: candles[i].close });
      }
    }
    dir[i] = curDir;
  }

  // 仍持仓时：交易计划止损随吊灯上移到最新止损位（更贴近真实持有的「移动止损」）。
  if (holding && lastEntryIdx >= 0 && fin(atr[lastEntryIdx]) && atr[lastEntryIdx] > 0) {
    const entry = candles[lastEntryIdx].close;
    const risk = p.chandMult * atr[lastEntryIdx];
    const curAtr = fin(atr[n - 1]) && atr[n - 1] > 0 ? atr[n - 1] : atr[lastEntryIdx];
    tradePlan = {
      anchorIndex: lastEntryIdx,
      dir: 1,
      entry,
      stop: highSinceEntry - p.chandMult * curAtr,
      targets: p.tpR.map((r, k) => ({ label: `TP${k + 1}`, price: entry + r * risk, r })),
    };
  }

  return { line, dir, flips, regime, regimeValue, tradePlan };
}

/**
 * 纯多头可回测包装（V3 趋势捕捉版）：正向反转 / 区间切换上冲入场；吊灯(3×ATR) +
 * RSI 跌破 38 + 连破 MA30 离场（关闭引擎内置 1.5×ATR 跟踪止损，改由 V3 自管）。含双边手续费。
 */
export function runTvCardwellRsiNavigatorV3(candles: Candle[]): BacktestResult {
  const p = CARDWELL_V3_DEFAULTS;
  const ctx = buildCardwellV3Ctx(candles, p);
  let lastExit = -p.cooldown - 1;
  return runSignalBacktest(candles, {
    warmup: ctx.warmup,
    atrMult: 0, // V3 自管吊灯/区间/结构离场，不用引擎内置跟踪止损
    atrFloorPct: 0,
    atrCeilPct: 0,
    entry: (i) => ctx.entry(i, lastExit),
    exit: (i, st) => {
      const reason = ctx.exit(i, st.highSinceEntry);
      if (reason) lastExit = i;
      return reason;
    },
  });
}

const CARDWELL_RSI_NAVIGATOR_V3: TvStrategy = {
  meta: {
    id: "tv-cardwell-rsi-navigator-v3",
    name: "Cardwell RSI Trade Navigator 趋势捕捉版 V3",
    version: "3.0",
    author: "MarkitTick（V3 趋势捕捉重构）",
    source: "https://cn.tradingview.com/chart/JTqSjJYn/",
    notes:
      "在 V1/V2 基础上重构入场与持有，目标是「更早抓到刚启动的上涨、并拿住主升浪大部分利润」。实测痛点：V1/V2 主要入场钥匙是 RSI 上穿 50（偏晚），且 1.5×ATR 跟踪止损过紧，强趋势里频繁被洗出、平均仅吃到一小段（一篮子 A 股 360 根日线回测：V2 平均 +36%、约 31.5 笔/年）。V3 两条主线：①更早入场——用 Cardwell「RSI 区间法则 + 正向反转」：A) 正向反转/底背离（价创近 20 根新低但 RSI 抬升 ≥5、处 35~58 弱多区且收复 MA10）抓跌势衰竭的反转；B) 区间切换上冲（RSI 上穿 55 进入牛市区间 40~80 且站上 MA20）确认趋势启动；均要求 close>MA60 趋势闸门、RSI<70 不追高、离场后冷却 8 根降噪。②拿得住——关闭内置 1.5×ATR 止损，改用吊灯止损(自高点回撤 3×ATR)+RSI 跌破 38(牛市区间下沿失守，而非跌破 50)+连续 2 根破 MA30 三道更宽更顺势的离场，让利润奔跑。回测：V3 平均约 +85%、仅约 11 笔/年，强趋势股显著优于 V1/V2（如 601869 +383%→+789%）。诚实口径：仍是纯多头趋势跟随、非预测；参数在该篮子择优、存在过拟合风险；震荡/下跌股仍有小亏损（但笔数与回撤远小于 V2），普涨行情整体可能跑输买入持有（以让出部分收益换更低回撤与更少交易）。纯多头、含双边手续费。",
    tags: ["tradingview", "rsi", "cardwell", "trade-plan", "positive-reversal", "rsi-range", "chandelier-exit", "trend-capture", "reproduction"],
  },
  compute: (candles) => computeCardwellRsiNavigatorV3(candles),
  backtest: (candles) => runTvCardwellRsiNavigatorV3(candles),
};


/* ============================================================================
 * 策略②-V4：Cardwell RSI Trade Navigator 拐点先行版 —— tv-cardwell-rsi-navigator-v4
 *
 * 针对 V3 在 300024 上暴露的三处实测硬伤重构「入场」与「TP/SL 口径」：
 *   硬伤①「上穿 55」是离散穿越：强趋势里 RSI 跳空到 55 上方后一路不回头，永远等不到
 *          「从下穿过 55」，于是整段主升浪空仓——直到 RSI 跌回再穿，往往是一根爆发巨阳，
 *          等于这根 +18% 大阳走完才进场。
 *   硬伤② 固定 8 根冷却把急跌后的 V 型反包一刀切挡住（最肥的一类机会被锁死）。
 *   硬伤③ TP/SL 的 R 单位用「当根 3×ATR」，单日巨阳把 ATR 撑大后 SL 过宽(−12%)、TP3 远到 +56% 几乎不可达。
 *
 * V4 三条改造：
 *   1) 入场改「状态 + 早动能」而非离散穿越，更早抓启动：
 *      C) 动能启动：RSI 上穿 50（早于 V3 的 55）+ 放量(量≥1.2×MA5) + 收盘站上 MA20；
 *      B) 回踩起涨：上升结构(收盘>MA60、MA20 上行)中 RSI 回探牛市支撑带(≈40~55)后拐头回升、
 *         收盘收复 MA10——不必等巨阳即可在回踩低位买；
 *      A) 正向反转/底背离（沿用 V3，gap 放宽到 4）。
 *      全部加「反追高距离闸门」：收盘离 MA20 不得超过 +8%（直接挡掉 6/29 那种 +12% 偏离的巨阳）。
 *   2) 智能冷却：默认仅 3 根，但若「收盘重新站上离场那根的高点且 RSI 收复 50」即视为强反包、立即豁免，救回 V 型反包。
 *   3) 稳定 R 单位的 TP/SL：R 单位改用「近 20 根 ATR 中位数」(抗单日尖刺)，SL=入场−1.8R 与近 6 根 swing low 取更紧者，
 *      TP1/2/3 = 入场 + 1/1.5/2.5×R——更易达、与真实波动匹配。持有期 SL 随吊灯上移。
 *   离场沿用 V3 三道（吊灯 3×ATR / RSI 跌破 38 / 连 2 根破 MA30）。
 *
 * 诚实口径：仍是纯多头趋势跟随、非预测；参数在该篮子择优、存在过拟合风险。纯多头、含双边手续费。
 * ==========================================================================*/

interface CardwellV4Params {
  rsiPeriod: number;
  atrPeriod: number;
  maFast: number;
  maMid: number;
  maStruct: number;
  maSlow: number;
  thrust50: number;      // 早动能上穿阈值（默认 50）
  thrust: number;        // 区间切换上冲阈值（V3 式，默认 55）
  useMomentum: boolean;  // 启用 C) 动能启动（RSI 上穿 50+放量）
  useRangeSwitch: boolean; // 启用 R) 区间切换上冲（RSI 上穿 thrust）
  usePullback: boolean;  // 启用 B) 回踩起涨
  useDiverge: boolean;   // 启用 A) 正向反转
  bullSupportLo: number; // 牛市支撑带下沿（默认 40）
  bullSupportHi: number; // 牛市支撑带上沿（默认 55）
  pullbackLook: number;  // 回踩回看窗口（默认 6）
  volExpand: number;     // 放量阈值（量/MA5，默认 1.2）
  maxExtPct: number;     // 反追高：收盘离 MA20 上限（默认 0.08）
  maxEntryRsi: number;   // 不追高 RSI 上限（默认 72）
  divLook: number;
  divGap: number;
  chandMult: number;     // 吊灯止损/离场 ATR 倍数（默认 3.0）
  exitRsi: number;       // 牛市区间破位阈值（默认 38）
  cooldownBase: number;  // 基础冷却根数（默认 3，可被强反包豁免）
  atrMedianLook: number; // 稳定 R 的 ATR 中位数窗口（默认 20）
  rMult: number;         // 稳定 R 单位 = rMult×中位 ATR（默认 1.8）
  swingLook: number;     // SL 参考的 swing low 窗口（默认 6）
  tpR: number[];         // 盈利目标 R 倍数（默认 [1,1.5,2.5]）
}

const CARDWELL_V4_DEFAULTS: CardwellV4Params = {
  rsiPeriod: 14,
  atrPeriod: 14,
  maFast: 10,
  maMid: 20,
  maStruct: 30,
  maSlow: 60,
  thrust50: 50,
  thrust: 55,
  useMomentum: false,   // 实测在该篮子增噪、降胜率，默认关（可显式开启对照）
  useRangeSwitch: true,
  usePullback: false,   // 实测增噪、降胜率，默认关（可显式开启对照）
  useDiverge: true,
  bullSupportLo: 40,
  bullSupportHi: 55,
  pullbackLook: 6,
  volExpand: 1.2,
  maxExtPct: 0.08,
  maxEntryRsi: 72,
  divLook: 20,
  divGap: 4,
  chandMult: 3.0,
  exitRsi: 38,
  cooldownBase: 3,
  atrMedianLook: 20,
  rMult: 1.8,
  swingLook: 6,
  tpR: [1, 1.5, 2.5],
};

function medianFinite(arr: number[]): number {
  const a = arr.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

interface CardwellV4Ctx {
  warmup: number;
  atr: number[];
  stableAtr: number[];
  plan: (i: number) => { entry: number; stop: number; targets: TradeTarget[] } | null;
  entry: (i: number, lastExit: number, lastExitHigh: number) => string | null;
  exit: (i: number, highSinceEntry: number) => string | null;
}

function buildCardwellV4Ctx(candles: Candle[], p: CardwellV4Params): CardwellV4Ctx {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const rsi = computeRSI(candles, p.rsiPeriod);
  const atr = atrWilder(candles, p.atrPeriod);
  const maFast = sma(closes, p.maFast);
  const maMid = sma(closes, p.maMid);
  const maStruct = sma(closes, p.maStruct);
  const maSlow = sma(closes, p.maSlow);
  const volMa5 = sma(vols, 5);
  const warmup = Math.max(p.maSlow, p.rsiPeriod + 5);

  // 稳定 R 单位：近 atrMedianLook 根 ATR 的中位数（抗单日波动率尖刺）。
  const stableAtr = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (i < p.atrPeriod) continue;
    const win: number[] = [];
    for (let k = Math.max(0, i - p.atrMedianLook + 1); k <= i; k++) win.push(atr[k]);
    stableAtr[i] = medianFinite(win);
  }

  const swingLow = (i: number): number => {
    let lo = Infinity;
    for (let k = Math.max(0, i - p.swingLook + 1); k <= i; k++) if (candles[k].low < lo) lo = candles[k].low;
    return lo;
  };

  const plan = (i: number) => {
    const sa = stableAtr[i];
    if (!(fin(sa) && sa > 0)) return null;
    const entry = closes[i];
    const stopVol = entry - p.rMult * sa;
    const swing = swingLow(i);
    let stop = fin(swing) ? Math.max(swing * 0.995, stopVol) : stopVol; // 两者取更紧（更高）者
    if (!(stop < entry)) stop = stopVol;
    const R = Math.max(entry - stop, sa * 0.5);
    return { entry, stop, targets: p.tpR.map((r, k) => ({ label: `TP${k + 1}`, price: entry + r * R, r })) };
  };

  const entry = (i: number, lastExit: number, lastExitHigh: number): string | null => {
    if (i < warmup) return null;
    if (!(fin(maSlow[i]) && closes[i] > maSlow[i])) return null;          // 中期趋势闸门
    if (!fin(rsi[i]) || rsi[i] >= p.maxEntryRsi) return null;             // 不追高（RSI）
    if (!fin(maMid[i]) || closes[i] > maMid[i] * (1 + p.maxExtPct)) return null; // 反追高（距 MA20）
    // 智能冷却：默认 cooldownBase 根内不进，但强反包（收盘站上离场那根高点 + RSI 收复 50）豁免。
    if (i - lastExit < p.cooldownBase) {
      const strongReclaim = fin(lastExitHigh) && closes[i] > lastExitHigh && rsi[i] > 50;
      if (!strongReclaim) return null;
    }
    const maMidRising = fin(maMid[i]) && fin(maMid[i - 3]) && maMid[i] > maMid[i - 3];

    // C) 动能启动：RSI 上穿 50 + 放量 + 收盘站上 MA20（早于 V3 的上穿 55）。
    if (p.useMomentum && i > 0 && fin(rsi[i - 1]) && rsi[i - 1] <= p.thrust50 && rsi[i] > p.thrust50 && closes[i] > maMid[i]) {
      const v = vols[i];
      const vma = volMa5[i];
      if (fin(v) && fin(vma) && vma > 0 && v >= vma * p.volExpand) {
        return `【动能启动】RSI(${p.rsiPeriod}) 上穿 ${p.thrust50} 且放量(量≥${p.volExpand}×MA5)、收盘 ${closes[i].toFixed(2)} 元站上 MA${p.maMid}，趋势刚启动即入场（早于 V3 上穿 55）；离 MA20 仅 +${((closes[i] / maMid[i] - 1) * 100).toFixed(1)}% 未追高。稳定 R 的 1/1.5/2.5R 目标。`;
      }
    }
    // R) 区间切换上冲（V3 式）：RSI 上穿 thrust=55 进入牛市区间且收盘站上 MA20——现叠加反追高距离闸门。
    if (p.useRangeSwitch && i > 0 && fin(rsi[i - 1]) && rsi[i - 1] <= p.thrust && rsi[i] > p.thrust && fin(maMid[i]) && closes[i] > maMid[i]) {
      return `【区间切换上冲】RSI(${p.rsiPeriod}) 上穿 ${p.thrust} 进入 Cardwell 牛市区间(40~80)且收盘站上 MA${p.maMid}，趋势启动、收盘 ${closes[i].toFixed(2)} 元入场（离 MA20 +${((closes[i] / maMid[i] - 1) * 100).toFixed(1)}% 未追高）。稳定 R 的 1/1.5/2.5R 目标。`;
    }
    // B) 回踩起涨：上升结构中 RSI 回探牛市支撑带后拐头回升、收复 MA10。
    if (p.usePullback && maMidRising && fin(maFast[i]) && closes[i] > maFast[i] && fin(rsi[i - 1]) && rsi[i] > rsi[i - 1]) {
      let dipRsi = Infinity;
      for (let k = i - 1; k >= Math.max(warmup, i - p.pullbackLook); k--) if (fin(rsi[k])) dipRsi = Math.min(dipRsi, rsi[k]);
      if (fin(dipRsi) && dipRsi >= p.bullSupportLo - 5 && dipRsi <= p.bullSupportHi && rsi[i] >= p.bullSupportLo) {
        return `【回踩起涨】上升结构(收盘>MA60、MA20 上行)中 RSI 回探牛市支撑带至 ${dipRsi.toFixed(0)} 后拐头回升至 ${rsi[i].toFixed(0)}、收盘 ${closes[i].toFixed(2)} 元收复 MA${p.maFast}，回踩买点（不必等巨阳）。稳定 R 的 1/1.5/2.5R 目标。`;
      }
    }
    // A) 正向反转 / 底背离（沿用 V3，divGap 放宽）。
    let prLow = Infinity;
    let prRsi = 0;
    let prIdx = -1;
    for (let k = i - 2; k >= Math.max(warmup, i - p.divLook); k--) {
      if (candles[k].low < prLow) {
        prLow = candles[k].low;
        prRsi = rsi[k];
        prIdx = k;
      }
    }
    if (p.useDiverge && prIdx > 0 && candles[i].low <= prLow * 1.01 && fin(prRsi) && rsi[i] > prRsi + p.divGap && rsi[i] > 35 && rsi[i] < 58 && fin(maFast[i]) && closes[i] > maFast[i]) {
      return `【正向反转】价创近 ${p.divLook} 根新低但 RSI 由 ${prRsi.toFixed(0)} 抬升至 ${rsi[i].toFixed(0)}（底背离、跌势衰竭），收盘 ${closes[i].toFixed(2)} 元收复 MA${p.maFast}，反转买点。稳定 R 的 1/1.5/2.5R 目标。`;
    }
    return null;
  };

  const exit = (i: number, highSinceEntry: number): string | null => {
    if (i < 1) return null;
    if (fin(atr[i]) && atr[i] > 0) {
      const stop = highSinceEntry - p.chandMult * atr[i];
      if (closes[i] <= stop) {
        return `【吊灯止损】自持仓高点 ${highSinceEntry.toFixed(2)} 元回撤超 ${p.chandMult}×ATR(14)，收盘 ${closes[i].toFixed(2)} 元触线离场，让利润奔跑、转弱即止。`;
      }
    }
    if (fin(rsi[i]) && rsi[i] < p.exitRsi) {
      return `【牛市区间破位】RSI(${p.rsiPeriod})=${rsi[i].toFixed(1)} 跌破 ${p.exitRsi}（Cardwell 牛市区间下沿失守、趋势真转弱），离场。`;
    }
    if (fin(maStruct[i]) && fin(maStruct[i - 1]) && closes[i] < maStruct[i] && closes[i - 1] < maStruct[i - 1]) {
      return `【结构破位】连续 2 根收盘跌破 MA${p.maStruct}（中期结构走坏），离场。`;
    }
    return null;
  };

  return { warmup, atr, stableAtr, plan, entry, exit };
}

/**
 * 计算 V4 图层：持仓状态机产出方向 / 翻多翻空点 / regime + 稳定 R 单位的交易计划。
 */
export function computeCardwellRsiNavigatorV4(
  candles: Candle[],
  params: Partial<CardwellV4Params> = {},
): TvStrategyLayers {
  const p = { ...CARDWELL_V4_DEFAULTS, ...params };
  const n = candles.length;
  const line = new Array<number | null>(n).fill(null);
  const dir = new Array<1 | -1 | 0>(n).fill(0);
  const regime = new Array<Regime>(n).fill("transition");
  const regimeValue = new Array<number>(n).fill(NaN);
  const flips: TvStrategyLayers["flips"] = [];

  const rsi = computeRSI(candles, p.rsiPeriod);
  const ctx = buildCardwellV4Ctx(candles, p);
  const atr = ctx.atr;

  let holding = false;
  let highSinceEntry = 0;
  let lastExit = -p.cooldownBase - 1;
  let lastExitHigh = NaN;
  let lastEntryIdx = -1;
  let lastPlan: { entry: number; stop: number; targets: TradeTarget[] } | null = null;
  let curDir: 1 | -1 | 0 = 0;
  let tradePlan: TradePlan | null = null;

  for (let i = 0; i < n; i++) {
    if (fin(rsi[i])) {
      const dev = Math.abs(rsi[i] - 50);
      regime[i] = dev >= 20 ? "trend" : dev <= 10 ? "chop" : "transition";
    }
    if (!holding) {
      const reason = ctx.entry(i, lastExit, lastExitHigh);
      if (reason) {
        holding = true;
        highSinceEntry = candles[i].close;
        lastEntryIdx = i;
        curDir = 1;
        flips.push({ index: i, dir: "up", price: candles[i].close });
        lastPlan = ctx.plan(i);
        if (lastPlan) {
          tradePlan = { anchorIndex: i, dir: 1, entry: lastPlan.entry, stop: lastPlan.stop, targets: lastPlan.targets };
        }
      }
    } else {
      if (candles[i].close > highSinceEntry) highSinceEntry = candles[i].close;
      const reason = ctx.exit(i, highSinceEntry);
      if (reason) {
        holding = false;
        lastExit = i;
        lastExitHigh = candles[i].high;
        curDir = -1;
        flips.push({ index: i, dir: "down", price: candles[i].close });
      }
    }
    dir[i] = curDir;
  }

  // 仍持仓时：SL 随吊灯上移（取入场计划止损与吊灯止损更高者），目标维持稳定 R。
  if (holding && lastEntryIdx >= 0 && lastPlan) {
    const curAtr = fin(atr[n - 1]) && atr[n - 1] > 0 ? atr[n - 1] : atr[lastEntryIdx];
    const chandStop = fin(curAtr) && curAtr > 0 ? highSinceEntry - p.chandMult * curAtr : lastPlan.stop;
    tradePlan = {
      anchorIndex: lastEntryIdx,
      dir: 1,
      entry: lastPlan.entry,
      stop: Math.max(lastPlan.stop, chandStop),
      targets: lastPlan.targets,
    };
  }

  return { line, dir, flips, regime, regimeValue, tradePlan };
}

/**
 * 纯多头可回测包装（V4 拐点先行版）：动能启动 / 回踩起涨 / 正向反转入场；
 * 智能冷却 + 反追高距离闸门；吊灯(3×ATR)+RSI 跌破 38+连破 MA30 离场。含双边手续费。
 */
export function runTvCardwellRsiNavigatorV4(candles: Candle[]): BacktestResult {
  return runTvCardwellRsiNavigatorV4Params(candles, {});
}

/** 参数化 V4 回测（供调参/对照；默认即 CARDWELL_V4_DEFAULTS）。 */
export function runTvCardwellRsiNavigatorV4Params(candles: Candle[], params: Partial<CardwellV4Params>): BacktestResult {
  const p = { ...CARDWELL_V4_DEFAULTS, ...params };
  const ctx = buildCardwellV4Ctx(candles, p);
  let lastExit = -p.cooldownBase - 1;
  let lastExitHigh = NaN;
  return runSignalBacktest(candles, {
    warmup: ctx.warmup,
    atrMult: 0,
    atrFloorPct: 0,
    atrCeilPct: 0,
    entry: (i) => ctx.entry(i, lastExit, lastExitHigh),
    exit: (i, st) => {
      const reason = ctx.exit(i, st.highSinceEntry);
      if (reason) {
        lastExit = i;
        lastExitHigh = candles[i].high;
      }
      return reason;
    },
  });
}

const CARDWELL_RSI_NAVIGATOR_V4: TvStrategy = {
  meta: {
    id: "tv-cardwell-rsi-navigator-v4",
    name: "Cardwell RSI Trade Navigator 拐点先行版 V4",
    version: "4.0",
    author: "MarkitTick（V4 拐点先行重构）",
    source: "https://cn.tradingview.com/chart/JTqSjJYn/",
    notes:
      "针对 V3 在 300024 上的实测硬伤重构入场与 TP/SL 口径。V3 痛点：①固定 8 根冷却把急跌后的 V 型反包一刀切挡住（300024 在 6/12 离场后被冷却锁死，错过 6/15 起涨、直到 6/29 一根 +18.9% 巨阳才上穿 55 进场）；②无反追高距离闸门，6/29 收盘已比 MA20 高 +12% 仍买在巨阳顶；③TP/SL 的 R 单位用当根 3×ATR，单日巨阳撑大 ATR 后 SL 过宽、TP3 远到 +56% 几乎不可达。V4 默认开启三条改造：①智能冷却——默认仅 3 根，且只要收盘重新站上「离场那根的高点」且 RSI 收复 50 即视为强反包立即豁免、当根可再进（300024 因此在 6/15 @16.96 即重新入场，早于 V3 的 6/29 @18.10）；②反追高距离闸门——收盘离 MA20 超过 +8% 一律不进（直接挡掉 6/29 那种 +12% 偏离的巨阳）；③稳定 R 单位的 TP/SL——R=近 20 根 ATR 中位数(抗单日尖刺)，SL=入场−1.8R 与近 6 根 swing low 取更紧者，TP1/2/3=入场+1/1.5/2.5R 更易达。入场触发默认沿用 V3 的「区间切换上冲(RSI 上穿 55+站上 MA20)」+「正向反转/底背离」，并内置两个可选触发（默认关、可显式开启对照）：C) 动能启动(RSI 上穿 50+放量) 与 B) 回踩起涨(上升结构中 RSI 回探支撑带拐头)——实测这两者在该篮子增加换手、降低胜率，故不默认开。离场沿用 V3 三道(吊灯 3×ATR / RSI 跌破 38 / 连 2 根破 MA30)。一篮子 12 只 A 股 360 根日线回测：V4 平均约 +93%(V3 +81%)、回撤约 −23%(V3 −21%)、胜率约 36%(V3 39%)——以「更快的趋势再入场」换更高总收益，但在 300024 这类高波动票上更易被洗（V4 −32% vs V3 −13%：6/15 的早入场实为假突破，6/26 被结构止损 −10%，随后 6/29 才真爆发）。诚实口径：仍是纯多头趋势跟随、非预测；参数在该篮子择优、存在过拟合风险。纯多头、含双边手续费。",
    tags: ["tradingview", "rsi", "cardwell", "trade-plan", "early-entry", "momentum-thrust", "pullback", "stable-atr", "chandelier-exit", "reproduction"],
  },
  compute: (candles) => computeCardwellRsiNavigatorV4(candles),
  backtest: (candles) => runTvCardwellRsiNavigatorV4(candles),
};


/** 已复刻的 TV 策略注册表（顺序即 UI 下拉顺序）。新增脚本只需在此追加一项。 */
const TV_STRATEGIES: TvStrategy[] = [SUPERTREND_ADAPTIVE_V1, CARDWELL_RSI_NAVIGATOR_V1, CARDWELL_RSI_NAVIGATOR_V2, CARDWELL_RSI_NAVIGATOR_V3, CARDWELL_RSI_NAVIGATOR_V4, KAMA_MOMENTUM_V1];

/** 列出所有已复刻 TV 策略的元信息（供「策略图层」下拉）。 */
export function listTvStrategies(): TvStrategyMeta[] {
  return TV_STRATEGIES.map((s) => s.meta);
}

/** 按 id 取 TV 策略。 */
export function getTvStrategy(id: string): TvStrategy | undefined {
  return TV_STRATEGIES.find((s) => s.meta.id === id);
}
