import { NextResponse } from "next/server";
import { loadTheme, saveTheme, loadThemeMode, saveThemeMode } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const theme = await loadTheme();
    const mode = await loadThemeMode();
    return NextResponse.json({ theme, mode });
  } catch (error) {
    return NextResponse.json({ error: "读取主题失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const theme = body.theme?.trim();
    const mode = body.mode?.trim();

    if (theme) {
      await saveTheme(theme);
    }
    if (mode) {
      await saveThemeMode(mode);
    }

    if (!theme && !mode) {
      return NextResponse.json({ error: "参数缺失" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "保存主题失败" }, { status: 500 });
  }
}
