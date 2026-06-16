import { NextResponse } from "next/server";
import { getPublicConfig, saveConfig, loadConfig } from "@/lib/config";
import type { LLMConfig } from "@/lib/types";

export async function GET() {
  return NextResponse.json(await getPublicConfig());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as any;
    const existing = await loadConfig();

    // 1. 支持删除 Provider 动作
    if (body.action === "delete" && body.provider) {
      const pToDelete = body.provider.trim();
      if (existing && existing.providers) {
        delete existing.providers[pToDelete];
        
        // 如果删掉的是当前活跃的，自动漂移至下一个可用 Provider
        if (existing.provider === pToDelete) {
          const keys = Object.keys(existing.providers);
          if (keys.length > 0) {
            const firstKey = keys[0];
            const match = existing.providers[firstKey];
            existing.provider = firstKey;
            existing.baseURL = match.baseURL || "";
            existing.apiKey = match.apiKey || "";
            existing.model = match.model || "";
            existing.filters = match.filters || "";
          } else {
            existing.provider = "";
            existing.baseURL = "";
            existing.apiKey = "";
            existing.model = "";
            existing.filters = "";
          }
        }
        await saveConfig(existing);
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "Provider 未找到" }, { status: 400 });
    }

    // 2. 正常增量合并保存
    const targetProvider = body.provider !== undefined ? body.provider.trim() : (existing?.provider || "openai");
    let targetBaseURL = body.baseURL !== undefined ? body.baseURL.trim() : "";
    let targetApiKey = (body.apiKey || "").trim();
    let targetModel = body.model !== undefined ? body.model.trim() : "";
    let targetFilters = body.filters !== undefined ? body.filters.trim() : "";

    // 从已有 providers 字典尝试拉取该 provider 缓存
    if (existing && existing.providers && existing.providers[targetProvider]) {
      const match = existing.providers[targetProvider];
      if (!targetBaseURL) targetBaseURL = match.baseURL || "";
      if (!targetApiKey) targetApiKey = match.apiKey || "";
      if (!targetModel && !body.model) targetModel = match.model || "";
      if (body.filters === undefined) targetFilters = match.filters || "";
    }

    // 回退退避
    if (!targetBaseURL) targetBaseURL = existing?.baseURL || "https://api.openai.com/v1";
    if (!targetApiKey) targetApiKey = existing?.apiKey || "";
    if (!targetModel) targetModel = existing?.model || "gpt-4o-mini";
    if (body.filters === undefined && !targetFilters) targetFilters = existing?.filters || "";

    if (!targetBaseURL || !targetModel || !targetApiKey) {
      return NextResponse.json(
        { error: "baseURL、model、apiKey 均为必填" },
        { status: 400 }
      );
    }
    
    await saveConfig({
      provider: targetProvider,
      baseURL: targetBaseURL,
      model: targetModel,
      apiKey: targetApiKey,
      filters: targetFilters,
      providers: existing?.providers,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "保存配置失败" }, { status: 500 });
  }
}
