import { NextResponse } from "next/server";
import { deriveStats, getKlineSafe, getQuote } from "@/lib/market";
import { buildAnalyzePrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { finalizeAssessment } from "@/lib/chokepoint";
import { ndjsonStream } from "@/lib/stream";
import type { ChokepointAssessment } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { code?: string; context?: string };
  const code = body.code?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }

  return ndjsonStream(async (send) => {
    // Stage 1: fetch market data (the "tool call").
    send({ type: "stage", key: "quote", status: "start" });
    let quote, candles, stats;
    try {
      [quote, candles] = await Promise.all([getQuote(code), getKlineSafe(code, 120)]);
      stats = deriveStats(candles);
    } catch (e) {
      send({ type: "error", message: `行情获取失败：${e instanceof Error ? e.message : e}` });
      return;
    }
    send({ type: "quote", quote, stats });
    send({ type: "stage", key: "quote", status: "done" });

    // Stage 2: stream the LLM's chokepoint reasoning token-by-token.
    const { system, user } = buildAnalyzePrompt({
      quote,
      candles,
      stats,
      extraContext: body.context,
    });
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
        send({ type: "error", message: `AI 分析失败：${e instanceof Error ? e.message : e}` });
      }
      return;
    }
    send({ type: "stage", key: "reason", status: "done" });

    // Stage 3: parse + normalize into the structured assessment.
    send({ type: "stage", key: "summary", status: "start" });
    try {
      const raw = parseJsonObject<Partial<ChokepointAssessment>>(acc);
      const assessment = finalizeAssessment(raw);
      send({ type: "result", quote, stats, assessment });
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
