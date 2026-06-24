import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT } from "@/lib/sources";
import { calibrateRadar } from "@/lib/pairTrading";
import { getUniverseConfig, isExcluded } from "@/lib/universe";
import type { Candle } from "@/lib/types";
import { NFA } from "@/lib/disclaimers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ArbCalibrateBody {
  /** 候选股票池：6 位代码数组；两两协整后逐对做全历史信号回测校准。 */
  codes?: string[];
  limit?: number;
  minCorrelation?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  feeBps?: number;
}

/**
 * POST /api/arb/calibrate
 * 套利雷达「信号回测校准」：候选池两两协整，对每个协整配对做全历史信号事后回测，
 * 统计「买入被低估腿」这套单边择时规则历史上的回归率/平均回归天数/单边净收益/胜率/最大逆向 z。
 */
export async function POST(req: Request) {
  let body: ArbCalibrateBody = {};
  try {
    body = (await req.json()) as ArbCalibrateBody;
  } catch {
    /* 允许空 body */
  }
  const rawCodes = Array.from(
    new Set((body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c))),
  );
  const cfg = getUniverseConfig();
  const codes = rawCodes.filter((c) => !isExcluded(c, undefined, cfg));
  if (codes.length < 3) {
    return NextResponse.json(
      {
        error:
          rawCodes.length >= 3
            ? "按当前股票池纯净化口径过滤后，可用主板个股不足 3 只（科创/北交所等已剔除，可在设置页调整）"
            : "信号回测校准至少需要 3 只股票，建议同板块 ≥8 只",
      },
      { status: 400 },
    );
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
    const result = calibrateRadar(candles, {
      find: { minCorrelation: body.minCorrelation ?? 0.7, minHalfLife: 2, maxHalfLife: 60 },
      trade: {
        entryZ: body.entryZ ?? 2.0,
        exitZ: body.exitZ ?? 0.5,
        stopZ: body.stopZ ?? 3.5,
        feeBps: body.feeBps ?? 30,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `信号回测校准失败: ${msg}` }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    defaults: { limit: 500, minCorrelation: 0.7, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, feeBps: 30 },
    note: "POST {codes:[...]} 对候选池（已按股票池纯净化配置剔除科创/北交所/B 股等）内全部协整配对做全历史信号事后回测：每次 |z|≥入场阈开口就买入被低估的那一只，持有至价差回归/止损/超时，统计回归率、平均回归天数、单边净收益、胜率、最大逆向 z。单边收益含市场 β（非中性），协整为样本内性质会破裂，历史不代表未来。" + NFA,
  });
}
