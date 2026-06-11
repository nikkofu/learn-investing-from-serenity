import OpenAI from "openai";
import { loadConfig } from "./config";

export class LLMNotConfiguredError extends Error {
  constructor() {
    super("LLM 未配置：请先在「设置」页填写 provider / base URL / model / API key。");
    this.name = "LLMNotConfiguredError";
  }
}

/** Call an OpenAI-compatible chat completion and return the raw text content. */
export async function chat(
  system: string,
  user: string,
  opts: { temperature?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const config = await loadConfig();
  if (!config) throw new LLMNotConfiguredError();

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: opts.temperature ?? 0.4,
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}

/** Extract a JSON object from model output, tolerating code fences / stray text. */
export function parseJsonObject<T>(text: string): T {
  let s = text.trim();
  // Strip ```json ... ``` fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the first {...} block.
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  }
  return JSON.parse(s) as T;
}

/** Try JSON mode first; if the provider/model rejects it, retry without it. */
export async function chatJson<T>(system: string, user: string): Promise<T> {
  let text: string;
  try {
    text = await chat(system, user, { jsonMode: true, temperature: 0.4 });
  } catch (e) {
    if (e instanceof LLMNotConfiguredError) throw e;
    // Some OpenAI-compatible providers don't support response_format.
    text = await chat(system, user, { temperature: 0.4 });
  }
  return parseJsonObject<T>(text);
}
