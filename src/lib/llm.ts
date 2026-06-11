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

/** A streamed delta: model "thinking" (reasoning) or visible answer (content). */
export interface StreamDelta {
  kind: "reasoning" | "content";
  text: string;
}

/** OpenRouter/DeepSeek-style reasoning fields are not in the base SDK delta type. */
interface ReasoningDetail {
  type?: string;
  text?: string | null;
  summary?: string | null;
}
interface DeltaWithReasoning {
  content?: string | null;
  // DeepSeek / older OpenRouter style: a plain reasoning string.
  reasoning?: string | null;
  reasoning_content?: string | null;
  // Newer OpenRouter standardized format: an array of reasoning detail objects
  // (https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
  reasoning_details?: ReasoningDetail[] | null;
}

/** Pull any human-readable reasoning text out of a streamed delta. */
function reasoningText(delta: DeltaWithReasoning): string {
  const plain = delta.reasoning ?? delta.reasoning_content;
  if (plain) return plain;
  if (Array.isArray(delta.reasoning_details)) {
    return delta.reasoning_details
      .map((d) => d.text ?? d.summary ?? "")
      .join("");
  }
  return "";
}

/**
 * OpenRouter exposes reasoning ("thinking") tokens, but for many models they
 * must be explicitly requested via the `reasoning` body param. We enable them
 * for OpenRouter base URLs so reasoning-capable models stream their thinking.
 * Other providers (e.g. api.openai.com) reject unknown params, so we only add
 * it when talking to OpenRouter. `LLM_REASONING=off` opts out.
 * See https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.
 */
function reasoningParam(baseURL: string): Record<string, unknown> {
  if (process.env.LLM_REASONING === "off") return {};
  if (!/openrouter\.ai/i.test(baseURL)) return {};
  const effort = process.env.LLM_REASONING_EFFORT; // optional: xhigh|high|medium|low|minimal
  return { reasoning: effort ? { effort } : { enabled: true } };
}

/**
 * Stream an OpenAI-compatible chat completion, yielding reasoning + content
 * deltas as they arrive so the UI can show progress live.
 */
export async function* chatStream(
  system: string,
  user: string,
  opts: { temperature?: number } = {}
): AsyncGenerator<StreamDelta, void, unknown> {
  const config = await loadConfig();
  if (!config) throw new LLMNotConfiguredError();

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });

  const stream = await client.chat.completions.create({
    model: config.model,
    temperature: opts.temperature ?? 0.4,
    stream: true as const,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // `reasoning` is an OpenRouter extension not in the base SDK params type.
    ...reasoningParam(config.baseURL),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as DeltaWithReasoning | undefined;
    if (!delta) continue;
    const reasoning = reasoningText(delta);
    if (reasoning) yield { kind: "reasoning", text: reasoning };
    if (delta.content) yield { kind: "content", text: delta.content };
  }
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
