import { NextResponse } from "next/server";
import { buildMapPrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { ndjsonStream } from "@/lib/stream";
import { NarrativeJsonSplitter } from "@/lib/split";
import type { SupplyChainMap, SupplyChainNode } from "@/lib/types";
import { loadConfig } from "@/lib/config";
import { getCacheTTL } from "@/lib/cacheSettings";
import { getPersistent, setPersistent } from "@/lib/llmCache";
import { NFA } from "@/lib/disclaimers";

export const dynamic = "force-dynamic";

const MAP_CACHE_NS = "map";
// 趋势→产业链图谱几乎全静态，提示词版本变化时 +1 让旧缓存自然失效。
const MAP_PROMPT_VERSION = 1;

export async function POST(req: Request) {
  const body = (await req.json()) as { trend?: string; refresh?: boolean };
  const trend = body.trend?.trim();
  if (!trend) {
    return NextResponse.json({ error: "请提供一个趋势/主题" }, { status: 400 });
  }

  const refresh = body.refresh === true;
  const cfg = await loadConfig();
  const model = cfg?.model ?? "unknown";
  const cacheKey = `v${MAP_PROMPT_VERSION}:${trend}:${model}`;
  const ttlMs = getCacheTTL("trendMap", true);
  const cachedMap = refresh ? null : await getPersistent<SupplyChainMap>(MAP_CACHE_NS, cacheKey);

  if (cachedMap) {
    // 缓存命中：落盘的产业链图谱秒级回放，完全兼容前端流式协议。
    return ndjsonStream(async (send) => {
      send({ type: "stage", key: "reason", status: "start" });
      send({ type: "token", kind: "content", text: `⚡ 已从持久缓存命中此前关于“${trend}”的产业链拆解结果（图谱为低频静态数据）...\n\n` });
      send({ type: "stage", key: "reason", status: "done" });
      send({ type: "stage", key: "summary", status: "start" });
      send({ type: "stage", key: "summary", status: "done" });
      send({ type: "result", map: cachedMap.value });
      send({ type: "done" });
    });
  }

  const { system, user } = buildMapPrompt(trend);

  return ndjsonStream(async (send) => {
    // Stage 1: stream the LLM's supply-chain reasoning token-by-token.
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
        send({ type: "error", message: `AI 产业链拆解失败：${e instanceof Error ? e.message : e}` });
      }
      return;
    }
    advanceToSummary();

    // Stage 2: parse + normalize into the supply-chain map.
    try {
      const raw = parseJsonObject<{ summary?: string; nodes?: SupplyChainNode[] }>(splitter.jsonText);
      const map: SupplyChainMap = {
        trend,
        summary: raw.summary || "",
        nodes: (raw.nodes ?? []).map((n) => ({
          layer: n.layer || "",
          role: n.role || "",
          isChokepoint: Boolean(n.isChokepoint),
          chokepointReason: n.chokepointReason,
          bomRatio: n.bomRatio || "",
          bomDetail: n.bomDetail || "",
          tickers: (n.tickers ?? []).map((t) => ({
            code: t.code || "",
            name: t.name || "",
            note: t.note || "",
          })),
        })),
        disclaimer:
          "本图由 AI 依据 Serenity 瓶颈点方法生成，公司/代码可能有误。" + NFA,
      };
      send({ type: "result", map });

      // 落盘持久缓存：产业链结构是低频稳定数据，默认缓存 7 天且重启不丢。失败不阻断。
      try {
        await setPersistent(MAP_CACHE_NS, cacheKey, map, ttlMs);
      } catch (e) {
        console.warn("[map] 图谱缓存写入失败:", e instanceof Error ? e.message : e);
      }

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
