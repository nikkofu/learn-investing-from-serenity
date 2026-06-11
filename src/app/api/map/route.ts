import { NextResponse } from "next/server";
import { buildMapPrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { ndjsonStream } from "@/lib/stream";
import type { SupplyChainMap, SupplyChainNode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { trend?: string };
  const trend = body.trend?.trim();
  if (!trend) {
    return NextResponse.json({ error: "请提供一个趋势/主题" }, { status: 400 });
  }

  const { system, user } = buildMapPrompt(trend);

  return ndjsonStream(async (send) => {
    // Stage 1: stream the LLM's supply-chain reasoning token-by-token.
    send({ type: "stage", key: "reason", status: "start" });
    let acc = "";
    try {
      for await (const delta of chatStream(system, user)) {
        if (delta.kind === "content") acc += delta.text;
        send({ type: "token", kind: delta.kind, text: delta.text });
      }
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) {
        send({ type: "error", status: 412, message: e.message });
      } else {
        send({ type: "error", message: `AI 产业链拆解失败：${e instanceof Error ? e.message : e}` });
      }
      return;
    }
    send({ type: "stage", key: "reason", status: "done" });

    // Stage 2: parse + normalize into the supply-chain map.
    send({ type: "stage", key: "summary", status: "start" });
    try {
      const raw = parseJsonObject<{ summary?: string; nodes?: SupplyChainNode[] }>(acc);
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
      send({ type: "result", map });
      send({ type: "stage", key: "summary", status: "done" });
      send({ type: "done" });
    } catch {
      send({
        type: "error",
        message: "AI 输出解析失败（模型未返回有效 JSON），可重试或换一个能力更强的模型。",
      });
    }
  });
}
