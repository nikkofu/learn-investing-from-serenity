import { NextResponse } from "next/server";
import { loadCurated, loadPostsDigest } from "@/lib/knowledge";

export async function GET() {
  try {
    const [curated, posts] = await Promise.all([loadCurated(), loadPostsDigest()]);
    return NextResponse.json({ curated, posts });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "知识库加载失败" },
      { status: 500 }
    );
  }
}
