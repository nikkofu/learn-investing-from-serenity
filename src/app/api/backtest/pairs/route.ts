import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT } from "@/lib/sources";
import { runPairScan } from "@/lib/pairTrading";
import type { Candle } from "@/lib/types";
import { NFA } from "@/lib/disclaimers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PairBacktestBody {
  /** 候选股票池（6 位代码清单）；两两搜索协整配对。 */
  codes?: string[];
  limit?: number;
  topN?: number;
  trainFrac?: number;
  minCorrelation?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  feeBps?: number;
}

/**
 * POST /api/backtest/pairs
 * 统计套利 / 配对交易：在候选池里两两做 Engle-Granger 协整检验，挑出协整配对，
 * 用 z 分数阈值做市场中性回测，并给出样本内 vs 样本外对照（杜绝选样泄漏）。
 */
export async function POST(req: Request) {
  let body: PairBacktestBody = {};
  try {
    body = (await req.json()) as PairBacktestBody;
  } catch {
    /* 允许空 body */
  }
  const codes = Array.from(
    new Set((body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c))),
  );
  if (codes.length < 3) {
    return NextResponse.json({ error: "配对交易至少需要 3 只候选（建议 ≥10 只）" }, { status: 400 });
  }

  try {
    const limit = Math.max(250, Math.min(HISTORY_LIMIT, body.limit ?? 500));
    const km = await getKlinesBatch(codes, limit, "baidu-first");
    const candles: Record<string, Candle[]> = {};
    for (const code of codes) {
      // 前复权早年负价/近零会污染回测，只取正价区间。
      const cs = (km.get(code)?.candles ?? []).filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);
      if (cs.length >= 250) candles[code] = cs;
    }
    if (Object.keys(candles).length < 3) {
      return NextResponse.json({ error: "有效 K 线数据不足（需 ≥3 只、每只 ≥250 根）" }, { status: 502 });
    }
    const result = runPairScan(candles, {
      topN: body.topN ?? 15,
      trainFrac: body.trainFrac ?? 0.6,
      find: { minCorrelation: body.minCorrelation ?? 0.7, minHalfLife: 2, maxHalfLife: 60 },
      trade: { entryZ: body.entryZ ?? 2.0, exitZ: body.exitZ ?? 0.5, stopZ: body.stopZ ?? 3.5, feeBps: body.feeBps ?? 30 },
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `配对交易扫描失败: ${msg}` }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    defaults: { limit: 500, topN: 15, trainFrac: 0.6, minCorrelation: 0.7, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, feeBps: 30 },
    note: "POST {codes:[...]} 在候选池两两做 Engle-Granger 协整检验（OLS 求对冲比例 β → 残差 ADF 平稳性），挑出协整配对，用 z 分数阈值做市场中性回测（z≥entryZ 做空价差、z≤-entryZ 做多价差、|z|≤exitZ 平仓、|z|≥stopZ 破裂止损），双边手续费。输出样本内 vs 样本外（前 trainFrac 选配对+定 β、后段独立交易）对照——两者差距即过拟合程度。诚实边界：A 股融券受限，纯多空在多数个股难落地。" + NFA,
  });
}
