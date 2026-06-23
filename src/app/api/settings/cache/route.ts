import { NextResponse } from "next/server";
import {
  getCacheSettingsView,
  saveCacheSettings,
  resetCacheSettings,
  CACHE_CATEGORIES,
  type CacheCategory,
  type TTLPair,
} from "@/lib/cacheSettings";
import { globalCache } from "@/lib/cache";
import { clearNamespace, namespaceStats } from "@/lib/llmCache";

export const dynamic = "force-dynamic";

const MS = 1000;

// 落盘持久 LLM 缓存的命名空间（与各路由中的常量一致）。
const LLM_CACHE_NAMESPACES = ["analyze", "sector", "map"] as const;

/** ms TTLPair → 秒（界面用，便于人读）。 */
function pairToSec(p: TTLPair): { active: number; inactive: number } {
  return { active: Math.round(p.active / MS), inactive: Math.round(p.inactive / MS) };
}

/** GET：返回各类别标签/说明/默认值/当前值（单位：秒）+ 当前缓存统计（含落盘 LLM 缓存）。 */
export async function GET() {
  const categories = getCacheSettingsView().map((c) => ({
    category: c.category,
    label: c.label,
    desc: c.desc,
    default: pairToSec(c.default),
    current: pairToSec(c.current),
  }));
  const llmEntries = await Promise.all(
    LLM_CACHE_NAMESPACES.map(async (ns) => [ns, await namespaceStats(ns)] as const),
  );
  const llm = Object.fromEntries(llmEntries);
  const llmTotal = llmEntries.reduce(
    (acc, [, s]) => ({ total: acc.total + s.total, valid: acc.valid + s.valid }),
    { total: 0, valid: 0 },
  );
  return NextResponse.json({ categories, stats: globalCache.stats(), llm, llmTotal });
}

function secToMs(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return Math.round(v * MS);
}

/**
 * POST：按 action 处理
 *   - { action: "save", settings: { [category]: { active, inactive } } }（单位：秒）
 *   - { action: "reset" } 恢复默认
 *   - { action: "clear" } 清空进程内缓存
 */
export async function POST(req: Request) {
  let body: { action?: string; settings?: Record<string, { active?: number; inactive?: number }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const action = body.action ?? "save";

  if (action === "clear") {
    globalCache.clear();
    return NextResponse.json({ ok: true, cleared: true, stats: globalCache.stats() });
  }

  if (action === "clearLLM") {
    // 清空落盘的静态基本面缓存（下次访问会重新全量推理并重建缓存）。
    const cleared = await Promise.all(LLM_CACHE_NAMESPACES.map((ns) => clearNamespace(ns)));
    const total = cleared.reduce((a, b) => a + b, 0);
    return NextResponse.json({ ok: true, clearedLLM: total });
  }

  if (action === "reset") {
    await resetCacheSettings();
    return NextResponse.json({ ok: true, reset: true });
  }

  if (action === "save") {
    const input = body.settings ?? {};
    const overrides: Partial<Record<CacheCategory, Partial<TTLPair>>> = {};
    for (const cat of CACHE_CATEGORIES) {
      const v = input[cat];
      if (!v || typeof v !== "object") continue;
      const entry: Partial<TTLPair> = {};
      const a = secToMs(v.active);
      const i = secToMs(v.inactive);
      if (a !== undefined) entry.active = a;
      if (i !== undefined) entry.inactive = i;
      if (Object.keys(entry).length > 0) overrides[cat] = entry;
    }
    await saveCacheSettings(overrides);
    return NextResponse.json({ ok: true, saved: true });
  }

  return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
}
