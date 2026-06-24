import { NextResponse } from "next/server";
import { getKlineName } from "@/lib/sources";
import { chatJson, LLMNotConfiguredError } from "@/lib/llm";

export const dynamic = "force-dynamic";

const SYSTEM = `你是资深统计套利交易员，但你解读的是「A 股主板、纯多头、单边可执行」的相对强弱择时信号——
不是无风险对冲套利。A 股主板无融券，配对的两腿不能同时做多做空，因此只取「相对其协整伙伴被低估、可单边买入」的那一只来解读。
用可证伪的方式：只基于给定的统计量推理，不臆造基本面，明确给出「在什么情况下判定逻辑失效」。
严格只输出一个 JSON 对象，结构如下（值都用简体中文，控制字数）：
{
  "thesis": "一句话核心逻辑：为何【买入腿】相对其协整伙伴被低估、统计上倾向均值回归（≤80字）",
  "entryLogic": "为何现在适合对【买入腿】逢低分批布局：结合 z 偏离方向与幅度（≤80字）",
  "revertCatalyst": "价差可能回归的统计依据：半衰期/平稳性（≤80字）",
  "risks": ["单边持有的下行风险1：如市场 β/系统性下跌（≤30字）", "风险点2（≤30字）"],
  "invalidation": "可证伪条件：什么情况判定协整失效、应止损离场（≤60字）",
  "hedgeability": "单边持有风险与落地：承担市场 β/方向风险、回归依赖配对关系不破裂，不是无风险对冲（≤60字）"
}
口径说明：
- 本信号已单边化：买入腿（buyCode）=相对被低估、对应「逢低分批布局」买入择时；规避腿（deRiskCode）=相对被高估、对应「减仓/规避」，仅持有者参考，不建空头。
- 不要使用「做多/做空价差」「融券对冲」「两融/ETF 替代」等对冲话术——主板单边不可对冲。
- z 为价差标准化偏离，|z| 越大越极端；半衰期越短回归越快；ADF-t 越负协整越强。
- 务必诚实：这是相对强弱择时而非无风险套利，单边持有承担市场 β 与方向风险，不夸大可投资性。
- 不要输出 JSON 以外的任何文字、解释或 markdown 代码块。`;

interface InterpretBody {
  a?: string;
  b?: string;
  z?: number;
  side?: string;
  buyCode?: string;
  deRiskCode?: string;
  beta?: number;
  correlation?: number;
  adfT?: number;
  halfLifeDays?: number;
  expectedRevertDays?: number;
  estNetPct?: number;
  nearStop?: boolean;
}

export interface ArbInterpretation {
  thesis: string;
  entryLogic: string;
  revertCatalyst: string;
  risks: string[];
  invalidation: string;
  hedgeability: string;
}

export async function POST(req: Request) {
  let body: InterpretBody = {};
  try {
    body = (await req.json()) as InterpretBody;
  } catch {
    /* 允许空 body */
  }
  const a = body.a?.trim();
  const b = body.b?.trim();
  if (!a || !b || !/^\d{6}$/.test(a) || !/^\d{6}$/.test(b)) {
    return NextResponse.json({ error: "请提供有效的配对代码 a/b（6 位）" }, { status: 400 });
  }
  const side = body.side === "short-spread" ? "short-spread" : "long-spread";
  const nameA = getKlineName(a) || a;
  const nameB = getKlineName(b) || b;
  // 单边化：买入腿=相对被低估的那只，规避腿=相对被高估的那只。
  const buyCode = body.buyCode && /^\d{6}$/.test(body.buyCode) ? body.buyCode : side === "long-spread" ? a : b;
  const deRiskCode = buyCode === a ? b : a;
  const buyName = getKlineName(buyCode) || buyCode;
  const deRiskName = getKlineName(deRiskCode) || deRiskCode;

  const user = `相对强弱择时信号（统计量如下，A 股主板纯多头、单边可执行）：
配对：A=${nameA}(${a})，B=${nameB}(${b})
买入腿（相对被低估，逢低分批布局）：${buyName}(${buyCode})
规避腿（相对被高估，减仓/规避，仅持有者参考）：${deRiskName}(${deRiskCode})
对冲比例 β（A 对 B，仅用于价差定义，不作两腿对冲）：${(body.beta ?? 0).toFixed(3)}
价差当前 z 偏离：${(body.z ?? 0).toFixed(2)}
相关性：${(body.correlation ?? 0).toFixed(2)}
协整 ADF-t：${(body.adfT ?? 0).toFixed(2)}
半衰期：${(body.halfLifeDays ?? 0).toFixed(1)} 天
预计回归天数：${body.expectedRevertDays ?? "未知"} 天
价差回归口径估算幅度：${(body.estNetPct ?? 0).toFixed(2)}%（仅供参考，非单边实际收益）
${body.nearStop ? "警告：当前 |z| 已逼近/越过止损阈，协整可能正在破裂。" : ""}

请输出符合规范的 JSON。`;

  try {
    const out = await chatJson<ArbInterpretation>(SYSTEM, user, { temperature: 0.3 });
    if (!out || typeof out.thesis !== "string") {
      return NextResponse.json({ error: "模型返回结构异常" }, { status: 502 });
    }
    const risks = Array.isArray(out.risks) ? out.risks.filter((r) => typeof r === "string").slice(0, 4) : [];
    return NextResponse.json({
      thesis: String(out.thesis).slice(0, 200),
      entryLogic: String(out.entryLogic ?? "").slice(0, 200),
      revertCatalyst: String(out.revertCatalyst ?? "").slice(0, 200),
      risks,
      invalidation: String(out.invalidation ?? "").slice(0, 160),
      hedgeability: String(out.hedgeability ?? "").slice(0, 160),
    });
  } catch (e) {
    if (e instanceof LLMNotConfiguredError) {
      return NextResponse.json({ error: "未配置大模型，请先到「设置」填写 provider/key" }, { status: 503 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `解读失败: ${msg}` }, { status: 502 });
  }
}
