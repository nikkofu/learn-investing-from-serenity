import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT } from "@/lib/sources";
import { scanArbRadar } from "@/lib/pairTrading";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ArbRadarBody {
  /** 候选股票池：6 位代码数组；两两组合做协整扫描，仅报当前开口机会。 */
  codes?: string[];
  limit?: number;
  /** 协整筛选最低相关性。 */
  minCorrelation?: number;
  /** 入场偏离阈（|z|≥entryZ 才视为开口机会）。 */
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  feeBps?: number;
  maxSignals?: number;
}

/**
 * POST /api/arb/radar
 * 统计套利雷达：候选池两两做 Engle-Granger 协整检验，挑出「当前价差已开口」
 * （|z|≥入场阈）的配对机会，按 |z|×协整强度排序，附方向/进出止损/预计回归天数/估算净收益。
 */
export async function POST(req: Request) {
  let body: ArbRadarBody = {};
  try {
    body = (await req.json()) as ArbRadarBody;
  } catch {
    /* 允许空 body */
  }
  const codes = Array.from(
    new Set((body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c))),
  );
  if (codes.length < 3) {
    return NextResponse.json({ error: "套利雷达至少需要 3 只股票，建议同板块 ≥8 只" }, { status: 400 });
  }

  try {
    const limit = Math.max(250, Math.min(HISTORY_LIMIT, body.limit ?? 500));
    const km = await getKlinesBatch(codes, limit, "baidu-first");
    const candles: Record<string, Candle[]> = {};
    for (const code of codes) {
      const cs = (km.get(code)?.candles ?? []).filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);
      if (cs.length >= 250) candles[code] = cs;
    }
    if (Object.keys(candles).length < 3) {
      return NextResponse.json({ error: "可用 K 线数据不足：需 ≥3 只且每只 ≥250 根" }, { status: 502 });
    }
    const result = scanArbRadar(candles, {
      find: { minCorrelation: body.minCorrelation ?? 0.7, minHalfLife: 2, maxHalfLife: 60 },
      trade: {
        entryZ: body.entryZ ?? 2.0,
        exitZ: body.exitZ ?? 0.5,
        stopZ: body.stopZ ?? 3.5,
        feeBps: body.feeBps ?? 30,
      },
      maxSignals: body.maxSignals ?? 50,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `套利雷达扫描失败: ${msg}` }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    defaults: { limit: 500, minCorrelation: 0.7, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, feeBps: 30, maxSignals: 50 },
    note: "POST {codes:[...]} 在候选池内全两两做 Engle-Granger 协整检验，仅返回当前价差已开口（|z|≥entryZ）的配对机会，按 |z|×协整强度排序。每个机会附方向（做多/做空价差）、进出止损 z 阈、半衰期推算的预计回归天数、双边成本后估算净收益。A 股融券受限，纯多空难落地，请优先两融/ETF 可对冲品种，结果为价差口径研究信号。",
  });
}
