import { NextResponse } from "next/server";
import { addFavorite, listFavorites, removeFavorite } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

/** GET：列出收藏的个股。 */
export async function GET() {
  return NextResponse.json({ favorites: await listFavorites() });
}

/** POST { code, name?, note? }：收藏 / 更新一只个股。 */
export async function POST(req: Request) {
  let body: { code?: string; name?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  const code = body.code?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }
  try {
    const fav = await addFavorite({ code, name: body.name, note: body.note });
    return NextResponse.json({ favorite: fav, favorites: await listFavorites() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "收藏失败" }, { status: 400 });
  }
}

/** DELETE ?code=：移除收藏。 */
export async function DELETE(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "缺少 code 参数" }, { status: 400 });
  await removeFavorite(code);
  return NextResponse.json({ favorites: await listFavorites() });
}
