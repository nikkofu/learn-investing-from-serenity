import { NextResponse } from "next/server";
import { getMarketSettingsView, setHistoryStart } from "@/lib/marketSettings";

export const dynamic = "force-dynamic";

/** GET：返回行情历史起始日期（当前值 + 默认值）。 */
export async function GET() {
  return NextResponse.json(getMarketSettingsView());
}

/**
 * POST：{ historyStart: "YYYY-MM-DD" } 设置行情历史起始日期（空串还原默认 2000-01-01）。
 * 注意：改起始日期只影响"今后新拉/全量刷新"的范围，已落盘的历史需清空 kline 缓存后重拉才会变长。
 */
export async function POST(req: Request) {
  let body: { historyStart?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  try {
    const next = await setHistoryStart(body.historyStart ?? "");
    return NextResponse.json({ ok: true, ...getMarketSettingsView(), saved: next });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "保存失败" }, { status: 400 });
  }
}
