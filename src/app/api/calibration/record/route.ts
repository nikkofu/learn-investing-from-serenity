import { NextResponse } from "next/server";
import { resolvePrediction, getCalibrationSummary } from "@/lib/calibration";

export const dynamic = "force-dynamic";

/**
 * B3 校准闭环：事后回填某次预测的真实涨跌，结算命中并刷新 Brier/可靠性。
 * POST { code, date?, actualReturnPct, horizonDays?, hit? }
 */
export async function POST(req: Request) {
  let body: { code?: string; date?: string; actualReturnPct?: number; horizonDays?: number; hit?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  const code = body.code?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }
  if (typeof body.actualReturnPct !== "number" || !Number.isFinite(body.actualReturnPct)) {
    return NextResponse.json({ error: "请提供 actualReturnPct（数值，实际前瞻收益 %）" }, { status: 400 });
  }
  const resolved = await resolvePrediction({
    code,
    date: body.date,
    actualReturnPct: body.actualReturnPct,
    horizonDays: body.horizonDays,
    hit: body.hit,
  });
  if (!resolved) {
    return NextResponse.json({ error: "未找到对应的预测记录（请先在 /analyze 分析该股）" }, { status: 404 });
  }
  const summary = await getCalibrationSummary();
  return NextResponse.json({ resolved, summary });
}

/** GET：返回当前校准摘要（Brier、命中率、可靠性曲线）。 */
export async function GET() {
  return NextResponse.json(await getCalibrationSummary());
}
