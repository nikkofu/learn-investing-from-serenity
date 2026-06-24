import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT } from "@/lib/sources";
import { evaluatePair } from "@/lib/pairTrading";
import { robustnessReport } from "@/lib/robustness";
import { getUniverseConfig, isExcluded } from "@/lib/universe";
import { NFA } from "@/lib/disclaimers";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RobustnessBody {
  /** 配对两腿 6 位代码。 */
  a?: string;
  b?: string;
  limit?: number;
  exitZ?: number;
  stopZ?: number;
  feeBps?: number;
}

/**
 * POST /api/arb/robustness
 * 对单个协整配对做「过拟合体检」：参数高原热图 + walk-forward 衰减曲线 + 综合稳健分。
 * 入参 {a,b} 为两腿代码，复用既有 K 线源与协整估计，纯统计信号非投资建议。
 */
export async function POST(req: Request) {
  let body: RobustnessBody = {};
  try {
    body = (await req.json()) as RobustnessBody;
  } catch {
    /* 允许空 body */
  }
  const a = (body.a ?? "").trim();
  const b = (body.b ?? "").trim();
  if (!/^\d{6}$/.test(a) || !/^\d{6}$/.test(b) || a === b) {
    return NextResponse.json({ error: "需提供两只不同的 6 位代码 a、b" }, { status: 400 });
  }
  const cfg = getUniverseConfig();
  if (isExcluded(a, undefined, cfg) || isExcluded(b, undefined, cfg)) {
    return NextResponse.json({ error: "配对含已排除标的（按主板纯净化口径）" }, { status: 400 });
  }

  try {
    const limit = Math.max(250, Math.min(HISTORY_LIMIT, body.limit ?? 500));
    const km = await getKlinesBatch([a, b], limit, "baidu-first");
    const filt = (code: string): Candle[] =>
      (km.get(code)?.candles ?? []).filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);
    const aCandles = filt(a);
    const bCandles = filt(b);
    if (aCandles.length < 250 || bCandles.length < 250) {
      return NextResponse.json({ error: "可用 K 线不足（每腿需 ≥250 根）" }, { status: 502 });
    }
    const pair = evaluatePair(a, b, aCandles, bCandles, { minOverlap: 120 });
    if (!pair) {
      return NextResponse.json({ error: "两腿重叠样本不足，无法估计协整" }, { status: 502 });
    }
    const report = robustnessReport(pair, aCandles, bCandles, {
      exitZ: body.exitZ ?? 0.5,
      stopZ: body.stopZ ?? 3.5,
      feeBps: body.feeBps ?? 30,
    });
    return NextResponse.json({
      report,
      asOf: aCandles[aCandles.length - 1]?.date ?? null,
      note: "参数高原=入场阈×z窗口两维全样本扫描；walk-forward=锚定式前推（IS选优→OOS验证）。" + NFA,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `稳健性体检失败: ${msg}` }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    defaults: { limit: 500, exitZ: 0.5, stopZ: 3.5, feeBps: 30 },
    note: "POST {a,b} 对单配对做过拟合体检（参数高原热图 + walk-forward 衰减 + 稳健分）。",
  });
}
