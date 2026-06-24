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

/** 市场状态（自适应带宽用）：趋势 / 震荡 / 转折。 */
export type Regime = "trend" | "chop" | "transition";

/** 单个 TV 策略产出的分析图层（与输入 K 线等长，预热不足处用 null/NaN，渲染端跳过）。 */
export interface TvStrategyLayers {
  /** 主图叠加线的值（如 Supertrend 跟踪线）；预热段为 null。 */
  line: (number | null)[];
  /** 每根的方向：1=多头（线在价下方）/ -1=空头（线在价上方）/ 0=未定。 */
  dir: (1 | -1 | 0)[];
  /** 方向翻转点（用于打「翻多 / 翻空」标记）。 */
  flips: { index: number; dir: "up" | "down"; price: number }[];
  /** 每根的 regime 判定（仅读数展示用）。 */
  regime: Regime[];
  /** 每根的 regime 强度代理（效率比的分位，0~1；NaN=未就绪）。 */
  regimeValue: number[];
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

/** 已复刻的 TV 策略注册表（顺序即 UI 下拉顺序）。新增脚本只需在此追加一项。 */
const TV_STRATEGIES: TvStrategy[] = [SUPERTREND_ADAPTIVE_V1];

/** 列出所有已复刻 TV 策略的元信息（供「策略图层」下拉）。 */
export function listTvStrategies(): TvStrategyMeta[] {
  return TV_STRATEGIES.map((s) => s.meta);
}

/** 按 id 取 TV 策略。 */
export function getTvStrategy(id: string): TvStrategy | undefined {
  return TV_STRATEGIES.find((s) => s.meta.id === id);
}
