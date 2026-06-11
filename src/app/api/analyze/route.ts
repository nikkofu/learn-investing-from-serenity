import { NextResponse } from "next/server";
import { deriveStats, getKlineSafe, getQuote } from "@/lib/market";
import { buildAnalyzePrompt } from "@/lib/serenity";
import { chatJson, LLMNotConfiguredError } from "@/lib/llm";
import { finalizeAssessment } from "@/lib/chokepoint";
import type { ChokepointAssessment } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as { code?: string; context?: string };
  const code = body.code?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }

  let quote, candles, stats;
  try {
    [quote, candles] = await Promise.all([getQuote(code), getKlineSafe(code, 120)]);
    stats = deriveStats(candles);
  } catch (e) {
    return NextResponse.json(
      { error: `行情获取失败：${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  const { system, user } = buildAnalyzePrompt({
    quote,
    candles,
    stats,
    extraContext: body.context,
  });

  try {
    const raw = await chatJson<Partial<ChokepointAssessment>>(system, user);
    const assessment = finalizeAssessment(raw);
    return NextResponse.json({ quote, candles, stats, assessment });
  } catch (e) {
    if (e instanceof LLMNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 412 });
    }
    return NextResponse.json(
      { error: `AI 分析失败：${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }
}
