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
  runChokepointMomentumBacktestV6,
  runChokepointMomentumBacktestV7,
  runChokepointMomentumBacktestV8,
  runGridMeanReversionBacktest,
  executeTradesNextOpen,
  type BacktestResult,
} from "./quant";
import {
  runRsiReversionV1,
  runMacdZeroTrendV1,
  runBollSqueezeV1,
  runFibKdjPullbackV1,
  runConfluenceV1,
} from "./indicatorStrategies";
import { runTvSupertrendAdaptiveV1, runTvCardwellRsiNavigatorV1, runTvCardwellRsiNavigatorV2, runTvCardwellRsiNavigatorV3, runTvCardwellRsiNavigatorV4, runTvCardwellRsiNavigatorV5, runTvKamaMomentumV1, runChannelReversion } from "./tvStrategies";
import { runEnsembleV1 } from "./ensemble";

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
  /**
   * 自撮合标记：run() 已在内部完成「次日开盘」撮合（返回的是执行后的净值/成交），
   * 调用方不应再套一层 executeTradesNextOpen。多策略并行决策（Ensemble）走目标
   * 仓位序列撮合 executeTargetPositionNextOpen，故设为 true；普通信号策略缺省 false。
   */
  selfMatched?: boolean;
}

/**
 * 统一把某策略执行成回测结果：普通信号策略走 executeTradesNextOpen（信号→次日开盘
 * 撮合）；自撮合策略（Ensemble）已在 run() 内撮合，直接返回其结果，避免二次撮合。
 */
export function executeStrategy(strategy: Strategy, candles: Candle[], ctx: StrategyContext): BacktestResult {
  const raw = strategy.run(candles, ctx);
  return strategy.selfMatched ? raw : executeTradesNextOpen(candles, raw);
}

/** 策略回测产物（元信息 + 结果），用于接口返回与前端渲染。 */
export interface StrategyBacktest {
  meta: StrategyMeta;
  result: BacktestResult;
}

/** 默认策略 id（页面首次加载与胜率口径采用此策略）。 */
export const DEFAULT_STRATEGY_ID = "chokepoint-momentum-v7";

/**
 * 已登记策略。顺序即 UI 下拉顺序（默认策略置顶）。
 */
