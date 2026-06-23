import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { deriveStats, getQuoteFailover, getKlineFailover, getHfqDailyHistory, HISTORY_LIMIT, type FqMode } from "@/lib/sources";
import { calculateChipDistribution, runWalkForwardWinRate, analyzeTechnicalPatterns, generatePriceProjection } from "@/lib/quant";
import { runAllStrategies, pickDefaultResult, DEFAULT_STRATEGY_ID } from "@/lib/strategies";
import { buildAnalyzePrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { finalizeAssessment } from "@/lib/chokepoint";
import { runCriticReview, runChokepointReview, deriveWinRate, runSelfConsistencyVote } from "@/lib/agentWorkflow";
import { recordPrediction, getCalibrationSummary, type CalibrationSummary } from "@/lib/calibration";
import { ndjsonStream } from "@/lib/stream";
import { NarrativeJsonSplitter } from "@/lib/split";
import type { ChokepointAssessment } from "@/lib/types";
import { globalCache } from "@/lib/cache";
import { loadConfig } from "@/lib/config";
import { getCacheTTL } from "@/lib/cacheSettings";
import { getPersistent, setPersistent, fingerprint } from "@/lib/llmCache";
import {
  extractStatic,
  mergeStaticDynamic,
  runDynamicOverlay,
  STATIC_PROMPT_VERSION,
  type StaticAnalysis,
} from "@/lib/analysisCache";

export const dynamic = "force-dynamic";

const ANALYZE_CACHE_NS = "analyze";

/** 打分/筹码/技术形态等「近端」分析所用的窗口长度（保持原 360 根口径不变）。 */
const DISPLAY_WINDOW = 360;

/** 完整（缓存未命中）管线展示的阶段。 */
const FULL_STAGES = [
  { key: "quote", label: "获取行情数据（接口调用）" },
  { key: "reason", label: "AI 瓶颈点五因子推理（静态层）" },
  { key: "summary", label: "结构化汇总与打分" },
  { key: "vote", label: "自洽投票（多次打分取中位降方差）" },
  { key: "critic", label: "批判者复核（证伪 / 反方尽调）" },
  { key: "judge", label: "裁判调和（最终结论与置信度）" },
];

/** 缓存命中时展示的阶段：跳过昂贵推理，只刷新动态层。 */
const CACHED_STAGES = [
  { key: "quote", label: "获取行情数据（接口调用）" },
  { key: "cacheLoad", label: "⚡ 命中静态基本面缓存（秒级回放）" },
  { key: "dynamic", label: "实时行情动态推理（关注度/催化/区间）" },
  { key: "summary", label: "结构化汇总与打分" },
];

// 基于股票代码/名称，从本地知识库中动态匹配 Serenity 关联主题与一手推文
async function findSerenityKnowledge(code: string, name: string) {
  const cacheKey = `knowledge:match_v2:${code}:${name}`;
  return globalCache.getOrCreate(
    cacheKey,
    async () => {
      try {
        const knowledgePath = path.join(process.cwd(), "data", "serenity_knowledge.json");
        const postsPath = path.join(process.cwd(), ".data", "x-posts.json");
        
        const curatedRaw = await fs.readFile(knowledgePath, "utf8");
        const curated = JSON.parse(curatedRaw);
        
        let matchedTheme = null;
        let matchedSegment = "";
        
        // 1. 在 curated 知识库中寻找 A 股映射匹配
        if (curated && curated.themes) {
          for (const theme of curated.themes) {
            if (theme.aShareMapping) {
              for (const mapItem of theme.aShareMapping) {
                const hasCompany = mapItem.companies.some(
                  (c: any) => c.code === code || name.includes(c.name) || c.name.includes(name)
                );
                if (hasCompany) {
                  matchedTheme = theme;
                  matchedSegment = mapItem.segment;
                  break;
                }
              }
            }
            if (matchedTheme) break;
          }
        }
        
        if (!matchedTheme) return null;
        
        // 2. 匹配最相关的 X 推文
        let matchedTweets: { date: string; text: string }[] = [];
        try {
          const postsRaw = await fs.readFile(postsPath, "utf8");
          const postsData = JSON.parse(postsRaw);
          const posts = postsData.posts ?? [];
          
          const usTickers = new Set<string>(matchedTheme.usExamples ?? []);
          
          // 提取针对该细分环节可能对应的检索词
          const keywords: string[] = [];
          const segLower = matchedSegment.toLowerCase();
          if (segLower.includes("光模块") || segLower.includes("光组件") || segLower.includes("光通信")) {
            keywords.push("optical", "transceiver", "cpo", "laser", "sive", "lite");
          } else if (segLower.includes("芯片") || segLower.includes("半导体") || segLower.includes("材料")) {
            keywords.push("chip", "semi", "substrate", "inp", "axti", "wafer", "iqe");
          } else if (segLower.includes("减速器") || segLower.includes("丝杠") || segLower.includes("机器人")) {
            keywords.push("robot", "harmonic", "gear", "actuator", "sanhua");
          } else if (segLower.includes("铜缆") || segLower.includes("连接器")) {
            keywords.push("cable", "copper", "connector", "aec", "foci");
          } else if (segLower.includes("存储")) {
            keywords.push("hbm", "memory", "dram", "towa");
          } else if (segLower.includes("液冷") || segLower.includes("温控")) {
            keywords.push("cool", "thermal", "liquid");
          }
          
          for (const post of posts) {
            const textLower = post.text.toLowerCase();
            let matches = false;
            
            // 匹配美股 ticker 关联
            if (post.tickers && post.tickers.some((t: string) => usTickers.has(t))) {
              matches = true;
            }
            
            // 匹配行业细分关键字
            if (!matches && keywords.some(k => textLower.includes(k))) {
              matches = true;
            }
            
            if (matches) {
              // 裁剪掉 show more 之后的推文残留以保持 Prompt 整洁
              const cleanText = post.text.replace(/\nShow more\nQuote[\s\S]*/i, "").trim();
              matchedTweets.push({
                date: post.date,
                text: cleanText
              });
            }
          }
          
          // 优先级：BOM 或 chokepoint 硬核分析词汇排在最前
          matchedTweets.sort((a, b) => {
            const aScore = /bom|chokepoint|bottleneck|margin|capacity/i.test(a.text) ? 1 : 0;
            const bScore = /bom|chokepoint|bottleneck|margin|capacity/i.test(b.text) ? 1 : 0;
            return bScore - aScore;
          });
          
          matchedTweets = matchedTweets.slice(0, 3);
        } catch {
          // 忽略 x-posts.json 报错以防运行中断
        }
        
        return {
          themeName: matchedTheme.name,
          themeThesis: matchedTheme.thesis,
          tweets: matchedTweets
        };
      } catch {
        return null;
      }
    },
    10 * 60 * 1000 // 缓存关系映射结果 10 分钟，大幅降低频繁文件读取
  );
}

export async function POST(req: Request) {
  const body = (await req.json()) as { code?: string; context?: string; refresh?: boolean; fq?: string };
  const code = body.code?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }
  // 复权口径：qfq=前复权（贴现价，看操作）/ hfq=后复权（长周期真实回测）。决定筹码/交易标记/回测/投影的统一口径。
  const fq: FqMode = body.fq === "hfq" ? "hfq" : "qfq";

  return ndjsonStream(async (send) => {
    const tStart = performance.now();

    // Stage 1: fetch market data (the "tool call").
    const tQuoteStart = performance.now();
    send({ type: "stage", key: "quote", status: "start" });
    let quote, candles, candlesFull, backtestCandles, stats;
    // 展示/量化口径序列：前复权 = 与 AI 口径一致；后复权 = 仅用于筹码/交易标记/回测/投影，AI 打分仍走前复权（基本面与绝对价位无关）。
    let dispCandles, dispBacktestCandles, dispRefPrice: number;
    try {
      // 打分/筹码/技术形态用前复权近端窗口（贴合现价，口径不变）。
      [quote, candlesFull] = await Promise.all([getQuoteFailover(code), getKlineFailover(code, HISTORY_LIMIT)]);
      candles = candlesFull.slice(-DISPLAY_WINDOW);
      stats = deriveStats(candles);
      // 关键修复：前复权（减式除权）对高分红老股拉到早年会把价格压成负数（如五粮液/茅台早年 < 0），
      // 直接喂回测会算出 -2600% 这类失真收益。这里裁掉非正价坏 bar，只在「前复权有效正价区间」内回测、画图、
      // 算筹码——这样交易标记、理由文案（内嵌价位）、筹码定位、现价口径全程一致，且彻底消除负价失真。
      // （注：负价是源数据前复权的固有现象，正价区间内的前复权是业界通行的回测口径。）
      backtestCandles = candlesFull.filter((c) => c.close > 0 && c.open > 0 && c.high > 0 && c.low > 0);

      // 默认前复权口径（与 AI 打分一致）。
      dispBacktestCandles = backtestCandles;
      dispCandles = candles;
      dispRefPrice = quote.price;
      // 后复权口径：早年价不为负、长周期收益正确（彻底解决五粮液/茅台类）。仅东财 fqt=2，失败则回退前复权。
      if (fq === "hfq") {
        const hfqFull = (await getHfqDailyHistory(code)).filter((c) => c.close > 0 && c.open > 0 && c.high > 0 && c.low > 0);
        if (hfqFull.length > 0) {
          dispBacktestCandles = hfqFull;
          dispCandles = hfqFull.slice(-DISPLAY_WINDOW);
          dispRefPrice = hfqFull[hfqFull.length - 1]?.close ?? quote.price;
        }
      }
    } catch (e) {
      send({ type: "error", message: `行情获取失败：${e instanceof Error ? e.message : e}` });
      return;
    }
    send({ type: "quote", quote, stats });
    const quoteElapsed = performance.now() - tQuoteStart;
    send({ type: "stage", key: "quote", status: "done", elapsedMs: quoteElapsed });

    // Stage 1.5: 检索匹配 Serenity 本地知识库
    const matchedKnowledge = await findSerenityKnowledge(code, quote.name);

    // ── 静态/动态拆分：静态层（基本面/产业链/护城河，一周内不变）走持久化缓存，
    // 命中即跳过昂贵的主推理 + 自洽投票 + Critic + Judge；动态层（关注度/催化/买卖区间）
    // 每次都用当日行情实时刷新。知识库变化 / 自定义 context / 提示词版本变化都会让 key 改变从而自动失效。
    const cfg = await loadConfig();
    const model = cfg?.model ?? "unknown";
    const keyFp = fingerprint({ knowledge: matchedKnowledge, context: body.context ?? "" });
    const cacheKey = `v${STATIC_PROMPT_VERSION}:${code}:${model}:${keyFp}`;
    const ttlMs = getCacheTTL("analysisFundamental", true);
    const cached = body.refresh ? null : await getPersistent<StaticAnalysis>(ANALYZE_CACHE_NS, cacheKey);
    const usingCache = Boolean(cached && cached.value.promptVersion === STATIC_PROMPT_VERSION);

    send({ type: "stages", stages: usingCache ? CACHED_STAGES : FULL_STAGES });

    let assessment: ChokepointAssessment;
    let reasonElapsed = 0;
    let positioning = "";

    if (usingCache && cached) {
      // ── 命中缓存路径：秒级回放静态叙事 + 一次轻量动态推理。
      const staticAnalysis = cached.value;
      const tCache = performance.now();
      send({ type: "stage", key: "cacheLoad", status: "start" });
      if (staticAnalysis.narrative) send({ type: "token", kind: "content", text: staticAnalysis.narrative });
      send({ type: "stage", key: "cacheLoad", status: "done", elapsedMs: performance.now() - tCache });

      const tDyn = performance.now();
      send({ type: "stage", key: "dynamic", status: "start" });
      const overlay = await runDynamicOverlay({ quote, stats, staticAnalysis });
      const merged = mergeStaticDynamic(staticAnalysis, overlay);
      assessment = merged.assessment;
      positioning = merged.positioning;
      reasonElapsed = performance.now() - tDyn;
      send({ type: "stage", key: "dynamic", status: "done", elapsedMs: reasonElapsed });
      send({ type: "stage", key: "summary", status: "start" });
    } else {
      // ── 缓存未命中路径：跑完整管线（与原行为一致），算完后把静态层落盘。
      const { system, user } = buildAnalyzePrompt({
        quote,
        candles,
        stats,
        extraContext: body.context,
        matchedKnowledge,
      });
      const tReasonStart = performance.now();
      send({ type: "stage", key: "reason", status: "start" });
      const splitter = new NarrativeJsonSplitter();
      let narrativeAcc = "";
      let advanced = false;
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

      let computed: ChokepointAssessment;
      try {
        const raw = parseJsonObject<Partial<ChokepointAssessment>>(splitter.jsonText);
        computed = finalizeAssessment(raw);

        // 解析 BOM 和六步工作流额外数据
        if (raw.bomPosition) {
          computed.bomPosition = {
            nodeName: raw.bomPosition.nodeName || "",
            bomRatio: raw.bomPosition.bomRatio || "",
            role: raw.bomPosition.role || "",
          };
        } else {
          computed.bomPosition = null;
        }

        if (raw.workflowSteps) {
          computed.workflowSteps = raw.workflowSteps.map((s) => ({
            step: Number(s.step),
            title: s.title || "",
            content: s.content || "",
          }));
        } else {
          computed.workflowSteps = [];
        }
      } catch {
        send({
          type: "error",
          message: "AI 输出解析失败（模型未返回有效 JSON），可重试或换一个能力更强的模型。",
        });
        return;
      }

      // Stage 3.5: 自洽投票（self-consistency）：多次独立打分取每因子中位数，降单趟方差。
      try {
        const extraRuns = Number(process.env.SELF_CONSISTENCY_RUNS ?? 2);
        if (Number.isFinite(extraRuns) && extraRuns > 0) {
          send({ type: "stage", key: "vote", status: "start" });
          const vote = await runSelfConsistencyVote({ quote, stats, assessment: computed, extraRuns });
          computed.factors = vote.factors;
          computed.totalScore = vote.totalScore;
          computed.selfConsistency = vote.info;
          send({ type: "stage", key: "vote", status: "done" });
        }
      } catch (e) {
        send({ type: "stage", key: "vote", status: "done" });
        console.warn("[analyze] 自洽投票降级（保留单趟打分）:", e instanceof Error ? e.message : e);
      }

      // Stage 4: Critic(Reflection) → Judge 复核工作流。
      try {
        send({ type: "stage", key: "critic", status: "start" });
        const critique = await runCriticReview({ quote, stats, assessment: computed });
        send({ type: "stage", key: "critic", status: "done" });
        send({ type: "stage", key: "judge", status: "start" });
        const review = await runChokepointReview({ quote, stats, assessment: computed, critique });
        computed.factors = review.factors;
        computed.totalScore = review.totalScore;
        computed.verdict = review.verdict;
        computed.recommendedBuy = review.recommendedBuy;
        if (review.buyPriceRange !== undefined) computed.buyPriceRange = review.buyPriceRange;
        if (review.sellPriceRange !== undefined) computed.sellPriceRange = review.sellPriceRange;
        computed.finalConfidence = review.finalConfidence;
        computed.critique = review.critique;
        computed.adjusted = review.adjusted;
        send({ type: "stage", key: "judge", status: "done" });
      } catch (e) {
        send({ type: "stage", key: "critic", status: "done" });
        send({ type: "stage", key: "judge", status: "done" });
        console.warn("[analyze] 复核工作流降级（保留初评）:", e instanceof Error ? e.message : e);
      }

      assessment = computed;

      // 把静态层（基本面/产业链/工作流叙事）落盘，供后续一周内秒级命中。失败不阻断。
      try {
        const staticPayload = extractStatic(assessment, narrativeAcc, matchedKnowledge?.themeName);
        await setPersistent(ANALYZE_CACHE_NS, cacheKey, staticPayload, ttlMs);
      } catch (e) {
        console.warn("[analyze] 静态层缓存写入失败:", e instanceof Error ? e.message : e);
      }
    }

    // ── 共享尾段：量化计算 + 校准 + 结果下发。
    const tSummaryStart = performance.now();
    // 量化层（筹码/回测/交易标记/技术形态/投影）统一走所选复权口径序列；现价基准用该序列口径（hfq 用其末根收盘价）。
    const chips = calculateChipDistribution(dispCandles, dispRefPrice);
    const strategies = runAllStrategies(dispBacktestCandles, { chokepointScore: assessment.totalScore, code: quote.code });
    const defaultBacktest = pickDefaultResult(strategies)!;
    const traditionalBacktest = strategies.find((s) => s.meta.id === "traditional-ma")?.result ?? defaultBacktest;
    const walkForward = runWalkForwardWinRate(dispBacktestCandles);
    assessment.winRate = deriveWinRate(walkForward, defaultBacktest);
    const technical = analyzeTechnicalPatterns(dispCandles, dispRefPrice, chips);
    const projections = generatePriceProjection(dispCandles, assessment.totalScore);

    let calibration: CalibrationSummary | null = null;
    try {
      await recordPrediction({
        code: quote.code,
        name: quote.name,
        date: new Date().toISOString().slice(0, 10),
        totalScore: assessment.totalScore,
        recommendedBuy: assessment.recommendedBuy ?? false,
        confidence: assessment.finalConfidence ?? assessment.totalScore / 100,
        winRate: assessment.winRate?.value,
      });
      calibration = await getCalibrationSummary();
    } catch (e) {
      console.warn("[analyze] 校准记录失败:", e instanceof Error ? e.message : e);
    }

    const summaryElapsed = performance.now() - tSummaryStart;
    const totalElapsed = performance.now() - tStart;

    send({
      type: "result",
      quote,
      stats,
      assessment,
      matchedKnowledge,
      calibration,
      cache: {
        hit: usingCache,
        createdAt: usingCache && cached ? cached.createdAt : Date.now(),
        ttlMs,
        positioning,
      },
      quant: {
        chips,
        backtest: defaultBacktest,
        backtests: {
          traditional: traditionalBacktest,
          chokepoint: defaultBacktest,
        },
        strategies,
        defaultStrategyId: DEFAULT_STRATEGY_ID,
        technical,
        candles: dispBacktestCandles,
        projections,
        fq,
        refPrice: dispRefPrice,
      },
      timings: {
        quoteMs: quoteElapsed,
        reasonMs: reasonElapsed,
        summaryMs: summaryElapsed,
        totalMs: totalElapsed,
      },
    });
    send({ type: "stage", key: "summary", status: "done", elapsedMs: summaryElapsed });
    send({ type: "done" });
  });
}
