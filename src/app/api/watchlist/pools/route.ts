import { NextResponse } from "next/server";
import { createPool, deletePool, listPools, updatePool } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

/** GET：列出全部自定义股票池。 */
export async function GET() {
  return NextResponse.json({ pools: await listPools() });
}

/**
 * POST：新建或更新股票池。
 *  - 带 id → 更新（name / codes / note 任意子集）。
 *  - 不带 id → 新建（codes 必填）。
 */
export async function POST(req: Request) {
  let body: { id?: string; name?: string; codes?: string[] | string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  try {
    if (body.id) {
      const pool = await updatePool(body.id, { name: body.name, codes: body.codes, note: body.note });
      if (!pool) return NextResponse.json({ error: "未找到对应股票池" }, { status: 404 });
      return NextResponse.json({ pool, pools: await listPools() });
    }
    const pool = await createPool({ name: body.name, codes: body.codes ?? [], note: body.note });
    return NextResponse.json({ pool, pools: await listPools() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存股票池失败" }, { status: 400 });
  }
}

/** DELETE ?id=：删除股票池。 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  await deletePool(id);
  return NextResponse.json({ pools: await listPools() });
}
