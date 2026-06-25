import { NextResponse } from "next/server";
import { getKlineFailover, type FqMode } from "@/lib/sources";
import { runTraditionalMaBacktest, executeTradesNextOpen, sanitizeMaParams, type MaStrategyParams } from "@/lib/quant";
import { computePerformanceReport } from "@/lib/performance";

export const dynamic = "force-dynamic";

/**
 * 参数化策略实时回测：前端表单调参后即时重跑「传统均线突破策略」。
 * body: { code, fq?, period?, params?: Partial<MaStrategyParams> }
 * 返回：{ params(已校正), backtest, report }。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      code?: string;
      fq?: string;
      period?: string;
      params?: Partial<MaStrategyParams>;
    };
    const code = body.code?.trim();
    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请提供 6 位有效的股票代码" }, { status: 400 });
    }

    const fq: FqMode = body.fq === "hfq" ? "hfq" : "qfq";
    const period = body.period === "1W" || body.period === "1M" ? body.period : "1D";
    const klt = period === "1W" ? 102 : period === "1M" ? 103 : 101;

    const params = sanitizeMaParams(body.params);
    const candles = await getKlineFailover(code, 360, klt, fq);
    // 成交价统一走「次日开盘成交（T+1 open）」口径。
    const backtest = executeTradesNextOpen(candles, runTraditionalMaBacktest(candles, params));
    const report = computePerformanceReport(backtest.history, backtest.trades);

    return NextResponse.json({ params, backtest, report });
  } catch (error) {
    console.error("参数化回测失败:", error);
    return NextResponse.json(
      { error: `参数化回测失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
