import { NextResponse } from "next/server";
import {
  backtestPortfolioByCodes,
  type PortfolioBacktestConfig,
} from "@/lib/portfolioBacktest";
import {
  momentumScorer,
  sectorRotationScorer,
  DEFAULT_MOMENTUM_WEIGHTS,
  type MomentumWeights,
} from "@/lib/momentum";
import { loadSectorsWithStocks } from "@/lib/sectorData";
import { isExcluded } from "@/lib/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface MomentumBacktestBody extends PortfolioBacktestConfig {
  /** 策略：个股动量（momentum）或行业轮动（sectorRotation）。默认 momentum。 */
  mode?: "momentum" | "sectorRotation";
  /** momentum 模式的股票池（6 位代码）。 */
  codes?: string[];
  /** 各代码名称（涨跌停板别 + 主板口径判定）。 */
  names?: Record<string, string>;
  /** 单只取 K 根数，默认 400。 */
  limit?: number;
  /** 因子权重。 */
  weights?: Partial<MomentumWeights>;
  // ── 行业轮动专用 ──
  /** sectorRotation：参评 BK 板块（缺省全部本地板块）。 */
  sectors?: string[];
  /** sectorRotation：每期选动量最强的前几个板块，默认 3。 */
  topSectors?: number;
  /** sectorRotation：单板块最多取多少只成分股，默认 15。 */
  maxStocksPerSector?: number;
}

/**
 * POST /api/momentum/backtest
 * 纯多头组合回测：按横截面动量（个股）或行业轮动（板块→个股）截面排名，每 N 个
 * 交易日轮动等权持有 top-K，含手续费与 A 股涨跌停撮合约束。仅供研究。
 */
export async function POST(req: Request) {
  let body: MomentumBacktestBody = {};
  try {
    body = (await req.json()) as MomentumBacktestBody;
  } catch {
    /* 允许空 body */
  }

  const mode = body.mode === "sectorRotation" ? "sectorRotation" : "momentum";
  const weights: MomentumWeights = { ...DEFAULT_MOMENTUM_WEIGHTS, ...(body.weights ?? {}) };
  const cfg: PortfolioBacktestConfig = {
    startCash: body.startCash,
    rebalanceEveryNDays: body.rebalanceEveryNDays,
    startDate: body.startDate,
    endDate: body.endDate,
    feeBps: body.feeBps,
    maxPositions: body.maxPositions,
    minHoldBars: body.minHoldBars,
  };

  try {
    if (mode === "momentum") {
      const names = body.names ?? {};
      const codes = Array.from(
        new Set((body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c))),
      ).filter((c) => !isExcluded(c, names[c]));
      if (codes.length === 0) {
        return NextResponse.json(
          { error: "缺少有效的主板 codes（6 位代码清单）" },
          { status: 400 },
        );
      }
      const result = await backtestPortfolioByCodes(codes, cfg, {
        limit: body.limit,
        names,
        scorer: momentumScorer(weights),
      });
      return NextResponse.json({ mode, weights, ...result });
    }

    // sectorRotation
    const maxStocksPerSector = Math.max(1, Math.min(80, body.maxStocksPerSector ?? 15));
    const sectors = await loadSectorsWithStocks({ codes: body.sectors, maxStocksPerSector });
    if (sectors.length === 0) {
      return NextResponse.json({ error: "无可用板块成分股数据" }, { status: 502 });
    }
    const codeToSector = new Map<string, { code: string; name: string }>();
    const names: Record<string, string> = { ...(body.names ?? {}) };
    for (const sec of sectors) {
      for (const s of sec.stocks) {
        if (!codeToSector.has(s.code)) codeToSector.set(s.code, { code: sec.code, name: sec.name });
        if (!names[s.code]) names[s.code] = s.name;
      }
    }
    const codes = [...codeToSector.keys()];
    const result = await backtestPortfolioByCodes(codes, cfg, {
      limit: body.limit,
      names,
      scorer: sectorRotationScorer({ codeToSector, topSectors: body.topSectors, weights }),
    });
    return NextResponse.json({
      mode,
      weights,
      topSectors: Math.max(1, body.topSectors ?? 3),
      sectorPool: sectors.length,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `动量组合回测失败: ${msg}` }, { status: 502 });
  }
}

/** 返回默认参数（便于页面初始化）。 */
export async function GET() {
  return NextResponse.json({
    defaults: {
      mode: "momentum",
      startCash: 1_000_000,
      rebalanceEveryNDays: 5,
      feeBps: 30,
      maxPositions: 10,
      minHoldBars: 0,
      limit: 400,
      topSectors: 3,
      maxStocksPerSector: 15,
      weights: DEFAULT_MOMENTUM_WEIGHTS,
    },
    note: "POST 触发纯多头动量组合回测：mode=momentum（个股池）或 sectorRotation（板块轮动）。",
  });
}
