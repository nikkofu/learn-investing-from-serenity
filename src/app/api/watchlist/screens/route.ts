import { NextResponse } from "next/server";
import { createScreen, deleteScreen, listScreens } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

/** GET：列出保存的筛选。 */
export async function GET() {
  return NextResponse.json({ screens: await listScreens() });
}

/** POST { name?, scope, params }：保存一组筛选参数。 */
export async function POST(req: Request) {
  let body: { name?: string; scope?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  if (!body.scope) {
    return NextResponse.json({ error: "缺少 scope（scanner / momentum / arb）" }, { status: 400 });
  }
  try {
    const screen = await createScreen({ name: body.name, scope: body.scope, params: body.params ?? {} });
    return NextResponse.json({ screen, screens: await listScreens() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存筛选失败" }, { status: 400 });
  }
}

/** DELETE ?id=：删除保存的筛选。 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  await deleteScreen(id);
  return NextResponse.json({ screens: await listScreens() });
}
