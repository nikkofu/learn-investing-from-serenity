import { NextResponse } from "next/server";
import { listEvents, markEventRead, markAllRead, clearEvents } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** GET ?unread=1：列出告警箱（可选仅未读）。 */
export async function GET(req: Request) {
  const unread = new URL(req.url).searchParams.get("unread") === "1";
  const events = await listEvents(unread);
  return NextResponse.json({ events, unreadCount: events.filter((e) => !e.read).length });
}

/**
 * POST：告警箱维护动作。
 *  - { action: "read", id } 标记单条已读
 *  - { action: "readAll" } 全部已读
 *  - { action: "clear" } 清空告警箱
 */
export async function POST(req: Request) {
  let body: { action?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  switch (body.action) {
    case "read":
      if (!body.id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
      await markEventRead(body.id);
      break;
    case "readAll":
      await markAllRead();
      break;
    case "clear":
      await clearEvents();
      break;
    default:
      return NextResponse.json({ error: "未知 action" }, { status: 400 });
  }
  const events = await listEvents();
  return NextResponse.json({ events, unreadCount: events.filter((e) => !e.read).length });
}
