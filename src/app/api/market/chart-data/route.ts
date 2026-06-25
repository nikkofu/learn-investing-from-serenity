import { NextResponse } from "next/server";
import { getQuoteFailover, deriveStats, getKlineFailover, type FqMode } from "@/lib/sources";
import {
  calculateChipDistribution,
  runTraditionalMaBacktest,
  runChokepointMomentumBacktest,
  executeTradesNextOpen,
  analyzeTechnicalPatterns,
  generatePriceProjection,
} from "@/lib/quant";
import { runAllStrategies, pickDefaultResult, DEFAULT_STRATEGY_ID, getStrategy } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim();
    const period = searchParams.get("period")?.trim() || "1D";
    // 复权口径：qfq=前复权（贴现价，看操作）/ hfq=后复权（长周期真实回测）。图表/筹码/交易标记/回测同口径。
    const fq: FqMode = searchParams.get("fq")?.trim() === "hfq" ? "hfq" : "qfq";

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请提供 6 位有效的股票代码" }, { status: 400 });
    }

    let klt = 101;
    if (period === "1W") klt = 102;
    else if (period === "1M") klt = 103;

    // 并发拉取：腾讯实时行情 + 多源互备 K 线（按 fq 口径，周/月由日 K 重采样）
    const [quote, candles] = await Promise.all([getQuoteFailover(code), getKlineFailover(code, 360, klt, fq)]);
    const stats = deriveStats(candles);

    // 后复权口径下实时价不在 hfq 标度内，统一用所选序列最后一根收盘价作现价基准，保证筹码/技术形态/现价线一致。
    const refPrice = fq === "hfq" ? candles[candles.length - 1]?.close ?? quote.price : quote.price;

    // 纯数学指标计算 (无模型延迟，毫秒级计算完毕)
    const chips = calculateChipDistribution(candles, refPrice);
    // 成交价统一走「次日开盘成交（T+1 open）」口径，与 runAllStrategies 一致。
    const traditionalBacktest = executeTradesNextOpen(candles, runTraditionalMaBacktest(candles));
    const chokepointBacktest = executeTradesNextOpen(candles, runChokepointMomentumBacktest(candles, 70)); // 默认使用中性分数 70 进行初筛回测
    const technical = analyzeTechnicalPatterns(candles, refPrice, chips);
    const projections = generatePriceProjection(candles, 70);

    // 跑全部已登记策略（默认 70 中性瓶颈分），供图表「策略」下拉切换；默认展示与 /strategies 一致的旗舰策略（v7 趋势跟随：ATR 跟踪止盈 + 金字塔加仓，而非旧 v1 的固定 35% 止盈）。
    // 支持 ?strategy=<id>：从策略榜 / 多股票池实测点进时，默认即选中该策略作为买卖引擎。
    const requested = searchParams.get("strategy")?.trim();
    const initialStrategyId = requested && getStrategy(requested) ? requested : DEFAULT_STRATEGY_ID;
    const strategies = runAllStrategies(candles, { chokepointScore: 70, code });
    const defaultBacktest = strategies.find((s) => s.meta.id === initialStrategyId)?.result ?? pickDefaultResult(strategies) ?? chokepointBacktest;

    return NextResponse.json({
      quote,
      stats,
      quant: {
        chips,
        backtest: defaultBacktest,
        strategies,
        defaultStrategyId: initialStrategyId,
        backtests: {
          traditional: traditionalBacktest,
          chokepoint: chokepointBacktest,
        },
        technical,
        candles,
        projections,
        fq,
        refPrice,
      },
    });
  } catch (error) {
    console.error("极速获取图表数据失败:", error);
    return NextResponse.json(
      { error: `获取图表数据失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
