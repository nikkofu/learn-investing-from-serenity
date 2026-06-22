/**
 * 策略注册表 —— 所有可用回测策略的统一登记处。
 *
 * 每个策略带 id / 名称 / 版本 / 简介，前端可下拉切换、互不影响；
 * 以后新增或迭代策略，只需在 STRATEGIES 数组里增改一项即可，UI 与接口自动跟随。
 */
import type { Candle } from "./types";
import {
  runTraditionalMaBacktest,
  runChokepointMomentumBacktest,
  runChokepointMomentumBacktestV2,
  runChokepointMomentumBacktestV3,
  runChokepointMomentumBacktestV4,
  runChokepointMomentumBacktestV5,
  runGridMeanReversionBacktest,
  type BacktestResult,
} from "./quant";

/** 策略元信息（名称 / 版本 / 简介，供 UI 展示与切换）。 */
export interface StrategyMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  tags?: string[];
}

/** 运行策略所需的上下文（基本面分等）。 */
export interface StrategyContext {
  chokepointScore: number;
  code?: string;
}

/** 一个可执行策略：元信息 + 回测执行器。 */
export interface Strategy {
  meta: StrategyMeta;
  run: (candles: Candle[], ctx: StrategyContext) => BacktestResult;
}

/** 策略回测产物（元信息 + 结果），用于接口返回与前端渲染。 */
export interface StrategyBacktest {
  meta: StrategyMeta;
  result: BacktestResult;
}

/** 默认策略 id（页面首次加载与胜率口径采用此策略）。 */
export const DEFAULT_STRATEGY_ID = "chokepoint-momentum-v5";

/**
 * 已登记策略。顺序即 UI 下拉顺序（默认策略置顶）。
 */
const STRATEGIES: Strategy[] = [
  {
    meta: {
      id: "chokepoint-momentum-v5",
      name: "Serenity 瓶颈动量突破",
      version: "5.0",
      description:
        "v4 的 ATR 自适应止损版：入场口径与 v4 完全一致（七类买点 + MA60 中期趋势闸门），并沿用 v4 跟踪止损结构（浮盈 +6% 启动、分段收紧、筹码支撑止损、天量滞涨）。唯一升级：把 v4 的固定回撤百分比（15%/9%）替换为随个股真实波动自适应的回撤距离——跟踪回撤% = clamp(mult×ATR(14)%, 7%, 25%)，mult 随浮盈分段收紧（未到 +20% 用 5.0×、≥ +20% 收紧到 3.0×）。对 3% ATR 的中等波动票回撤≈15%/9%，与 v4 等价；高波动票自动给更宽止损（少被洗）、低波动票自动收紧（少回吐）。因仅改止损距离不改启动条件，换手率与 v4 同量级、可对照。",
      tags: ["momentum", "reversal", "pattern", "trend-filter", "atr-stop", "default"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV5(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v4",
      name: "Serenity 瓶颈动量突破",
      version: "4.0",
      description:
        "v3 的趋势过滤 + 跟踪止损调优版：①右侧四类动量买点（均线金叉 / VCP 突破 / 强势起爆 / 趋势回踩）新增 MA60 中期趋势闸门——仅在价在 MA60 上或 MA60 近 10 日不下行时才追，压住震荡/下行区追突破的诱多；底部三类买点（放量反包 / W底 / 老鸭头）不加闸门，04-17 漏买修复保持不变。②跟踪止损分段：浮盈 +6% 启动，未到 +20% 用宽松 15% 回撤少被洗、≥ +20% 收紧到 9% 锁利润。",
      tags: ["momentum", "reversal", "pattern", "trend-filter"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV4(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v3",
      name: "Serenity 瓶颈动量突破",
      version: "3.0",
      description:
        "v2 的底部反转增强版：在 v2 全部信号之上新增三类左侧/底部买点——⑤放量反包·底部启动（相对低位 + 单日倍量大阳收复 MA20，捕捉平滑量比抓不到的单日爆量，修复 04-17 漏买）；⑥W底/双底突破颈线；⑦老鸭头二次金叉。卖出口径（筹码支撑止损 / 跟踪止损 / 高位天量滞涨）与 v2 一致。",
      tags: ["momentum", "reversal", "pattern"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV3(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v2",
      name: "Serenity 瓶颈动量突破",
      version: "2.0",
      description:
        "v1 的修复版：①上升趋势中回踩 MA20 后可再入场（解决单边主升浪踏空）；②放开强势起爆的高位区位上限，创新高也能买；④固定 35% 止盈改为跟踪止损（让利润奔跑）。其余筹码支撑止损等口径与 v1 一致。",
      tags: ["momentum", "trend"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV2(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v1",
      name: "Serenity 瓶颈动量突破",
      version: "1.0",
      description:
        "初版瓶颈动量：均线金叉 / VCP 平台突破 / 强势起爆三类买点 + 跌破筹码支撑 / 35% 止盈 / 天量滞涨三类卖点。单仓位、仅认新鲜上穿，在单边上涨趋势中易踏空（保留作历史对照）。",
      tags: ["momentum", "legacy"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktest(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "grid-mean-reversion",
      name: "网格·均值回归（regime 门控）",
      version: "1.0",
      description:
        "震荡区专用模块，与动量内核互补：仅在「确认的箱体震荡」（MA60 走平 + 布林带宽适中 + 近 40 日价格被上下沿包住）才启用：触及布林下沿且当日企稳时低吸、回升至上沿高抛止盈；强制带破箱止损（跌破开仓下沿 3% 立即出局、不补仓不马丁格尔），箱体被向上突破则交回趋势策略。高胜率低盈亏比的均值回归口径，仅作震荡行情对照。",
      tags: ["mean-reversion", "grid", "regime-gated"],
    },
    run: (candles) => runGridMeanReversionBacktest(candles),
  },
  {
    meta: {
      id: "traditional-ma",
      name: "传统均线突破",
      version: "1.0",
      description:
        "经典 20 日均线突破 + 放量过滤，跌破均线 / 35% 止盈 / 高位天量滞涨离场。不依赖基本面分，作为对照基准。",
      tags: ["baseline"],
    },
    run: (candles) => runTraditionalMaBacktest(candles),
  },
];

/** 列出所有策略的元信息（供 /api/strategies 与前端下拉）。 */
export function listStrategies(): StrategyMeta[] {
  return STRATEGIES.map((s) => s.meta);
}

/** 已登记策略数量（用于 Deflated Sharpe 的默认"试验次数"，做多重检验校正）。 */
export function strategyCount(): number {
  return STRATEGIES.length;
}

/** 按 id 取策略。 */
export function getStrategy(id: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.meta.id === id);
}

/** 跑全部已登记策略，返回 {元信息, 结果} 数组（顺序同 STRATEGIES）。 */
export function runAllStrategies(candles: Candle[], ctx: StrategyContext): StrategyBacktest[] {
  return STRATEGIES.map((s) => ({ meta: s.meta, result: s.run(candles, ctx) }));
}

/** 从策略产物数组中取默认策略的结果（找不到则取第一个）。 */
export function pickDefaultResult(list: StrategyBacktest[]): BacktestResult | undefined {
  return list.find((s) => s.meta.id === DEFAULT_STRATEGY_ID)?.result ?? list[0]?.result;
}
