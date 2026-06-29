import { promises as fs } from "fs";
import path from "path";
import type { LLMConfig, PublicLLMConfig, EmailConfig, PublicEmailConfig } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "llm-config.json");
const EMAIL_CONFIG_PATH = path.join(DATA_DIR, "email-config.json");

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
    filters: fromFile.filters || "",
    providers: fromFile.providers || {},
  };

  if (merged.baseURL) {
    merged.baseURL = merged.baseURL.trim().replace(/\/chat\/completions\/?$/, "");
  }

  // 向下兼容：如果文件有 provider 配置但 providers 里没有，合并写入
  if (merged.provider && merged.baseURL && merged.apiKey) {
    if (!merged.providers) {
      merged.providers = {};
    }
    if (!merged.providers[merged.provider]) {
      merged.providers[merged.provider] = {
        baseURL: merged.baseURL,
        apiKey: merged.apiKey,
        model: merged.model,
        filters: merged.filters,
      };
    }
  }

  if (!merged.apiKey || !merged.baseURL || !merged.model) return null;
  return merged;
}

export async function saveConfig(config: LLMConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  
  let current: any = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    current = JSON.parse(raw);
  } catch {
    // ignore
  }

  current.provider = config.provider;
  current.baseURL = config.baseURL;
  current.model = config.model;
  current.apiKey = config.apiKey;
  current.filters = config.filters || "";

  if (!current.providers) {
    current.providers = {};
  }
  current.providers[config.provider] = {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    filters: config.filters || "",
  };

  if (config.providers) {
    for (const [key, val] of Object.entries(config.providers)) {
      // 避开当前正在激活并设置好的 provider，防止被传入的旧配置反向覆盖！
      if (key === config.provider) continue;

      if (!current.providers[key]) {
        current.providers[key] = val;
      } else {
        current.providers[key] = {
          ...current.providers[key],
          ...val
        };
      }
    }
  }

  await fs.writeFile(CONFIG_PATH, JSON.stringify(current, null, 2), "utf8");
}

export async function getPublicConfig(): Promise<PublicLLMConfig> {
  let fromFile: Partial<LLMConfig> = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    fromFile = JSON.parse(raw) as Partial<LLMConfig>;
  } catch {
    // none saved
  }
  let baseURL = fromFile.baseURL || process.env.OPENAI_BASE_URL || "";
  if (baseURL) {
    baseURL = baseURL.trim().replace(/\/chat\/completions\/?$/, "");
  }

  const publicProviders: Record<string, { baseURL: string; hasApiKey: boolean; model?: string; filters?: string }> = {};
  const providersMap = fromFile.providers || {};
  
  const mainProvider = fromFile.provider || "";
  if (mainProvider && fromFile.baseURL && fromFile.apiKey && !providersMap[mainProvider]) {
    providersMap[mainProvider] = {
      baseURL: fromFile.baseURL,
      apiKey: fromFile.apiKey,
      model: fromFile.model,
      filters: fromFile.filters,
    };
  }

  for (const [key, val] of Object.entries(providersMap)) {
    if (val && typeof val === "object") {
      publicProviders[key] = {
        baseURL: val.baseURL || "",
        hasApiKey: Boolean(val.apiKey),
        model: val.model || "",
        filters: val.filters || "",
      };
    }
  }

  return {
    provider: fromFile.provider || process.env.LLM_PROVIDER || "",
    baseURL,
    model: fromFile.model || process.env.OPENAI_MODEL || "",
    hasApiKey: Boolean(fromFile.apiKey || process.env.OPENAI_API_KEY),
    filters: fromFile.filters || "",
    providers: publicProviders,
  };
}

export async function loadTheme(): Promise<string> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.theme || "pine-frost";
  } catch {
    return "pine-frost";
  }
}

export async function saveTheme(theme: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let current: any = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    current = JSON.parse(raw);
  } catch {
    // ignore
  }
  current.theme = theme;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(current, null, 2), "utf8");
}

export async function loadThemeMode(): Promise<string> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.themeMode || "dark";
  } catch {
    return "dark";
  }
}

export async function saveThemeMode(mode: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let current: any = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    current = JSON.parse(raw);
  } catch {
    // ignore
  }
  current.themeMode = mode;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(current, null, 2), "utf8");
}

/**
 * Load email configuration for evening scan reports.
 */
export async function loadEmailConfig(): Promise<EmailConfig | null> {
  try {
    const raw = await fs.readFile(EMAIL_CONFIG_PATH, "utf8");
    const config = JSON.parse(raw) as EmailConfig;
    
    // Validate basic structure
    if (typeof config.senderEmail !== "string" || typeof config.recipientEmail !== "string") {
      return null;
    }
    
    return config;
  } catch {
    // no saved config yet
    return null;
  }
}

/**
 * Save email configuration.
 */
export async function saveEmailConfig(config: EmailConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(EMAIL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Get public email config (safe to expose to browser).
 */
export async function getPublicEmailConfig(): Promise<PublicEmailConfig> {
  try {
    const raw = await fs.readFile(EMAIL_CONFIG_PATH, "utf8");
    const config = JSON.parse(raw) as EmailConfig;
    
    const maskEmail = (email: string): string => {
      if (!email) return "";
      const [local, domain] = email.split("@");
      if (local.length <= 2) return `${local[0]}***@${domain}`;
      return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
    };
    
    return {
      hasSenderEmail: Boolean(config.senderEmail && config.senderEmail.trim()),
      hasRecipientEmail: Boolean(config.recipientEmail && config.recipientEmail.trim()),
      maskedSenderEmail: config.senderEmail ? maskEmail(config.senderEmail) : undefined,
      maskedRecipientEmail: config.recipientEmail ? maskEmail(config.recipientEmail) : undefined,
    };
  } catch {
    return {
      hasSenderEmail: false,
      hasRecipientEmail: false,
    };
  }
}
