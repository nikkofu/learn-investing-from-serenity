import { NextResponse } from "next/server";
import { checkAlerts, inAShareTradingSession } from "@/lib/alertEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/alerts/check
 * 触发一次盘中盯盘评估：拉实时行情+日 K，逐启用规则评估、冷却去重、投递站内/webhook、落盘。
 * 由 /alerts 页客户端定时轮询驱动（无服务端常驻定时器）。
 */
export async function POST() {
  try {
    const result = await checkAlerts();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "评估失败" }, { status: 502 });
  }
}

/** GET：返回交易时段状态（供前端轮询节流提示），不触发评估。 */
export async function GET() {
  return NextResponse.json({
    inTradingSession: inAShareTradingSession(),
    note: "POST 触发一次评估；A 股交易时段：周一~周五 09:30–11:30 / 13:00–15:00（不含节假日）。",
  });
}
