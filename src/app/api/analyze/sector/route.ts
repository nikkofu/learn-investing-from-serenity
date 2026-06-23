import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { buildSectorAnalyzePrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { ndjsonStream } from "@/lib/stream";
import { NarrativeJsonSplitter } from "@/lib/split";
import { globalCache, getAdaptiveTTL } from "@/lib/cache";
import { emClist } from "@/lib/sources";
import { loadConfig } from "@/lib/config";
import { getCacheTTL } from "@/lib/cacheSettings";
import { getPersistent, setPersistent, fingerprint } from "@/lib/llmCache";

export const dynamic = "force-dynamic";

const SECTOR_CACHE_NS = "sector";
// 板块基本面研判提示词版本，变动时 +1 让旧缓存自然失效。
const SECTOR_PROMPT_VERSION = 1;

interface SectorAssessment {
  factors: { key: string; score: number; rationale: string }[];
  totalScore: number;
  verdict: string;
  thesis: string;
  chokepoints: unknown[];
  leaders: { code: string; name: string; role: string }[];
  risks: unknown[];
  catalysts: unknown[];
}

/** 落盘缓存的板块静态研判（结构/瓶颈/龙头一周内不变；实时资金流/涨跌幅每次重拉）。 */
interface SectorCachePayload {
  promptVersion: number;
  assessment: SectorAssessment;
  narrative: string;
}

// 模糊匹配行业板块在知识库中的关联主题
async function findSerenitySectorKnowledge(sectorName: string) {
  const cacheKey = `knowledge:sector:match:${sectorName}`;
  return globalCache.getOrCreate(
    cacheKey,
    async () => {
      try {
        const knowledgePath = path.join(process.cwd(), "data", "serenity_knowledge.json");
        const curatedRaw = await fs.readFile(knowledgePath, "utf8");
        const curated = JSON.parse(curatedRaw);

        if (curated && curated.themes) {
          for (const theme of curated.themes) {
            const themeLower = theme.name.toLowerCase();
            const sectorLower = sectorName.toLowerCase();

            let matched = false;
            if (themeLower.includes(sectorLower) || sectorLower.includes(themeLower)) {
              matched = true;
            } else if (theme.aShareMapping) {
              for (const mapItem of theme.aShareMapping) {
                if (
                  mapItem.segment.toLowerCase().includes(sectorLower) ||
                  sectorLower.includes(mapItem.segment.toLowerCase())
                ) {
                  matched = true;
                  break;
                }
              }
            }

            if (matched) {
              let matchedTweets: { date: string; text: string }[] = [];
              try {
                const postsPath = path.join(process.cwd(), ".data", "x-posts.json");
                const postsRaw = await fs.readFile(postsPath, "utf8");
                const postsData = JSON.parse(postsRaw);
                const posts = postsData.posts ?? [];
                const usTickers = new Set<string>(theme.usExamples ?? []);

                for (const post of posts) {
                  if (post.tickers && post.tickers.some((t: string) => usTickers.has(t))) {
                    const cleanText = post.text.replace(/\nShow more\nQuote[\s\S]*/i, "").trim();
                    matchedTweets.push({
                      date: post.date,
                      text: cleanText,
                    });
                  }
                }
                matchedTweets = matchedTweets.slice(0, 3);
              } catch {
                // Ignore
              }

              return {
                themeName: theme.name,
                themeThesis: theme.thesis,
                tweets: matchedTweets,
              };
            }
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    10 * 60 * 1000 // 缓存 10 分钟
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { code?: string; name?: string; refresh?: boolean };
    const code = body.code?.trim();
    const name = body.name?.trim();
    const refresh = body.refresh === true;

    if (!code || !/^BK\d+$/.test(code)) {
      return NextResponse.json({ error: "请提供有效的板块代码，如 BK1465" }, { status: 400 });
    }

    return ndjsonStream(async (send) => {
      const tStart = performance.now();

      // Stage 1: 获取板块及代表成分股行情
      const tQuoteStart = performance.now();
      send({ type: "stage", key: "quote", status: "start" });

      let sectorInfo: any = null;
      let stocksList: any[] = [];

      try {
        // 1. 获取所有行业板块列表，在其中匹配当前板块以获得 riseCount, fallCount, netInflow 等
        // 统一 clist 接口（push2delay 兜底 + 限流），替代直连 push2。
        const sectorListTTL = getAdaptiveTTL("sectors");
        
        const allSectors = await globalCache.getOrCreate(
          "market:sectors:all_raw",
          async () =>
            emClist({
              pn: 1, pz: 499, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
              fs: "m:90 t:2 f:!2",
              fields: "f2,f3,f12,f14,f62,f104,f105,f128,f140,f141",
            }),
          sectorListTTL
        );

        const matchedRaw = allSectors.find((s: any) => s.f12 === code);
        if (matchedRaw) {
          sectorInfo = {
            code,
            name: matchedRaw.f14 || name || "未知板块",
            price: matchedRaw.f2 != null && matchedRaw.f2 !== "-" ? Number(matchedRaw.f2) : 0,
            changePct: matchedRaw.f3 != null && matchedRaw.f3 !== "-" ? Number(matchedRaw.f3) : 0,
            netInflow: matchedRaw.f62 != null && matchedRaw.f62 !== "-" ? Number(matchedRaw.f62) : 0,
            riseCount: matchedRaw.f104 != null ? Number(matchedRaw.f104) : 0,
            fallCount: matchedRaw.f105 != null ? Number(matchedRaw.f105) : 0,
          };
        } else {
          // 兜底直接拉取
          sectorInfo = {
            code,
            name: name || "未知板块",
            price: 0,
            changePct: 0,
            netInflow: 0,
            riseCount: 0,
            fallCount: 0,
          };
        }

        // 2. 获取该板块涨幅居前的前 15 只成分股作为诊断上下文——统一 clist 接口。
        const stocksTTL = getAdaptiveTTL("sector-stocks");

        const rawStocks = await globalCache.getOrCreate(
          `market:sector-stocks:top15:${code}`,
          async () =>
            emClist({
              pn: 1, pz: 15, po: 1, np: 1, fltt: 2, invt: 2, fid: "f3",
              fs: `b:${code}`,
              fields: "f2,f3,f12,f14,f24",
            }),
          stocksTTL
        );

        stocksList = rawStocks.map((item: any) => ({
          code: item.f12 || "",
          name: item.f14 || "",
          price: item.f2 != null && item.f2 !== "-" ? Number(item.f2) : 0,
          changePct: item.f3 != null && item.f3 !== "-" ? Number(item.f3) : 0,
          turnoverPct: item.f24 != null && item.f24 !== "-" ? Number(item.f24) : 0,
        }));

      } catch (e) {
        send({ type: "error", message: `行情数据拉取失败: ${e instanceof Error ? e.message : e}` });
        return;
      }

      const quoteElapsed = performance.now() - tQuoteStart;
      send({ type: "stage", key: "quote", status: "done", elapsedMs: quoteElapsed });

      // Stage 1.5: 检索匹配 Serenity 本地知识库
      const matchedKnowledge = await findSerenitySectorKnowledge(sectorInfo.name);

      // 静态层缓存：板块结构/瓶颈/龙头一周内不变 → 命中即跳过 LLM，秒级回放研判。
      const cfg = await loadConfig();
      const model = cfg?.model ?? "unknown";
      const cacheKey = `v${SECTOR_PROMPT_VERSION}:${code}:${model}:${fingerprint(matchedKnowledge)}`;
      const ttlMs = getCacheTTL("sectorFundamental", true);
      const cached = refresh ? null : await getPersistent<SectorCachePayload>(SECTOR_CACHE_NS, cacheKey);

      if (cached && cached.value.promptVersion === SECTOR_PROMPT_VERSION) {
        const tCache = performance.now();
        send({ type: "stage", key: "reason", status: "start" });
        send({ type: "token", kind: "content", text: `⚡ 已命中板块基本面静态缓存（结构/瓶颈/龙头为低频数据），实时行情已刷新...\n\n` });
        if (cached.value.narrative) send({ type: "token", kind: "content", text: cached.value.narrative });
        send({ type: "stage", key: "reason", status: "done", elapsedMs: performance.now() - tCache });
        send({ type: "stage", key: "summary", status: "start" });
        send({
          type: "result",
          sectorInfo,
          matchedKnowledge,
          assessment: cached.value.assessment,
          cache: { hit: true, createdAt: cached.createdAt, ttlMs },
          timings: {
            quoteMs: quoteElapsed,
            reasonMs: performance.now() - tCache,
            summaryMs: 0,
            totalMs: performance.now() - tStart,
          },
        });
        send({ type: "stage", key: "summary", status: "done", elapsedMs: 0 });
        send({ type: "done" });
        return;
      }

      // Stage 2: 流式传输 LLM 板块研判
      const { system, user } = buildSectorAnalyzePrompt({
        sectorName: sectorInfo.name,
        sectorCode: sectorInfo.code,
        sectorPrice: sectorInfo.price,
        sectorChangePct: sectorInfo.changePct,
        sectorNetInflow: sectorInfo.netInflow,
        riseCount: sectorInfo.riseCount,
        fallCount: sectorInfo.fallCount,
        stocks: stocksList,
        matchedKnowledge,
      });

      const tReasonStart = performance.now();
      send({ type: "stage", key: "reason", status: "start" });
      const splitter = new NarrativeJsonSplitter();
      let narrativeAcc = "";
      let advanced = false;
      let reasonElapsed = 0;

      const advanceToSummary = () => {
        if (advanced) return;
        advanced = true;
        reasonElapsed = performance.now() - tReasonStart;
        send({ type: "stage", key: "reason", status: "done", elapsedMs: reasonElapsed });
        send({ type: "stage", key: "summary", status: "start" });
      };

      try {
        for await (const delta of chatStream(system, user)) {
          if (delta.kind === "reasoning") {
            send({ type: "token", kind: "reasoning", text: delta.text });
            continue;
          }
          const { narrative, structured } = splitter.push(delta.text);
          if (narrative) {
            narrativeAcc += narrative;
            send({ type: "token", kind: "content", text: narrative });
          }
          if (structured) send({ type: "token", kind: "structured", text: structured });
          if (splitter.inJsonPhase) advanceToSummary();
        }
        const tail = splitter.end();
        if (tail) {
          narrativeAcc += tail;
          send({ type: "token", kind: "content", text: tail });
        }
      } catch (e) {
        if (e instanceof LLMNotConfiguredError) {
          send({ type: "error", status: 412, message: e.message });
        } else {
          send({ type: "error", message: `AI 分析失败：${e instanceof Error ? e.message : e}` });
        }
        return;
      }
      advanceToSummary();

      // Stage 3: 解析并标准化板块研判结果
      const tSummaryStart = performance.now();
      try {
        const raw = parseJsonObject<any>(splitter.jsonText);

        const factors = (raw.factors || []).map((f: any) => ({
          key: f.key || "",
          score: f.score != null ? Number(f.score) : 0,
          rationale: f.rationale || "",
        }));

        const totalScore = Number(
          factors.reduce((sum: number, f: any) => {
            const weightMap: Record<string, number> = {
              demand: 0.2,
              supply: 0.3,
              attention: 0.15,
              valueCapture: 0.2,
              catalyst: 0.15,
            };
            const w = weightMap[f.key] || 0.2;
            return sum + f.score * w;
          }, 0).toFixed(2)
        );

        const assessment: SectorAssessment = {
          factors,
          totalScore,
          verdict: raw.verdict || "一般",
          thesis: raw.thesis || "",
          chokepoints: raw.chokepoints || [],
          leaders: (raw.leaders || []).map((l: any) => ({
            code: l.code || "",
            name: l.name || "",
            role: l.role || "",
          })),
          risks: raw.risks || [],
          catalysts: raw.catalysts || [],
        };

        // 落盘静态层研判，供一周内秒级命中。失败不阻断。
        try {
          await setPersistent<SectorCachePayload>(
            SECTOR_CACHE_NS,
            cacheKey,
            { promptVersion: SECTOR_PROMPT_VERSION, assessment, narrative: narrativeAcc },
            ttlMs,
          );
        } catch (e) {
          console.warn("[sector] 静态层缓存写入失败:", e instanceof Error ? e.message : e);
        }

        const summaryElapsed = performance.now() - tSummaryStart;
        const totalElapsed = performance.now() - tStart;

        send({
          type: "result",
          sectorInfo,
          matchedKnowledge,
          assessment,
          cache: { hit: false, createdAt: Date.now(), ttlMs },
          timings: {
            quoteMs: quoteElapsed,
            reasonMs: reasonElapsed,
            summaryMs: summaryElapsed,
            totalMs: totalElapsed,
          },
        });
        send({ type: "stage", key: "summary", status: "done", elapsedMs: summaryElapsed });
        send({ type: "done" });
      } catch {
        send({
          type: "error",
          message: "AI 输出解析失败（模型未返回符合规范的 JSON），可换用大模型重试。",
        });
      }
    });
  } catch (error) {
    console.error("流式板块研判错误:", error);
    return NextResponse.json({ error: "服务器内部异常" }, { status: 500 });
  }
}
