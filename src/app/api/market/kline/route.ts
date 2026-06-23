import { NextResponse } from "next/server";
import { getIntradayKline, type FqMode } from "@/lib/sources";

export const dynamic = "force-dynamic";

const MINUTE_KLT: Record<string, 5 | 15 | 30 | 60> = { "5m": 5, "15m": 15, "30m": 30, "60m": 60 };

// 分钟级分时 K 线（5/15/30/60m）。专供 Pro 画布的日内多周期切换，按需即取，不入日线落盘库。
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim();
    const period = searchParams.get("period")?.trim() || "5m";
    const fq: FqMode = searchParams.get("fq")?.trim() === "hfq" ? "hfq" : "qfq";

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请提供 6 位有效的股票代码" }, { status: 400 });
    }
    const klt = MINUTE_KLT[period];
    if (!klt) {
      return NextResponse.json({ error: `不支持的分时周期: ${period}` }, { status: 400 });
    }

    const candles = await getIntradayKline(code, 480, klt, fq);
    return NextResponse.json({ candles, period, fq });
  } catch (error) {
    console.error("分时 K 线获取失败:", error);
    return NextResponse.json(
      { error: `分时 K 线获取失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
