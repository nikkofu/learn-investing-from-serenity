import { NextResponse } from "next/server";
import { computeStrategyLeaderboard } from "@/lib/strategyLeaderboard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/strategies/leaderboard?limit=500&force=1
 * 返回策略市场榜单：代表性篮子上各策略的历史战绩汇总 + 客观评级（带 24h 缓存）。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const force = url.searchParams.get("force") === "1";
  try {
    const board = await computeStrategyLeaderboard({ limit, force });
    return NextResponse.json(board);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `生成策略榜单失败：${msg}` }, { status: 502 });
  }
}
