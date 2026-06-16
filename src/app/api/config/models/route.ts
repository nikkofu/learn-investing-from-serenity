import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const PRESETS: Record<string, string[]> = {
  OpenAI: ["gpt-4o-mini", "gpt-4o"],
  OpenRouter: [
    "deepseek/deepseek-chat",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct"
  ],
  DeepSeek: ["deepseek-chat", "deepseek-reasoner"],
  SiliconFlow: [
    "deepseek-ai/DeepSeek-V3",
    "deepseek-ai/DeepSeek-Coder-V2-Instruct",
    "deepseek-ai/DeepSeek-R1"
  ],
  Moonshot: ["moonshot-v1-8k", "moonshot-v1-32k"],
  通义千问: ["qwen-turbo", "qwen-plus", "qwen-max"]
};

async function fetchModelsForProvider(
  provider: string,
  baseURL: string,
  apiKey: string,
  filters?: string
): Promise<string[]> {
  if (!baseURL || !apiKey) return [];

  const filterKeywords = filters
    ? filters
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];

  let list: string[] = [];
  try {
    const res = await fetch(`${baseURL}/models`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data && Array.isArray(data.data)) {
      list = data.data
        .map((m: any) => m.id)
        .filter((id: any) => typeof id === "string" && id.length > 0);
    }
  } catch (err) {
    console.warn(`Failed to fetch models for ${provider}, using presets:`, err);
  }

  if (list.length === 0) {
    const presetKey = Object.keys(PRESETS).find(
      (k) => k.toLowerCase() === provider.toLowerCase()
    );
    list = presetKey ? [...PRESETS[presetKey]] : ["gpt-4o-mini", "deepseek-chat"];
  }

  list.sort((a, b) => a.localeCompare(b));

  if (filterKeywords.length > 0) {
    list = list.filter((mName) =>
      filterKeywords.some((kw) => mName.toLowerCase().includes(kw))
    );
  }

  return list;
}

export async function GET() {
  const config = await loadConfig();
  if (!config) {
    return NextResponse.json({ models: {} });
  }

  const providers = config.providers || {};
  
  if (config.provider && config.baseURL && config.apiKey && !providers[config.provider]) {
    providers[config.provider] = {
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model,
      filters: config.filters,
    };
  }

  const results: Record<string, string[]> = {};

  const promises = Object.entries(providers).map(async ([name, p]) => {
    if (p && p.apiKey) {
      const list = await fetchModelsForProvider(name, p.baseURL, p.apiKey, p.filters);
      results[name] = list;
    }
  });

  await Promise.all(promises);

  return NextResponse.json({ models: results });
}
