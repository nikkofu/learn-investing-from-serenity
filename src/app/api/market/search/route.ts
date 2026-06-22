import { NextResponse } from "next/server";
import { searchStocks } from "@/lib/sources";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });
  try {
    const results = await searchStocks(q);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "搜索失败" },
      { status: 502 }
    );
  }
}
