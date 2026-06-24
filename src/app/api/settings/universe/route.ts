import { NextResponse } from "next/server";
import { getUniverseSettingsView, setUniverseConfig, type UniverseConfig } from "@/lib/universe";

export const dynamic = "force-dynamic";

/** GET：返回股票池纯净化口径（当前值 + 默认值）。 */
export async function GET() {
  return NextResponse.json(getUniverseSettingsView());
}

/**
 * POST：部分更新股票池纯净化口径。
 * body 为 UniverseConfig 的任意子集（仅传需要改的字段），其余沿用现值。
 */
export async function POST(req: Request) {
  let body: Partial<UniverseConfig>;
  try {
    body = (await req.json()) as Partial<UniverseConfig>;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  try {
    const saved = await setUniverseConfig(body ?? {});
    return NextResponse.json({ ok: true, ...getUniverseSettingsView(), saved });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "保存失败" }, { status: 400 });
  }
}
