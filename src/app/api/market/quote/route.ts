import { NextResponse } from "next/server";
import { deriveStats, getKlineSafe, getQuote } from "@/lib/market";
import { calculateChipDistribution, runSerenityBacktest, analyzeTechnicalPatterns } from "@/lib/quant";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }
  try {
    const [quote, candles] = await Promise.all([getQuote(code), getKlineSafe(code, 120)]);
    const stats = deriveStats(candles);
    const chips = calculateChipDistribution(candles, quote.price);
    const backtest = runSerenityBacktest(candles);
    const technical = analyzeTechnicalPatterns(candles, quote.price, chips);
    return NextResponse.json({ 
      quote, 
      candles, 
      stats, 
      quant: { chips, backtest, technical, candles } 
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "行情获取失败" },
      { status: 502 }
    );
  }
}
