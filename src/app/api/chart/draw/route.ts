import { NextResponse } from "next/server";
import { getKlineFailover, getKlineName, type FqMode } from "@/lib/sources";
import { chatJson, LLMNotConfiguredError } from "@/lib/llm";
import { sanitizeDrawPlan, DRAW_PRESETS, type DrawPlan } from "@/lib/drawings";

export const dynamic = "force-dynamic";

const SYSTEM = `你是资深 A 股技术分析师。基于给定的 K 线数据，把你的技术分析意图输出为一组「绘图基元」JSON，供前端在专业图表上渲染。
严格只输出 JSON 对象，形如：
{
  "rationale": "一句话中文说明你的整体判断（≤120字）",
  "drawings": [
    { "type": "hline", "price": 数字, "label": "短标签", "color": "support|resistance|neutral" },
    { "type": "trendline", "from": {"date":"YYYY-MM-DD","price":数字}, "to": {"date":"YYYY-MM-DD","price":数字}, "label": "短标签", "color": "bull|bear|neutral" },
    { "type": "zone", "priceLow": 数字, "priceHigh": 数字, "label": "短标签", "color": "support|resistance|neutral" },
    { "type": "marker", "date": "YYYY-MM-DD", "price": 数字, "text": "≤8字", "color": "bull|bear|neutral" },
    { "type": "pattern", "shape": "triangle|wedge|flag|channel|head_shoulders|double_top|double_bottom|trendline", "closed": true, "points": [ {"date":"YYYY-MM-DD","price":数字} ], "label": "短标签", "color": "bull|bear|neutral" }
  ]
}
规则：
- 价位必须落在给定数据的真实波动范围内；日期必须取自给定 K 线的交易日。
- 绘图基元总数不超过 10 条，宁缺毋滥，只画有依据的关键位。
- 【关键】当你识别出一个有名字的「形态」（三角形/楔形/旗形/通道/头肩顶底/双顶双底等），必须用 pattern 基元把定义该形态的几何边界**按顺序连点画出来**，而不是只给一条横线：
  · 上升三角形：points 依次给「下沿抬高的低点们 + 上沿水平阻力的高点们」（约 4~6 个点，closed 设 true 形成闭合三角），color 用 bull；下降三角形同理 color 用 bear；
  · 楔形/旗形/通道：points 给上下两条边的端点（closed 设 true）；
  · 头肩顶/底：points 依次连「左肩-头-右肩」的顶/底（closed 设 false），再用 hline 或 trendline 画颈线；
  · 双顶/双底：用两个 marker 标两个顶/底 + 一条 hline 颈线 + 一个 zone 支撑/阻力带（可不必给 pattern）。
- pattern.points 至少 2 个点（闭合形态至少 3 个）；点的顺序就是连线顺序，按你想画出的边界顺序给出。
- 【同形态同色】同一个形态相关的所有基元（pattern/线/点/带）必须使用同一个 color，便于用户一眼看出它们同属一个形态。
- color 语义：support=支撑/看多锚点，resistance=阻力，bull=偏多，bear=偏空，neutral=中性。
- 不要输出 JSON 以外的任何文字、解释或 markdown 代码块。`;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      code?: string;
      fq?: string;
      period?: string;
      question?: string;
      preset?: string;
    };
    const code = body.code?.trim();
    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请提供 6 位有效的股票代码" }, { status: 400 });
    }

    const fq: FqMode = body.fq === "hfq" ? "hfq" : "qfq";
    const period = body.period === "1W" || body.period === "1M" ? body.period : "1D";
    const klt = period === "1W" ? 102 : period === "1M" ? 103 : 101;

    const preset = DRAW_PRESETS.find((p) => p.key === body.preset);
    const question = (body.question?.trim() || preset?.question || DRAW_PRESETS[0].question).slice(0, 500);

    const candles = await getKlineFailover(code, 200, klt, fq);
    if (candles.length === 0) {
      return NextResponse.json({ error: "无法获取该标的的 K 线数据" }, { status: 502 });
    }

    // 只喂最近 ~90 根，控制 token；给出范围与现价帮助模型锚定。
    const recent = candles.slice(-90);
    const lo = Math.min(...candles.map((c) => c.low));
    const hi = Math.max(...candles.map((c) => c.high));
    const last = candles[candles.length - 1];
    const name = getKlineName(code) || code;
    const lines = recent.map((c) => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("\n");

    const user = `标的：${name}（${code}） 周期：${period} 复权：${fq === "hfq" ? "后复权" : "前复权"}
全样本价格区间：最低 ${lo.toFixed(2)}，最高 ${hi.toFixed(2)}；最新收盘 ${last.close.toFixed(2)}（${last.date}）。
最近 ${recent.length} 根 K 线（date,open,high,low,close）：
${lines}

用户诉求：${question}

请只输出符合规范的 JSON。日期请从上面的交易日中选取，价位落在区间内。`;

    let plan: DrawPlan;
    try {
      const raw = await chatJson<unknown>(SYSTEM, user, { temperature: 0.3 });
      plan = sanitizeDrawPlan(raw, candles);
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) {
        return NextResponse.json({ error: "LLM 未配置：请在「设置」填入 provider / base URL / model / API key。" }, { status: 503 });
      }
      throw e;
    }

    return NextResponse.json({ plan, period, fq, question });
  } catch (error) {
    console.error("AI 画图失败:", error);
    return NextResponse.json(
      { error: `AI 画图失败: ${error instanceof Error ? error.message : error}` },
      { status: 500 }
    );
  }
}
