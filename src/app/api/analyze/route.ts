import { NextResponse } from "next/server";
import { deriveStats, getKlineSafe, getQuote } from "@/lib/market";
import { buildAnalyzePrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { finalizeAssessment } from "@/lib/chokepoint";
import { ndjsonStream } from "@/lib/stream";
import { NarrativeJsonSplitter } from "@/lib/split";
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
    const splitter = new NarrativeJsonSplitter();
    // Advance reason -> summary as soon as the (hidden) JSON phase begins, so the
    // UI never looks stuck while the model silently writes the structured result.
    let advanced = false;
    const advanceToSummary = () => {
      if (advanced) return;
      advanced = true;
      send({ type: "stage", key: "reason", status: "done" });
      send({ type: "stage", key: "summary", status: "start" });
    };
    try {
      for await (const delta of chatStream(system, user)) {
        if (delta.kind === "reasoning") {
          send({ type: "token", kind: "reasoning", text: delta.text });
          continue;
        }
        // Stream readable reasoning (content) and the raw JSON phase
        // (structured) on separate channels, so the structured phase still
        // shows live progress without polluting the readable console.
        const { narrative, structured } = splitter.push(delta.text);
        if (narrative) send({ type: "token", kind: "content", text: narrative });
        if (structured) send({ type: "token", kind: "structured", text: structured });
        if (splitter.inJsonPhase) advanceToSummary();
      }
      const tail = splitter.end();
      if (tail) send({ type: "token", kind: "content", text: tail });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) {
        send({ type: "error", status: 412, message: e.message });
      } else {
        send({ type: "error", message: `AI 分析失败：${e instanceof Error ? e.message : e}` });
      }
      return;
    }
    advanceToSummary();

    // Stage 3: parse + normalize into the structured assessment.
    try {
      const raw = parseJsonObject<Partial<ChokepointAssessment>>(splitter.jsonText);
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
