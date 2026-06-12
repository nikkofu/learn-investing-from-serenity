import { NextResponse } from "next/server";
import { loadTheme, saveTheme } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const theme = await loadTheme();
    return NextResponse.json({ theme });
  } catch (error) {
    return NextResponse.json({ error: "读取主题失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const theme = body.theme?.trim();
    if (!theme) {
      return NextResponse.json({ error: "主题参数缺失" }, { status: 400 });
    }
    await saveTheme(theme);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "保存主题失败" }, { status: 500 });
  }
}
