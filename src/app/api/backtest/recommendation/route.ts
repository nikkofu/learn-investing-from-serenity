import { NextResponse } from "next/server";
import {
  backtestRecommendationByCodes,
  type RecommendationBacktestConfig,
} from "@/lib/recommendationBacktest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RecommendationBacktestBody extends RecommendationBacktestConfig {
  /** 待回测的股票代码清单（6 位）。 */
  codes?: string[];
  /** 各代码名称（用于涨跌停板别判定：ST/科创/创业/北交）。 */
  names?: Record<string, string>;
  /** 单只取 K 根数，默认 500。 */
  limit?: number;
}

/**
 * POST /api/backtest/recommendation
 * 「建议忠实回测」：给定股票池 → 批量取日 K → 在每只票上独立模拟买卖建议的执行
 * （信号因果、含涨跌停撮合与手续费）→ 汇总胜率/期望/盈亏比，并对比同持有期买入持有
 * 基线与全程买入持有，给出 z 检验与诚实结论。
 */
export async function POST(req: Request) {
  let body: RecommendationBacktestBody = {};
  try {
    body = (await req.json()) as RecommendationBacktestBody;
  } catch {
    /* 允许空 body */
  }

  const codes = (body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c));
  if (codes.length === 0) {
    return NextResponse.json({ error: "缺少有效的 codes（6 位代码清单）" }, { status: 400 });
  }

  const cfg: RecommendationBacktestConfig = {
    feeBps: body.feeBps,
    takeProfitPct: body.takeProfitPct,
    warmupBars: body.warmupBars,
    matchedHorizon: body.matchedHorizon,
    strategyId: body.strategyId,
    poolChokepointScore: body.poolChokepointScore,
    numTrials: body.numTrials,
    volTargetPct: body.volTargetPct,
  };

  try {
    const result = await backtestRecommendationByCodes(Array.from(new Set(codes)), cfg, {
      limit: body.limit,
      names: body.names,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `建议忠实回测失败: ${msg}` }, { status: 502 });
  }
}

/** 返回默认参数（便于页面初始化）。 */
export async function GET() {
  return NextResponse.json({
    defaults: {
      feeBps: 30,
      takeProfitPct: 0.35,
      warmupBars: 30,
      limit: 500,
      strategyId: "",
      poolChokepointScore: 60,
      volTargetPct: 3,
    },
    note: "POST {codes:[...], strategyId?, numTrials?, volTargetPct?, ...} 触发建议忠实回测：在股票池上逐只独立模拟买卖建议的执行（信号因果、含涨跌停与手续费），汇总胜率/期望/盈亏比，并与同持有期买入持有基线对比 + z 检验。另输出风险调整指标（Sharpe/Sortino/Calmar/最大回撤）、bootstrap 95% 置信区间、PSR/Deflated Sharpe（按 numTrials 做多重检验缩水，默认=已登记策略数）、Bonferroni 校正显著性，以及按 1/ATR 的波动率目标仓位（volTargetPct，默认 3）对照。指定 strategyId（如 chokepoint-momentum-v4）则按该策略忠实重放买卖点；留空走内置均线放量简化口径。",
  });
}
