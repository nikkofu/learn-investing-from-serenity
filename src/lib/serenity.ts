import type { ChokepointFactorKey, Candle, StockQuote } from "./types";

/**
 * Serenity's "Chokepoint / Bottleneck" investing method (瓶颈点投资法), distilled
 * into five scoring factors. Weights sum to 1.0.
 */
export const CHOKEPOINT_FACTORS: {
  key: ChokepointFactorKey;
  zh: string;
  en: string;
  weight: number;
  description: string;
}[] = [
  {
    key: "demand",
    zh: "确定需求",
    en: "Confirmed Demand",
    weight: 0.2,
    description:
      "下游趋势是否被验证、需求是否明确且持续（如 AI 算力、半导体国产替代）。需求越确定分越高。",
  },
  {
    key: "supply",
    zh: "受限供给",
    en: "Constrained Supply",
    weight: 0.3,
    description:
      "该环节是否“没它不行”、短期难以复制/替代（技术壁垒、产能瓶颈、寡头格局）。这是瓶颈点的核心。",
  },
  {
    key: "attention",
    zh: "低关注度",
    en: "Low Attention",
    weight: 0.15,
    description:
      "市场认知是否滞后、估值是否尚未充分反映。机构覆盖少、媒体冷门、股价未爆发时分高。",
  },
  {
    key: "valueCapture",
    zh: "价值捕获",
    en: "Value Capture",
    weight: 0.2,
    description:
      "公司能否真正赚到钱：定价权、毛利率、客户锁定、供应份额。能把瓶颈变现金流才算数。",
  },
  {
    key: "catalyst",
    zh: "催化剂",
    en: "Catalyst",
    weight: 0.15,
    description:
      "短中期是否有可验证事件触发价值重估：财报、客户量产、政策、指数纳入、并购、大额订单等。",
  },
];

export const SERENITY_WORKFLOW = [
  "找大趋势：确认一个确定性强、可持续的宏观叙事（AI 算力扩张、半导体自主可控）。",
  "画产业链地图：把趋势从下游终端一层层拆到上游材料/设备/零部件。",
  "识别真瓶颈：在产业链中找出供给最受限、最不可替代的“卡脖子”环节。",
  "找证据链：用财务、订单、产能、客户、技术壁垒等证据验证瓶颈的真实性。",
  "做好风控：警惕过拟合、追随者反身性、幸存者偏差；估值过高/逻辑被证伪即退出。",
  "匹配仓位：仓位大小与研究深度、确定性匹配，而非情绪。",
];

export const SERENITY_PROFILE = {
  handle: "@aleabitoreddit",
  alias: "Serenity / 白毛股神",
  bio: "AI/Semi Supply Chain Analyst. ex-RISC-V FDN, AI research scientist; now trading unknown bottlenecks.",
  coreIdea:
    "不直接买英伟达等终端巨头，而是沿确定性趋势（AI/半导体）拆解供应链，押注被忽视但不可替代、供给受限、尚未被充分定价的上游“瓶颈点(chokepoint)”环节。",
};

export const CHINA_CONTEXT = `本工具聚焦中国 A 股市场。应用 Serenity 的瓶颈点方法时，请特别考虑 A 股语境：
- 国产替代/自主可控 是 A 股最强的“确定需求 + 催化剂”来源（半导体设备、材料、EDA、光芯片、谐波减速器等）。
- A 股瓶颈环节常见于：光通信/光模块/光芯片、CPO/硅光、存储、PCB/覆铜板、半导体设备与零部件、先进封装、谐波减速器/机器人核心部件、液冷/电源、稀土永磁等。
- 关注“专精特新”、隐形冠军、单项冠军；这些往往是 A 股版本的 chokepoint。
- 催化剂还包括：政策(大基金、补贴)、龙头扩产招标、客户验证导入、北向资金、指数纳入。`;

const JSON_GUARD =
  "你必须只输出一个合法的 JSON 对象，不要包含 markdown 代码块标记、解释性文字或多余内容。";

/** Build messages for analyzing a single A-share through the chokepoint lens. */
export function buildAnalyzePrompt(args: {
  quote: StockQuote;
  candles: Candle[];
  stats: ReturnType<typeof import("./market").deriveStats>;
  extraContext?: string;
}) {
  const { quote, stats, extraContext } = args;
  const factorsDoc = CHOKEPOINT_FACTORS.map(
    (f) => `- ${f.key} (${f.zh} ${f.en}, 权重 ${f.weight}): ${f.description}`
  ).join("\n");

  const system = `你是 Serenity（白毛股神）投资方法论的 AI 分析助手。Serenity 的核心方法是“瓶颈点投资法(Chokepoint)”：${SERENITY_PROFILE.coreIdea}

${CHINA_CONTEXT}

你要对给定的 A 股标的，按照下面五个因子各打 0-5 分（0=完全不符合，5=极强符合），并给出一句中文理由（理由要尽量结合公司在产业链中的位置与给定行情数据，不要编造不存在的财务数字）：
${factorsDoc}

然后给出：verdict（用「隐形冠军 / 值得跟踪 / 一般 / 回避」之一并附半句话），thesis（120字内的 Serenity 风格瓶颈点论述），risks（2-4条风险），catalysts（2-4条潜在催化剂）。

${JSON_GUARD}
输出 JSON 结构：
{
  "factors": [{"key": "demand|supply|attention|valueCapture|catalyst", "score": 0-5, "rationale": "..."}],
  "verdict": "...",
  "thesis": "...",
  "risks": ["..."],
  "catalysts": ["..."]
}`;

  const dataBlock = {
    名称: quote.name,
    代码: quote.code,
    市场: quote.market,
    最新价: quote.price,
    涨跌幅百分比: quote.changePct,
    市盈率TTM: quote.pe,
    市净率: quote.pb,
    总市值元: quote.totalMarketCap,
    流通市值元: quote.floatMarketCap,
    换手率百分比: quote.turnoverPct,
    近窗口统计: stats,
  };

  const user = `请分析以下 A 股标的（行情快照，仅供定位，不代表完整基本面）：
${JSON.stringify(dataBlock, null, 2)}
${extraContext ? `\n补充背景：${extraContext}\n` : ""}
请严格按照瓶颈点五因子打分并输出 JSON。`;

  return { system, user };
}

/** Build messages for mapping a trend to an A-share supply chain + chokepoints. */
export function buildMapPrompt(trend: string) {
  const system = `你是 Serenity（白毛股神）瓶颈点投资法的 AI 产业链分析助手。
${SERENITY_PROFILE.coreIdea}

${CHINA_CONTEXT}

用户会给你一个趋势/主题。请按 Serenity 的方法把它拆成产业链分层（从下游终端到上游材料/设备），标注哪些层是“瓶颈点(chokepoint)”（供给受限、不可替代），并为每层给出有代表性的 A 股上市公司（用真实存在的公司名与6位代码；若不确定代码可留空字符串，但公司必须是真实的 A 股公司，绝不编造代码）。

${JSON_GUARD}
输出 JSON 结构：
{
  "summary": "一段话总结该趋势下最值得关注的瓶颈环节",
  "nodes": [
    {
      "layer": "层级名称(如 下游终端/光模块/光芯片/上游材料)",
      "role": "该层在产业链中的作用",
      "isChokepoint": true|false,
      "chokepointReason": "若是瓶颈，说明为何不可替代/供给受限",
      "tickers": [{"code": "6位代码或空串", "name": "公司名", "note": "为何相关"}]
    }
  ]
}`;
  const user = `趋势/主题：${trend}\n请输出该主题在 A 股的产业链瓶颈点地图 JSON。`;
  return { system, user };
}
