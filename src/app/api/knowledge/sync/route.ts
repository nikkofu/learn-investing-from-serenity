import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { syncPostsWithRemote } from "@/lib/knowledge";

const POSTS_PATH = path.join(process.cwd(), ".data", "x-posts.json");

export async function GET() {
  try {
    const raw = await fs.readFile(POSTS_PATH, "utf8");
    const data = JSON.parse(raw);
    
    // 获取文件的实际修改时间，用来做精细的本地时间对比
    let localMtime = new Date().toISOString();
    try {
      const stat = await fs.stat(POSTS_PATH);
      localMtime = stat.mtime.toISOString();
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      available: true,
      handle: data.handle || "aleabitoreddit",
      scrapedAt: data.scrapedAt || localMtime,
      mtime: localMtime,
      count: data.posts?.length || 0,
    });
  } catch (err) {
    return NextResponse.json({
      available: false,
      handle: "aleabitoreddit",
      scrapedAt: null,
      mtime: null,
      count: 0,
    });
  }
}

export async function POST() {
  try {
    const result = await syncPostsWithRemote();
    return NextResponse.json({
      status: "success",
      newCount: result.newCount,
      totalCount: result.totalCount,
      scrapedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Sync API] 手动同步失败:", err);
    return NextResponse.json(
      {
        status: "error",
        error: err?.message || "同步服务暂时不可用，请稍后重试",
      },
      { status: 500 }
    );
  }
}
