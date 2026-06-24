import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT } from "@/lib/sources";
import {
  scoreCrossSection,
  DEFAULT_MOMENTUM_WEIGHTS,
  type MomentumWeights,
} from "@/lib/momentum";
import { isExcluded } from "@/lib/universe";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RankBody {
  /** 待打分的股票代码清单（6 位）。 */
  codes?: string[];
  /** 各代码名称（用于主板口径判定与展示）。 */
  names?: Record<string, string>;
  /** 单只取 K 根数，默认 280。 */
  limit?: number;
  /** 因子权重（缺省用默认权重）。 */
  weights?: Partial<MomentumWeights>;
  /** 只返回前 N 名，默认全部。 */
  topN?: number;
}

/**
 * POST /api/momentum/rank
 * 主板个股横截面动量打分：批量取日 K → 合成多因子动量分（近 1/3/6 月收益、12-1
 * 动量、风险调整、趋势）→ 截面排名返回。仅供研究，不构成投资建议。
 */
export async function POST(req: Request) {
  let body: RankBody = {};
  try {
    body = (await req.json()) as RankBody;
  } catch {
    /* 允许空 body */
  }

  const names = body.names ?? {};
  const codes = Array.from(
    new Set((body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c))),
  ).filter((c) => !isExcluded(c, names[c])); // 主板纯净化

  if (codes.length === 0) {
    return NextResponse.json(
      { error: "缺少有效的主板 codes（6 位代码清单，已剔除科创/北交/ST/B 股）" },
      { status: 400 },
    );
  }

  const limit = Math.max(70, Math.min(HISTORY_LIMIT, body.limit ?? 280));
  const weights: MomentumWeights = { ...DEFAULT_MOMENTUM_WEIGHTS, ...(body.weights ?? {}) };

  try {
    const klineMap = await getKlinesBatch(codes, limit, "baidu-first");
    const view = codes
      .map((code) => {
        const item = klineMap.get(code);
        if (!item || item.candles.length < 30) return null;
        const clean = item.candles
          .filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0)
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        return { code, name: names[code] ?? code, history: clean };
      })
      .filter((v): v is { code: string; name: string; history: Candle[] } => v !== null);

    if (view.length === 0) {
      return NextResponse.json({ error: "无可用 K 线数据，无法打分" }, { status: 502 });
    }

    let ranked = scoreCrossSection(view, weights);
    if (body.topN && body.topN > 0) ranked = ranked.slice(0, body.topN);

    return NextResponse.json({
      weights,
      universe: { requested: (body.codes ?? []).length, eligible: ranked.length },
      ranked,
      note: "横截面多因子动量分（[0,1] 截面百分位加权）。仅供研究，不构成投资建议。",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `动量打分失败: ${msg}` }, { status: 502 });
  }
}

/** 返回默认参数与因子权重（便于页面初始化）。 */
export async function GET() {
  return NextResponse.json({
    defaults: { limit: 280, weights: DEFAULT_MOMENTUM_WEIGHTS },
    note: "POST {codes:[...],names?,limit?,weights?,topN?} 触发主板个股横截面动量打分。",
  });
}
