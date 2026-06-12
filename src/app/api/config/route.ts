import { NextResponse } from "next/server";
import { getPublicConfig, saveConfig, loadConfig } from "@/lib/config";
import type { LLMConfig } from "@/lib/types";

export async function GET() {
  return NextResponse.json(await getPublicConfig());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<LLMConfig>;
  const provider = (body.provider || "").trim();
  const baseURL = (body.baseURL || "").trim();
  const model = (body.model || "").trim();
  const apiKey = (body.apiKey || "").trim();

  let finalApiKey = apiKey;
  if (!finalApiKey) {
    const existing = await loadConfig();
    if (existing && existing.apiKey) {
      finalApiKey = existing.apiKey;
    }
  }

  if (!baseURL || !model || !finalApiKey) {
    return NextResponse.json(
      { error: "baseURL、model、apiKey 均为必填" },
      { status: 400 }
    );
  }
  await saveConfig({ provider: provider || "openai", baseURL, model, apiKey: finalApiKey });
  return NextResponse.json({ ok: true });
}
