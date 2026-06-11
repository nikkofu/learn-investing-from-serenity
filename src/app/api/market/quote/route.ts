import { NextResponse } from "next/server";
import { deriveStats, getKlineSafe, getQuote } from "@/lib/market";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }
  try {
    const [quote, candles] = await Promise.all([getQuote(code), getKlineSafe(code, 120)]);
    return NextResponse.json({ quote, candles, stats: deriveStats(candles) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "行情获取失败" },
      { status: 502 }
    );
  }
}
