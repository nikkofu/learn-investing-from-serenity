import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT } from "@/lib/sources";
import {
  listSavedStrategies,
  createSavedStrategy,
  deleteSavedStrategy,
  importSavedStrategy,
  revalidateSavedStrategy,
  type CreateSavedStrategyInput,
} from "@/lib/savedStrategies";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const cleanCandles = (cs: Candle[]): Candle[] =>
  cs.filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);

/** GET /api/strategies/saved —— 列出全部沉淀策略（评级降序）。 */
export async function GET() {
  const strategies = await listSavedStrategies();
  return NextResponse.json({ strategies, count: strategies.length });
}

interface PostBody {
  /** create（默认）：由 /arb 校准结果沉淀；revalidate：复检一条；import：粘贴 JSON 导入。 */
  action?: "create" | "revalidate" | "import";
  id?: string;
  strategy?: CreateSavedStrategyInput;
  json?: unknown;
}

export async function POST(req: Request) {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  const action = body.action ?? "create";

  try {
    if (action === "create") {
      if (!body.strategy) return NextResponse.json({ error: "缺少 strategy 字段" }, { status: 400 });
      const created = await createSavedStrategy(body.strategy);
      return NextResponse.json({ strategy: created });
    }

    if (action === "import") {
      const imported = await importSavedStrategy(body.json);
      return NextResponse.json({ strategy: imported });
    }

    if (action === "revalidate") {
      if (!body.id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
      const list = await listSavedStrategies();
      const strat = list.find((s) => s.id === body.id);
      if (!strat) return NextResponse.json({ error: "策略不存在" }, { status: 404 });
      const limit = Math.max(250, Math.min(HISTORY_LIMIT, 500));
      const km = await getKlinesBatch([strat.pair.a, strat.pair.b], limit, "baidu-first");
      const a = cleanCandles(km.get(strat.pair.a)?.candles ?? []);
      const b = cleanCandles(km.get(strat.pair.b)?.candles ?? []);
      if (a.length < 250 || b.length < 250) {
        return NextResponse.json({ error: "两腿可用 K 线不足（各需 ≥250 根），无法复检" }, { status: 502 });
      }
      const updated = await revalidateSavedStrategy(strat.id, a, b);
      return NextResponse.json({ strategy: updated });
    }

    return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  const ok = await deleteSavedStrategy(id);
  if (!ok) return NextResponse.json({ error: "策略不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
