import { NextResponse } from "next/server";
import { listStrategies, DEFAULT_STRATEGY_ID } from "@/lib/strategies";

export const dynamic = "force-dynamic";

/** 列出所有可用回测策略的元信息（名称/版本/简介）与默认策略 id。 */
export async function GET() {
  return NextResponse.json({
    defaultStrategyId: DEFAULT_STRATEGY_ID,
    strategies: listStrategies(),
  });
}
