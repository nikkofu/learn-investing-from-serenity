import { NextResponse } from "next/server";
import { listViews, createView, updateView, deleteView } from "@/lib/compare";

export const dynamic = "force-dynamic";

/** GET /api/compare/views — 列出已保存的对比视图（布局）。 */
export async function GET() {
  try {
    return NextResponse.json({ views: await listViews() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `读取对比视图失败: ${msg}` }, { status: 500 });
  }
}

interface ViewBody {
  id?: string;
  name?: string;
  codes?: string[] | string;
  columns?: unknown;
  sortKey?: string;
  sortDir?: string;
}

/** POST /api/compare/views — 新建（无 id）或更新（带 id）对比视图。 */
export async function POST(req: Request) {
  let body: ViewBody = {};
  try {
    body = (await req.json()) as ViewBody;
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  try {
    if (body.id) {
      const updated = await updateView(body.id, {
        name: body.name,
        codes: body.codes ?? [],
        columns: body.columns,
        sortKey: body.sortKey,
        sortDir: body.sortDir,
      });
      if (!updated) return NextResponse.json({ error: "未找到该对比视图" }, { status: 404 });
      return NextResponse.json({ view: updated });
    }
    const view = await createView({
      name: body.name,
      codes: body.codes ?? [],
      columns: body.columns,
      sortKey: body.sortKey,
      sortDir: body.sortDir,
    });
    return NextResponse.json({ view });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** DELETE /api/compare/views?id=xxx — 删除一个对比视图。 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    const ok = await deleteView(id);
    if (!ok) return NextResponse.json({ error: "未找到该对比视图" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `删除失败: ${msg}` }, { status: 500 });
  }
}
