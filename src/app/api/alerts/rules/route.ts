import { NextResponse } from "next/server";
import { listRules, upsertRule, deleteRule, setRuleEnabled, type RuleInput } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** GET：列出全部告警规则。 */
export async function GET() {
  return NextResponse.json({ rules: await listRules() });
}

/**
 * POST：新建或更新告警规则。
 *  - 带 id → 更新；不带 id → 新建。
 *  - 仅切换启用：{ id, toggleEnabled: true, enabled }。
 */
export async function POST(req: Request) {
  let body: (RuleInput & { toggleEnabled?: boolean }) | undefined;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: "请求体为空" }, { status: 400 });
  try {
    if (body.toggleEnabled && body.id) {
      const rule = await setRuleEnabled(body.id, body.enabled !== false);
      if (!rule) return NextResponse.json({ error: "未找到对应规则" }, { status: 404 });
      return NextResponse.json({ rule, rules: await listRules() });
    }
    const rule = await upsertRule(body);
    return NextResponse.json({ rule, rules: await listRules() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存规则失败" }, { status: 400 });
  }
}

/** DELETE ?id=：删除告警规则。 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  await deleteRule(id);
  return NextResponse.json({ rules: await listRules() });
}
