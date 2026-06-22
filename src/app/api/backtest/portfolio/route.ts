import { NextResponse } from "next/server";
import {
  backtestPortfolioByCodes,
  type PortfolioBacktestConfig,
} from "@/lib/portfolioBacktest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PortfolioBacktestBody extends PortfolioBacktestConfig {
  /** 待回测的股票代码清单（6 位）。 */
  codes?: string[];
  /** 各代码名称（用于涨跌停板别判定：ST/科创/创业/北交）。 */
  names?: Record<string, string>;
  /** 单只取 K 根数，默认 400。 */
  limit?: number;
}

/**
 * POST /api/backtest/portfolio
 * 给定代码清单 → 批量取日 K → 组合级回测（每 N 日轮动等权持有 top-K，
 * 含手续费与 A 股涨跌停撮合约束）。返回净值曲线 + CAGR/最大回撤/夏普/换手 + 交易流水。
 */
export async function POST(req: Request) {
  let body: PortfolioBacktestBody = {};
  try {
    body = (await req.json()) as PortfolioBacktestBody;
  } catch {
    /* 允许空 body */
  }

  const codes = (body.codes ?? []).map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c));
  if (codes.length === 0) {
    return NextResponse.json({ error: "缺少有效的 codes（6 位代码清单）" }, { status: 400 });
  }

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
    const result = await backtestPortfolioByCodes(Array.from(new Set(codes)), cfg, {
      limit: body.limit,
      names: body.names,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `组合回测失败: ${msg}` }, { status: 502 });
  }
}

/** 返回组合回测的默认参数（便于页面初始化）。 */
export async function GET() {
  return NextResponse.json({
    defaults: {
      startCash: 1_000_000,
      rebalanceEveryNDays: 5,
      feeBps: 30,
      maxPositions: 10,
      minHoldBars: 0,
      limit: 400,
    },
    note: "POST {codes:[...],...} 触发组合回测：每 N 日按价格动量截面排名轮动等权持有 top-K，含手续费与涨跌停撮合约束。默认打分器为纯价格动量（无未来函数）。",
  });
}
