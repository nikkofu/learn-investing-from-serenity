import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { deriveStats, getKlineSafe, getQuote } from "@/lib/market";
import { calculateChipDistribution, runTraditionalMaBacktest, runChokepointMomentumBacktest, analyzeTechnicalPatterns, generatePriceProjection } from "@/lib/quant";
import { buildAnalyzePrompt } from "@/lib/serenity";
import { chatStream, LLMNotConfiguredError, parseJsonObject } from "@/lib/llm";
import { finalizeAssessment } from "@/lib/chokepoint";
import { ndjsonStream } from "@/lib/stream";
import { NarrativeJsonSplitter } from "@/lib/split";
import type { ChokepointAssessment } from "@/lib/types";
import { globalCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

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
  const body = (await req.json()) as { code?: string; context?: string };
  const code = body.code?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }

  return ndjsonStream(async (send) => {
    const tStart = performance.now();

    // Stage 1: fetch market data (the "tool call").
    const tQuoteStart = performance.now();
    send({ type: "stage", key: "quote", status: "start" });
    let quote, candles, stats;
    try {
      [quote, candles] = await Promise.all([getQuote(code), getKlineSafe(code, 360)]);
      stats = deriveStats(candles);
    } catch (e) {
      send({ type: "error", message: `行情获取失败：${e instanceof Error ? e.message : e}` });
      return;
    }
    send({ type: "quote", quote, stats });
    const quoteElapsed = performance.now() - tQuoteStart;
    send({ type: "stage", key: "quote", status: "done", elapsedMs: quoteElapsed });

    // Stage 1.5: 检索匹配 Serenity 本地知识库
    const matchedKnowledge = await findSerenityKnowledge(code, quote.name);

    // Stage 2: stream the LLM's chokepoint reasoning token-by-token.
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
    // Advance reason -> summary as soon as the (hidden) JSON phase begins, so the
    // UI never looks stuck while the model silently writes the structured result.
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
        send({ type: "error", message: `AI 分析失败：${e instanceof Error ? e.message : e}` });
      }
      return;
    }
    advanceToSummary();

    // Stage 3: parse + normalize into the structured assessment.
    const tSummaryStart = performance.now();
    try {
      const raw = parseJsonObject<Partial<ChokepointAssessment>>(splitter.jsonText);
      const assessment = finalizeAssessment(raw);
      
      // 解析 BOM 和六步工作流额外数据
      if (raw.bomPosition) {
        assessment.bomPosition = {
          nodeName: raw.bomPosition.nodeName || "",
          bomRatio: raw.bomPosition.bomRatio || "",
          role: raw.bomPosition.role || "",
        };
      } else {
        assessment.bomPosition = null;
      }
      
      if (raw.workflowSteps) {
        assessment.workflowSteps = raw.workflowSteps.map((s) => ({
          step: Number(s.step),
          title: s.title || "",
          content: s.content || "",
        }));
      } else {
        assessment.workflowSteps = [];
      }
      
      const chips = calculateChipDistribution(candles, quote.price);
      const traditionalBacktest = runTraditionalMaBacktest(candles);
      const chokepointBacktest = runChokepointMomentumBacktest(candles, assessment.totalScore);
      const technical = analyzeTechnicalPatterns(candles, quote.price, chips);
      const projections = generatePriceProjection(candles, assessment.totalScore);
      
      const summaryElapsed = performance.now() - tSummaryStart;
      const totalElapsed = performance.now() - tStart;

      send({ 
        type: "result", 
        quote, 
        stats, 
        assessment, 
        matchedKnowledge,
        quant: { 
          chips, 
          backtest: chokepointBacktest, 
          backtests: {
            traditional: traditionalBacktest,
            chokepoint: chokepointBacktest
          },
          technical, 
          candles,
          projections
        },
        timings: {
          quoteMs: quoteElapsed,
          reasonMs: reasonElapsed,
          summaryMs: summaryElapsed,
          totalMs: totalElapsed
        }
      });
      send({ type: "stage", key: "summary", status: "done", elapsedMs: summaryElapsed });
      send({ type: "done" });
    } catch {
      send({
        type: "error",
        message: "AI 输出解析失败（模型未返回有效 JSON），可重试或换一个能力更强的模型。",
      });
    }
  });
}
