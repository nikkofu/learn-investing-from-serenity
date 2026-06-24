import { NextResponse } from "next/server";
import { getKlineName } from "@/lib/sources";
import { chatJson, LLMNotConfiguredError } from "@/lib/llm";

export const dynamic = "force-dynamic";

const SYSTEM = `你是资深统计套利交易员。给定一个「协整配对 + 当前价差 z 偏离」的套利机会，
用可证伪的方式做解读：只基于给定的统计量推理，不臆造基本面，明确给出「在什么情况下判定逻辑失效」。
严格只输出一个 JSON 对象，结构如下（值都用简体中文，控制字数）：
{
  "thesis": "一句话核心逻辑：为何这是一个均值回归机会（≤80字）",
  "entryLogic": "为何现在可入场：结合 z 偏离方向与幅度（≤80字）",
  "revertCatalyst": "价差可能回归的统计依据：半衰期/平稳性（≤80字）",
  "risks": ["风险点1（≤30字）", "风险点2（≤30字）"],
  "invalidation": "可证伪条件：什么情况判定协整失效、应止损离场（≤60字）",
  "hedgeability": "A股落地与可对冲性评估：融券/两融/ETF 替代、双边成本（≤60字）"
}
口径说明：
- side=long-spread 表示「做多 A / 做空 B」（价差偏低，预期回升）；short-spread 表示「做空 A / 做多 B」（价差偏高，预期回落）。
- z 为价差标准化偏离，|z| 越大越极端；半衰期越短回归越快；ADF-t 越负协整越强。
- 务必诚实：A 股融券受限，多数标的难以做空，应如实指出落地约束，不夸大可投资性。
- 不要输出 JSON 以外的任何文字、解释或 markdown 代码块。`;

interface InterpretBody {
  a?: string;
  b?: string;
  z?: number;
  side?: string;
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
  const dir = side === "long-spread" ? `做多 ${nameA}(${a}) / 做空 ${nameB}(${b})` : `做空 ${nameA}(${a}) / 做多 ${nameB}(${b})`;

  const user = `套利机会（统计量如下）：
配对：A=${nameA}(${a})，B=${nameB}(${b})
方向：${side}（即 ${dir}）
对冲比例 β（A 对 B）：${(body.beta ?? 0).toFixed(3)}
价差当前 z 偏离：${(body.z ?? 0).toFixed(2)}
相关性：${(body.correlation ?? 0).toFixed(2)}
协整 ADF-t：${(body.adfT ?? 0).toFixed(2)}
半衰期：${(body.halfLifeDays ?? 0).toFixed(1)} 天
预计回归天数：${body.expectedRevertDays ?? "未知"} 天
双边成本后估算净收益：${(body.estNetPct ?? 0).toFixed(2)}%
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
