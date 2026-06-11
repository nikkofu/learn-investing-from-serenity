import { promises as fs } from "fs";
import path from "path";
import type { LLMConfig, PublicLLMConfig } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "llm-config.json");

/**
 * Load the LLM config. Precedence: the saved config file, then environment
 * variables (useful for deployments). Returns null if nothing is configured.
 */
export async function loadConfig(): Promise<LLMConfig | null> {
  let fromFile: Partial<LLMConfig> = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    fromFile = JSON.parse(raw) as Partial<LLMConfig>;
  } catch {
    // no saved config yet
  }

  const merged: LLMConfig = {
    provider: fromFile.provider || process.env.LLM_PROVIDER || "openai",
    baseURL: fromFile.baseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: fromFile.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
    apiKey: fromFile.apiKey || process.env.OPENAI_API_KEY || "",
  };

  if (!merged.apiKey || !merged.baseURL || !merged.model) return null;
  return merged;
}

export async function saveConfig(config: LLMConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export async function getPublicConfig(): Promise<PublicLLMConfig> {
  let fromFile: Partial<LLMConfig> = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    fromFile = JSON.parse(raw) as Partial<LLMConfig>;
  } catch {
    // none saved
  }
  return {
    provider: fromFile.provider || process.env.LLM_PROVIDER || "",
    baseURL: fromFile.baseURL || process.env.OPENAI_BASE_URL || "",
    model: fromFile.model || process.env.OPENAI_MODEL || "",
    hasApiKey: Boolean(fromFile.apiKey || process.env.OPENAI_API_KEY),
  };
}