const STRATEGIES: Strategy[] = [
  {
    meta: {
      id: "chokepoint-momentum-v8",
      name: "Serenity 瓶颈动量突破",
      version: "8.0",
      description:
        "v7 的「最优停止 / 秘书问题」出场版（入场信号与 v4~v7 完全一致，七类买点 + MA60 闸门，可对照）。核心思路：股价能涨到多高永远未知，不该「猜顶」。故放弃 v7 固定 +25% 目标位的分批止盈，改为高水位新高阶梯减仓：①观察期——峰值先站上成本 +15% 建立基准高（对应秘书问题 1/e 观察阶段，不在起步期乱减）；②逐级落袋——之后价格每创约 +10% 新高就减约 1/5 仓位，不预测最高点、逐档兑现升势利润；③剩余底仓继续随 6×ATR 宽跟踪奔跑、回撤触线再清。保留 v7 的 +8% 前移止盈（首档锁利）、箱体高抛、结构+时间止损、筹码支撑 / 天量滞涨。适合「会走出连续新高」的趋势股，逼近顶部逐步减而非一次拍光。",
      tags: ["momentum", "reversal", "pattern", "trend-filter", "atr-stop", "scale-out", "regime-adaptive", "optimal-stopping"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV8(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v7",
      name: "Serenity 瓶颈动量突破",
      version: "7.0",
      description:
        "v6 的 regime 自适应出场版（入场信号与 v4/v5/v6 完全一致，七类买点 + MA60 闸门，可对照）。针对 v6 在箱体震荡票上「只买不卖、坐电梯回吐」的痛点，升级出场逻辑：①regime 判定——用 ADX(14) + MA60 斜率区分趋势 / 箱体；②箱体高抛（核心修复）——确认箱体（ADX<22 且 MA60 走平）时价升至区间上沿（rangePos≥0.82）且当根滞涨/收阴即均值回归清仓，让箱体里终于有卖点；③前移止盈阶梯——浮盈 +8% 先减约 1/3 落袋（箱体反弹也能兑现），保留 v6 的 +25% 再减 + 6×ATR 宽 runner；④结构+时间止损——买入后迟迟未站上成本 +6%（跟踪未激活）、持仓超 15 根又跌破 MA20，判定突破失败砍掉死钱。趋势行情下 ADX 走高则不判为箱体、仍按 v6 让利润奔跑，是「趋势照旧奔跑、箱体主动高抛」的自适应版。其余风控（筹码支撑止损 / 天量滞涨）与 v6 一致。",
      tags: ["momentum", "reversal", "pattern", "trend-filter", "atr-stop", "scale-out", "regime-adaptive", "default"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV7(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v6",
      name: "Serenity 瓶颈动量突破",
      version: "6.0",
      description:
        "v5 的分批止盈 + 宽 runner 版（仓位管理升级，入场信号与 v4/v5 完全一致）。源自「策略只赚 +5%、个股同期涨 +66%」的真实疑问：趋势跟随带止损会在大牛股上被洗/踏空回吐。①分批止盈（逐步卖出 / 留 runner，实测有效）——浮盈 +25% 先止盈 1/4 落袋锁利，剩余 3/4 底仓改挂更宽的 6.0×ATR 跟踪止损（远宽于 v5 收紧档 3.0×）继续奔跑吃趋势尾段；②金字塔加仓（逐步买入，实测证伪、默认关闭）——加仓抬高均价、震荡票被洗，净收益与捕获率反降，代码保留为可调项但默认整仓建仓不加仓；③跌破筹码支撑 / 高位天量滞涨清掉全部剩余仓位。15 只池真实数据 A/B：平均每股收益、正收益股数、对买入持有捕获率（81%→109%）、组合复利净值（10.4→26.6）全面优于 v5。诚实权衡：分批止盈在极端单边里仍会少赚卖飞的那 1/4。",
      tags: ["momentum", "reversal", "pattern", "trend-filter", "atr-stop", "scale-out"],
    },
    run: (candles, ctx) => runChokepointMomentumBacktestV6(candles, ctx.chokepointScore, { code: ctx.code }),
  },
  {
    meta: {
      id: "chokepoint-momentum-v5",
      name: "Serenity 瓶颈动量突破",
      version: "5.0",
      description:
        "v4 的 ATR 自适应止损版：入场口径与 v4 完全一致（七类买点 + MA60 中期趋势闸门），并沿用 v4 跟踪止损结构（浮盈 +6% 启动、分段收紧、筹码支撑止损、天量滞涨）。唯一升级：把 v4 的固定回撤百分比（15%/9%）替换为随个股真实波动自适应的回撤距离——跟踪回撤% = clamp(mult×ATR(14)%, 7%, 25%)，mult 随浮盈分段收紧（未到 +20% 用 5.0×、≥ +20% 收紧到 3.0×）。对 3% ATR 的中等波动票回撤≈15%/9%，与 v4 等价；高波动票自动给更宽止损（少被洗）、低波动票自动收紧（少回吐）。因仅改止损距离不改启动条件，换手率与 v4 同量级、可对照。",
      tags: ["momentum", "reversal", "pattern", "trend-filter", "atr-stop"],
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
      id: "tv-supertrend-adaptive-v1",
      name: "Modern Adaptive Supertrend [GBB] 复刻",
      version: "1.0",
      description:
        "复刻 TradingView 社区脚本 Modern Adaptive Supertrend [GBB]（作者 goodBadBitcoin）。经典 Supertrend(ATR10×3) 之上叠两层现代化改造：①Commit filter 迟滞过滤——收盘越线需达 0.5×ATR 并保持 1 根才确认翻转（原作实测假翻转减少约 60%），治「碰线即翻」的来回打脸；②regime 自适应带宽——用效率比(ER)近 500 根分位判趋势/震荡，趋势(增益 0.8)与震荡(增益 0.5)均加宽抗洗、仅转折处收紧让线灵敏，用市场自身近况而非固定阈值。作者承认无效的自适应周期默认关、未实现。回测为纯多头：Supertrend 翻多入场、翻空离场（翻空本身即止损，不另加 ATR 止损），含双边手续费。诚实口径（沿用原作）：这是趋势过滤器而非择时系统，裸方向胜率≈48%，价值在更干净的趋势读数与更低回撤而非抄顶摸底。对应 /chart「策略图层」可叠加方向线/翻多翻空标记/regime 读数。",
      tags: ["tradingview", "supertrend", "trend-follow", "adaptive", "regime-adaptive", "atr-stop", "reproduction"],
    },
    run: (candles) => runTvSupertrendAdaptiveV1(candles),
  },
  {
    meta: {
      id: "tv-cardwell-rsi-navigator-v1",
      name: "Cardwell RSI Trade Navigator [MarkitTick] 复刻",
      version: "1.0",
      description:
        "复刻 TradingView 社区脚本 Cardwell RSI Trade Navigator（作者 MarkitTick）——一个把交易计划可视化的导航器。用 Andrew Cardwell 的 RSI 方法定方向/择时：RSI(14) 上穿中线 50 转多、下穿转空（两次翻转最少间隔 2 根降噪）。出信号即以入场价为锚投影交易计划——止损取 1.5×ATR(14)，盈利目标按风险 R=|入场−止损| 的 1/2/3 倍投影 TP1/TP2/TP3。回测为纯多头：上穿 50 入场、下穿 50 离场，叠加 1.5×ATR 跟踪止损保护，含双边手续费。诚实口径：Cardwell 原脚本精确的入场/止损/目标公式并非公开，本复刻是「同款 UI/UX + 一套合理可解释的 RSI/R 倍数交易计划」，数字不会与 TV 逐位相同。对应 /chart「策略图层」可叠加风险带(红)/盈利带(绿)矩形色块 + ×SL/►Entry/●TP1/★TP2/▲TP3 右轴标签。",
      tags: ["tradingview", "rsi", "cardwell", "trade-plan", "risk-reward", "r-multiple", "reproduction"],
    },
    run: (candles) => runTvCardwellRsiNavigatorV1(candles),
  },
  {
    meta: {
      id: "tv-cardwell-rsi-navigator-v2",
      name: "Cardwell RSI Trade Navigator 趋势延续版 V2",
      version: "2.0",
      description:
        "Cardwell RSI Trade Navigator 的趋势延续改进版，针对 V1「强趋势被跟踪止损洗出后再也回不来」的痛点。V1 唯一入场钥匙是 RSI(14) 全新上穿中线 50，被 1.5×ATR 跟踪止损打出来时 RSI 常仍在多头区(>50)，要再入场必须 RSI 先跌回 ≤50 再上穿；主升浪里 RSI 长期 >50，钥匙永远插不上，于是空仓走完整段拉升。V2「只增不改」：完整保留 V1 的入场/离场/止损口径，额外增加一条「趋势延续再入场」通道——空仓且趋势未破（收盘≥MA20、RSI>50 且上行）时，KDJ 金叉 或 MACD 柱翻红即顺势重新建仓（量能放大作附注），把主升浪里的「柱子翻红/KDJ金叉」显式纳为补充买点。离场与 V1 一致（RSI 下穿 50 或 ATR 自适应跟踪止损）。纯多头、含双边手续费。诚实口径：再入场是趋势跟随式的延续确认而非抄底，会增加交易笔数、抓回 V1 错过的主升浪段落，震荡市也可能多出几笔由跟踪止损兜底的小亏损。",
      tags: ["tradingview", "rsi", "cardwell", "trade-plan", "trend-continuation", "re-entry", "kdj", "macd", "reproduction"],
    },
    run: (candles) => runTvCardwellRsiNavigatorV2(candles),
  },
  {
    meta: {
      id: "tv-cardwell-rsi-navigator-v3",
      name: "Cardwell RSI Trade Navigator 趋势捕捉版 V3",
      version: "3.0",
      description:
        "在 V1/V2 基础上重构入场与持有，目标「更早抓到刚启动的上涨、并拿住主升浪大部分利润」。痛点：V1/V2 主要入场钥匙是 RSI 上穿 50（偏晚），且 1.5×ATR 跟踪止损过紧、强趋势里频繁被洗出（一篮子 A 股 360 根日线回测：V2 平均 +36%、约 31.5 笔/年，强趋势只吃到一小段）。V3 两条主线：①更早入场——Cardwell「RSI 区间法则 + 正向反转」：A) 正向反转/底背离（价创近 20 根新低但 RSI 抬升 ≥5、处 35~58 且收复 MA10）抓跌势衰竭反转；B) 区间切换上冲（RSI 上穿 55 进牛市区间 40~80 且站上 MA20）确认启动；均要求 close>MA60、RSI<70 不追高、离场后冷却 8 根。②拿得住——关闭内置 1.5×ATR 止损，改用吊灯止损(自高点回撤 3×ATR)+RSI 跌破 38(牛市区间下沿失守而非跌破 50)+连破 MA30 三道更宽顺势离场。回测 V3 平均约 +85%、仅约 11 笔/年，强趋势股显著优于 V1/V2（601869 +383%→+789%）。诚实口径：纯多头趋势跟随、非预测；参数择优有过拟合风险；震荡/下跌股仍有小亏损但笔数与回撤远小于 V2；普涨行情整体仍可能跑输买入持有。纯多头、含双边手续费。对应 /chart「策略图层」可叠加吊灯交易计划色块 + 买卖翻转标记。",
      tags: ["tradingview", "rsi", "cardwell", "trade-plan", "positive-reversal", "rsi-range", "chandelier-exit", "trend-capture", "reproduction"],
    },
    run: (candles) => runTvCardwellRsiNavigatorV3(candles),
  },
  {
    meta: {
      id: "tv-cardwell-rsi-navigator-v4",
      name: "Cardwell RSI Trade Navigator 拐点先行版 V4",
      version: "4.0",
      description:
        "针对 V3 实测硬伤重构入场与 TP/SL。V3 痛点：①固定 8 根冷却把急跌后的 V 型反包一刀切挡住（300024 6/12 离场后被锁死、错过 6/15 起涨，直到 6/29 +18.9% 巨阳才上穿 55 进场）；②无反追高距离闸门，6/29 收盘已比 MA20 高 +12% 仍买在巨阳顶；③TP/SL 的 R 单位用当根 3×ATR，单日巨阳撑大 ATR 后 SL 过宽、TP3 远到 +56% 几乎不可达。V4 默认三条改造：①智能冷却——默认仅 3 根，且收盘重新站上「离场那根高点」且 RSI 收复 50 即强反包豁免、当根可再进（300024 因此 6/15 @16.96 即再入场，早于 V3 的 6/29 @18.10）；②反追高距离闸门——收盘离 MA20 超 +8% 一律不进（挡掉 6/29 +12% 偏离的巨阳）；③稳定 R 单位 TP/SL——R=近 20 根 ATR 中位数(抗单日尖刺)，SL=入场−1.8R 与近 6 根 swing low 取更紧者，TP1/2/3=入场+1/1.5/2.5R 更易达。入场触发默认沿用 V3「区间切换上冲(RSI 上穿 55+站上 MA20)+正向反转」，另内置可选触发「动能启动(RSI 上穿 50+放量)/回踩起涨」（默认关，实测增噪降胜率）。离场沿用 V3 三道(吊灯 3×ATR / RSI 跌破 38 / 连 2 根破 MA30)。一篮子 12 只 A 股 360 根日线回测：V4 平均约 +93%(V3 +81%)、回撤约 −23%(V3 −21%)、胜率约 36%(V3 39%)——以更快的趋势再入场换更高总收益，但高波动票(如 300024 −32% vs V3 −13%)更易被洗：6/15 早入场实为假突破、6/26 被结构止损 −10%，6/29 才真爆发。诚实口径：纯多头趋势跟随、非预测；参数择优有过拟合风险。纯多头、含双边手续费。对应 /chart「策略图层」可叠加稳定 R 交易计划色块 + 买卖翻转标记。",
      tags: ["tradingview", "rsi", "cardwell", "trade-plan", "early-entry", "momentum-thrust", "pullback", "stable-atr", "chandelier-exit", "reproduction"],
    },
    run: (candles) => runTvCardwellRsiNavigatorV4(candles),
  },
  {
    meta: {
      id: "tv-cardwell-rsi-navigator-v5",
      name: "Cardwell RSI Trade Navigator 分批止盈版 V5",
      version: "5.0",
      description:
        "在 V4 之上做 Tier1+Tier2 优化（基于 87 笔 V4 交易诊断：赢家/输家入场时几乎不可区分，继续加入场过滤会滤掉大赢家、降低每笔期望；真正杠杆在出场管理与趋势判断）。Tier1（仓位/出场）：①分批止盈+保本——TP1(+1R) 卖 1/3 并把止损上移到成本(立于不败)、TP2(+1.5R) 再卖 1/3、剩 1/3 用吊灯(3×ATR)跟吃主升尾段；②TP1 前用更紧的初始止损——开仓即 3×ATR 吊灯太宽(输家平均 −3.7%)，改为 TP1 前用「入场−1.8R 与近 6 根 swing low 取更紧者」的稳定 R 计划止损，命中 TP1 后才放宽到吊灯。Tier2（趋势判断）：③ADX(14)≥20 趋势闸门——没趋势就不做，避开 V4 在震荡/阴跌票里反复换手挨刀；④再入场质量闸门——只在「前一笔非亏损」时才允许 V4 智能冷却窗口内的强反包豁免，杜绝「刚止损就更高价追回」的亏损。入场触发与稳定 R 计划完全沿用 V4。设计意图：用「分批落袋+保本+紧止损」压低 V4 −23% 的平均回撤、让更多笔以绿色收尾，代价是封顶极端单边里卖飞的 2/3。诚实口径：纯多头趋势跟随、非预测；参数择优有过拟合风险；分批止盈在极端连续单边里会少赚。纯多头、含双边手续费、次日开盘撮合。",
      tags: ["tradingview", "rsi", "cardwell", "trade-plan", "scale-out", "breakeven-stop", "adx-gate", "stable-atr", "chandelier-exit", "reproduction"],
    },
    run: (candles) => runTvCardwellRsiNavigatorV5(candles),
  },
  {
    meta: {
      id: "tv-kama-momentum-v1",
      name: "Kaufman Moving Average Adaptive Strategy [MKB] 复刻",
      version: "1.0",
      description:
        "复刻 TradingView 社区脚本 KAMA Momentum Strategy（作者 muratkbesiroglu/MKB）。基于 Kaufman 自适应均线(KAMA) 的趋势跟随动量策略：KAMA 用效率比 ER 在快(2)/慢(30) 平滑常数间插值——趋势强时贴快线灵敏跟随、震荡时贴慢线迟钝抗洗。入场=收盘上穿「KAMA + 0.5×标准差(20)」上带（用波动率带抬高门槛、过滤震荡市里 KAMA 附近的弱信号与噪声）；出场=收盘跌破 KAMA，纪律化离场，以 KAMA 作主趋势参考。建议参数 KAMA 长度 21 / 标准差长度 20 / 倍数 0.5（默认采用）。回测纯多头、单仓位不加仓、含双边手续费，忠实原版不另叠加 ATR 止损（出场只认跌破 KAMA）。诚实口径：Pine 内 KAMA 首根种子细节不公开，本复刻在首个可算根用前一根收盘播种（差异数根内收敛），标准差用总体口径对齐 Pine ta.stdev 默认；原作面向加密日线、A 股主板日线同样适用，入场带=动量确认而非择时预测，震荡市仍会有「突破后跌回」的小亏损。对应 /chart「策略图层」可叠加 KAMA 线/翻多翻空标记/regime 读数。",
      tags: ["tradingview", "kama", "kaufman", "adaptive-ma", "momentum", "trend-follow", "stdev-filter", "reproduction"],
    },
    run: (candles) => runTvKamaMomentumV1(candles),
  },
  {
    meta: {
      id: "channel-reversion-v1",
      name: "回归通道均值回归 V1",
      version: "1.0",
      description:
        "与 Cardwell V3/V4/V5（RSI 趋势跟随）互补的均值回归策略，专抓趋势系统结构性错过的「回踩回归通道下轨支撑低吸」买点。通道口径与 /chart 粉色回归通道、/scanner 展开评估完全一致（最近 60 根收盘价线性回归中轨 ± 1.5σ 上下轨）。入场：仅在上升/横盘通道（拒绝明确下降通道接刀）中，价回踩下轨支撑企稳收阳、RSI 拐头、处通道下半区时低吸。出场（分批）：触中轨卖 1/2 并保本、触上轨剩余全部止盈；跌破下轨逾 3% 破位止损、超 40 根未兼现则超时离场。诚实口径：纯多头、非预测；“低吸=接刀”风险靠「拒绝下降通道 + 破位止损 + 保本」控制；参数择优有过拟合风险；强单边趋势里会过早止盈、明显跑输趋势跟随。含双边手续费、次日开盘撮合。对应 /chart「策略图层」可叠加下轨交易计划色块 + 买卖翻转标记。",
      tags: ["mean-reversion", "regression-channel", "support-bounce", "scale-out", "breakeven-stop", "complementary", "reproduction"],
    },
    run: (candles) => runChannelReversion(candles),
  },
  {
    meta: {
      id: "ensemble-v1",
      name: "多策略并行决策 V1（Ensemble）",
      version: "1.0",
      description:
        "架构 B「加权投票 + 连续仓位聚合」的元策略：5 个成员并行——趋势核心 Cardwell V4/V3 + Chokepoint 动量 V5，均值回归卫星 回归通道 V1 + RSI 超卖回归 V1。各成员逐根敞口按权重加权平均，再由「方向感知 regime」（ADX 定趋势强弱 + 回归通道斜率定方向）调制：上升趋势期抬升趋势成员、震荡/下行期抬升均值回归成员，得到 0–95% 的连续目标仓位，走 executeTargetPositionNextOpen 按次日开盘再平衡撮合（防抖阈值 1% 权益）。目的不是最高收益，而是压回撤、提跨标的一致性——12 只篮子回测：收益 +63%、最大回撤 −16.6%（优于全部趋势核心单策略）、盈利股占比 50%、夏普 0.15，满足设计验收 §4.4。诚实口径：纯多头、非预测；不跑赢买入持有（+163.7%，单边强牛里任何择时都牺牲尾部收益）；成员/权重经篮子择优有过拟合风险；连续仓位下「胜率」口径参考意义有限。默认 Pro 策略维持 V7 不变，本策略为可选元策略。",
      tags: ["ensemble", "multi-strategy", "regime-adaptive", "position-sizing", "risk-parity", "complementary", "meta-strategy"],
    },
    selfMatched: true,
    run: (candles, ctx) => runEnsembleV1(candles, ctx),
  },
  {
    meta: {
      id: "confluence-v1",
      name: "多指标共振（旗舰·指标组合）",
      version: "1.0",
      description:
        "对标 TradingView「七个值得尝试的指标」的旗舰组合策略，直接回应原文反复强调的「任何单一指标都应与其他指标结合使用」。复用本项目 computeResonance 多指标共振扫描（MACD 金叉 / RSI 超卖修复 / KDJ 低位金叉 / 触布林下轨反抽 / 放量上涨），要求 ≥3 个指标同向共振且 MA60 趋势闸门通过才入场——把原文 7 指标里的 5 个（MACD/RSI/随机指标/布林/成交量）拧成一股绳，单指标噪声被多指标一致性显著抑制。离场：≥2 指标看跌共振翻空，或 ATR(14) 自适应跟踪止损（回撤距离随个股波动伸缩，不猜顶）。纯多头、含双边手续费。",
      tags: ["indicator", "confluence", "multi-indicator", "trend-filter", "atr-stop", "tradingview"],
    },
    run: (candles) => runConfluenceV1(candles),
  },
  {
    meta: {
      id: "rsi-reversion-v1",
      name: "RSI 超卖回归（趋势过滤）",
      version: "1.0",
      description:
        "对标原文「相对强弱指标 RSI」。比裸口径「RSI<30 即买」更优：A 股单边下跌里 RSI 会长期钝化在 30 以下、裸抄接飞刀，故①只认 RSI 上穿 30 的修复瞬间（动量真回头）；②叠加 MA60 趋势闸门，仅在「价在 MA60 上或 MA60 近 20 日不下行」时入场，过滤确认下行段；③离场 = RSI 高位回落破 70 落袋 / 跌破 MA20 认错 / ATR(14) 自适应跟踪止损。纯多头、含双边手续费。",
      tags: ["indicator", "rsi", "mean-reversion", "trend-filter", "atr-stop", "tradingview"],
    },
    run: (candles) => runRsiReversionV1(candles),
  },
  {
    meta: {
      id: "macd-zero-trend-v1",
      name: "MACD 零轴上金叉趋势跟随",
      version: "1.0",
      description:
        "对标原文「移动平均线收敛/发散 MACD」。比裸口径「一金叉就买」更优：震荡市里 DIF/DEA 在零轴下方反复缠绕、假金叉频发，故①只认零轴之上（DIF>0，已处多头能量区）的金叉；②叠加 MA60 上行闸门 + 放量确认（5 日量能>20 日 1.2 倍）；③离场 = MACD 死叉 / 跌破 MA20 / ATR(14) 自适应跟踪止损。纯多头、含双边手续费。",
      tags: ["indicator", "macd", "trend", "trend-filter", "atr-stop", "tradingview"],
    },
    run: (candles) => runMacdZeroTrendV1(candles),
  },
  {
    meta: {
      id: "boll-squeeze-v1",
      name: "布林挤压突破",
      version: "1.0",
      description:
        "对标原文「布林带」。比裸口径「触下轨买/触上轨卖」（均值回归口径，在单边趋势里触下轨抄底会被走轨反复埋）更优：反向取用布林带的波动率属性做动量——①先识别挤压（带宽处于近 100 日低 40 分位，波动收敛=变盘前夜）；②挤压后收盘放量向上突破上轨=选择方向向上，追突破；③跌破中轨(MA20) 离场 + ATR(14) 自适应跟踪止损。与本项目「网格·均值回归」（箱体低吸高抛）形成趋势/震荡互补而非重复。纯多头、含双边手续费。",
      tags: ["indicator", "bollinger", "volatility", "breakout", "atr-stop", "tradingview"],
    },
    run: (candles) => runBollSqueezeV1(candles),
  },
  {
    meta: {
      id: "fib-kdj-pullback-v1",
      name: "斐波那契回踩 + KDJ 低位金叉",
      version: "1.0",
      description:
        "一策略同时覆盖原文「斐波那契回撤」与「随机指标(KDJ)」两项。比原文「画回撤线肉眼找支撑」（无趋势前提、无入场触发）更优：①只在上升趋势中用（MA60 近 20 日上行），顺势回踩才有意义；②自动取近 40 日波段低→高算 38.2%~61.8% 黄金回撤区；③价回踩进该区且 KDJ 低位金叉（K 上穿 D 且 D<45）企稳才买，用随机指标做斐波那契支撑的二次确认；④目标看回波段高点，跌破 61.8% 认结构破位止损 + KDJ 高位死叉止盈 + ATR(14) 自适应跟踪止损。纯多头、含双边手续费。",
      tags: ["indicator", "fibonacci", "kdj", "stochastic", "pullback", "trend-filter", "atr-stop", "tradingview"],
    },
    run: (candles) => runFibKdjPullbackV1(candles),
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

/**
 * 跑全部已登记策略，返回 {元信息, 结果} 数组（顺序同 STRATEGIES）。
 * 统一「次日开盘成交（T+1 open）」口径：普通信号策略走 executeTradesNextOpen，
 * 自撮合元策略（Ensemble）已在 run() 内按目标仓位撮合，直接取其结果（见 executeStrategy）。
 */
export function runAllStrategies(candles: Candle[], ctx: StrategyContext): StrategyBacktest[] {
  return STRATEGIES.map((s) => ({ meta: s.meta, result: executeStrategy(s, candles, ctx) }));
}

/** 从策略产物数组中取默认策略的结果（找不到则取第一个）。 */
export function pickDefaultResult(list: StrategyBacktest[]): BacktestResult | undefined {
  return list.find((s) => s.meta.id === DEFAULT_STRATEGY_ID)?.result ?? list[0]?.result;
}
