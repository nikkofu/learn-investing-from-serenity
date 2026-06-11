import { NextResponse } from "next/server";
import { buildMapPrompt } from "@/lib/serenity";
import { chatJson, LLMNotConfiguredError } from "@/lib/llm";
import type { SupplyChainMap, SupplyChainNode } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as { trend?: string };
  const trend = body.trend?.trim();
  if (!trend) {
    return NextResponse.json({ error: "请提供一个趋势/主题" }, { status: 400 });
  }
  const { system, user } = buildMapPrompt(trend);
  try {
    const raw = await chatJson<{ summary?: string; nodes?: SupplyChainNode[] }>(
      system,
      user
    );
    const map: SupplyChainMap = {
      trend,
      summary: raw.summary || "",
      nodes: (raw.nodes ?? []).map((n) => ({
        layer: n.layer || "",
        role: n.role || "",
        isChokepoint: Boolean(n.isChokepoint),
        chokepointReason: n.chokepointReason,
        tickers: (n.tickers ?? []).map((t) => ({
          code: t.code || "",
          name: t.name || "",
          note: t.note || "",
        })),
      })),
      disclaimer:
        "本图由 AI 依据 Serenity 瓶颈点方法生成，公司/代码可能有误，仅供研究，不构成投资建议。",
    };
    return NextResponse.json({ map });
  } catch (e) {
    if (e instanceof LLMNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 412 });
    }
    return NextResponse.json(
      { error: `AI 产业链拆解失败：${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }
}
