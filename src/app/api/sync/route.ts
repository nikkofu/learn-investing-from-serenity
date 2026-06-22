import { NextResponse } from "next/server";
import { getSyncStatus, runSync, runAllSync, SYNC_SOURCES, type SyncSourceId } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_IDS = new Set<string>(SYNC_SOURCES.map((s) => s.id));

/** 各数据源的当前落盘状态（数量 + 上次同步时间）。 */
export async function GET() {
  try {
    const sources = await getSyncStatus();
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json(
      { error: `获取同步状态失败: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

/**
 * 运行同步。
 * body: { source?: SyncSourceId | "all"; force?: boolean }
 *  - 省略或 "all"：依次同步全部，返回 { results: [...] }
 *  - 指定单项：返回 { result: {...} }
 *  - force：对 serenity 源跳过 sync_state.json 变更检测，强制全量重拉。
 */
export async function POST(req: Request) {
  let body: { source?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空 body，等价于 all */
  }
  const source = body.source;
  const force = body.force === true;

  try {
    if (!source || source === "all") {
      const results = await runAllSync(force);
      return NextResponse.json({ results });
    }
    if (!VALID_IDS.has(source)) {
      return NextResponse.json({ error: `未知数据源: ${source}` }, { status: 400 });
    }
    const result = await runSync(source as SyncSourceId, force);
    const status = result.ok ? 200 : 500;
    return NextResponse.json({ result }, { status });
  } catch (err) {
    return NextResponse.json(
      { error: `同步执行失败: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
