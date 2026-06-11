import { NextResponse } from "next/server";
import { getPublicConfig, saveConfig } from "@/lib/config";
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

  if (!baseURL || !model || !apiKey) {
    return NextResponse.json(
      { error: "baseURL、model、apiKey 均为必填" },
      { status: 400 }
    );
  }
  await saveConfig({ provider: provider || "openai", baseURL, model, apiKey });
  return NextResponse.json({ ok: true });
}
