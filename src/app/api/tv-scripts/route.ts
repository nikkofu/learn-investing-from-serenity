import { NextResponse } from "next/server";
import { loadTvStrategies } from "@/lib/tvScripts";

export const dynamic = "force-dynamic";

/**
 * 读取已落盘的 TradingView 热门策略清单（公开元数据，外链参考用）。
 * 同步请走 POST /api/sync { source: "tvStrategies" }。
 */
export async function GET() {
  try {
    const data = await loadTvStrategies();
    if (!data) {
      return NextResponse.json({ source: "tvStrategies", version: 0, syncedAt: null, count: 0, list: [] });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `读取 TV 策略清单失败: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
