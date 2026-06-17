import { NextResponse } from "next/server";
import { getKlineSafe, getQuote, deriveStats } from "@/lib/market";
import {
  calculateChipDistribution,
  runTraditionalMaBacktest,
  runChokepointMomentumBacktest,
  analyzeTechnicalPatterns,
  generatePriceProjection,
} from "@/lib/quant";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim();
    const period = searchParams.get("period")?.trim() || "1D";

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请提供 6 位有效的股票代码" }, { status: 400 });
    }

    let klt = 101;
    if (period === "1W") klt = 102;
    else if (period === "1M") klt = 103;

    // 并发拉取腾讯和东财基础数据
    const [quote, candles] = await Promise.all([getQuote(code), getKlineSafe(code, 360, klt)]);
    const stats = deriveStats(candles);

    // 纯数学指标计算 (无模型延迟，毫秒级计算完毕)
    const chips = calculateChipDistribution(candles, quote.price);
    const traditionalBacktest = runTraditionalMaBacktest(candles);
    const chokepointBacktest = runChokepointMomentumBacktest(candles, 70); // 默认使用中性分数 70 进行初筛回测
    const technical = analyzeTechnicalPatterns(candles, quote.price, chips);
    const projections = generatePriceProjection(candles, 70);

    return NextResponse.json({
      quote,
      stats,
      quant: {
        chips,
        backtest: chokepointBacktest,
        backtests: {
          traditional: traditionalBacktest,
          chokepoint: chokepointBacktest,
        },
        technical,
        candles,
        projections,
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
