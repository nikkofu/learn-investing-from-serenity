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

/**
 * Two-phase output instruction: the model first reasons out loud in natural
 * language (streamed live to the user), then emits the final result inside a
 * ```json fence. `NarrativeJsonSplitter` shows the reasoning and hides the JSON.
 */
function twoPhaseGuard(schema: string): string {
  return `请分两步完成，并严格按顺序输出：

【第一步 · 实时推理】用中文自然语言把你的分析过程写出来（这部分会逐字实时展示给用户阅读，请像投研笔记一样有条理、简洁，不要冗长，禁止在这一步输出 JSON 或代码块）。

【第二步 · 结构化结果】推理结束后另起一行，仅用一个 \`\`\`json 代码块输出最终结果（代码块内必须是合法 JSON，且代码块外不要再写任何内容）：
\`\`\`json
${schema}
\`\`\``;
}

/** Build messages for analyzing a single A-share through the chokepoint lens. */
export function buildAnalyzePrompt(args: {
  quote: StockQuote;
  candles: Candle[];
  stats: ReturnType<typeof import("./market").deriveStats>;
  extraContext?: string;
  matchedKnowledge?: {
    themeName: string;
    themeThesis: string;
    tweets: { date: string; text: string }[];
  } | null;
}) {
  const { quote, stats, extraContext, matchedKnowledge } = args;
  const factorsDoc = CHOKEPOINT_FACTORS.map(
    (f) => `- ${f.key} (${f.zh} ${f.en}, 权重 ${f.weight}): ${f.description}`
  ).join("\n");

  const knowledgeDoc = matchedKnowledge ? `
【Serenity 一手知识库关联笔记】
已为您从本地知识库中匹配到与该股及细分环节最相关的 Serenity 一手研报与推文观点：
- 关联主题板块：${matchedKnowledge.themeName}
- 主题核心论述：${matchedKnowledge.themeThesis}
- Serenity 一手推文要点参考：
${matchedKnowledge.tweets.map((t, idx) => `  [推文 ${idx + 1}] (${t.date}): ${t.text}`).join("\n")}
请你在对该标的进行深度分析和各因子评分时，**高度参考并融入以上 Serenity 的一手研报观点**，确保推导结论具有一贯性。
` : "";

  const system = `你是 Serenity（白毛股神）投资方法论的 AI 分析助手。Serenity 的核心方法是“瓶颈点投资法(Chokepoint)”：${SERENITY_PROFILE.coreIdea}

${CHINA_CONTEXT}
${knowledgeDoc}

你要对给定的 A 股标的，按照下面五个因子各打 0.0 - 5.0 分（0.0=完全不符合，5.0=极强符合，最小打分单位可以到 0.1，如：3.5，1.8），并给出一句中文理由（理由要尽量结合公司在产业链中的位置与给定行情数据，不要编造不存在的财务数字）：
${factorsDoc}

【重要推理指令：严格执行六步工作流】
在第一步的实时推理里，请像投研日记一样有条理、简洁，并且**必须严格按照以下“六步工作流”的六个步骤顺序展开你的深度分析**：
1. 【找大趋势】：确认个股受益的宏观大趋势（如 AI 算力扩张、半导体国产替代等）。
2. 【画产业链地图】：拆解个股所处细分板块在整个产业链分层中的位置与作用。
3. 【识别真瓶颈】：深入剖析其主营产品是否具有高壁垒、低可替代性以及供给是否严重受限，即是否为真“卡脖子”环节。
4. 【找证据链】：用最新的基本面和财务快照、近 120 日价格区间位置（rangePosition）、换手率等证据，验证该瓶颈的真实性与估值合理性。
5. 【做好风控】：识别个股面临的主要风险点（警惕反身性回撤、竞争者挤出、逻辑证伪等）。
6. 【匹配仓位】：结合上述分析与价格区间位置（如底部刚刚启动、高位追高或逻辑证伪），给出明确的仓位配比与买卖建议（如“建议建底仓”、“等待突破加仓”、“回避观望”等）。

请在自然语言推理中写明这六个步骤名称，并在此基础上逐个说明五个因子的打分与理由。第二步再汇总成结构化 JSON。verdict 用「隐形冠军 / 值得跟踪 / 一般 / 回避」之一并附半句话，thesis 为120字内的 Serenity 风格瓶颈点论述，risks/catalysts 各 2-4 条，score 为 0.0 - 5.0 之间的数值，最小单位为 0.1（例如：3.5，2.8，1.0）。

${twoPhaseGuard(`{
  "factors": [{"key": "demand|supply|attention|valueCapture|catalyst", "score": "0.0-5.0之间的数值，精度0.1，如3.5", "rationale": "..."}],
  "verdict": "...",
  "thesis": "...",
  "risks": ["..."],
  "catalysts": ["..."],
  "recommendedBuy": true|false,
  "buyPriceRange": "建议买入价区间，如 xx.x-xx.x 元，若不符合可填空字串",
  "sellPriceRange": "建议卖出/止盈价区间，如 xx.x-xx.x 元，若不符合可填空字串",
  "bomPosition": {
    "nodeName": "该股票对应的 BOM 节点名称，例如：高速光模块 或 谐波减速器",
    "bomRatio": "该节点在对应终端 BOM 中的成本占比估算，例如：约 8% 或 25%-30%，若无法估算则填空字串",
    "role": "具体 BOM 作用描述"
  },
  "workflowSteps": [
    {
      "step": 1,
      "title": "找大趋势",
      "content": "具体的分析与论述..."
    },
    {
      "step": 2,
      "title": "画产业链地图",
      "content": "具体的分析与论述..."
    },
    {
      "step": 3,
      "title": "识别真瓶颈",
      "content": "具体的分析与论述..."
    },
    {
      "step": 4,
      "title": "找证据链",
      "content": "具体的分析与论述..."
    },
    {
      "step": 5,
      "title": "做好风控",
      "content": "具体的分析与论述..."
    },
    {
      "step": 6,
      "title": "匹配仓位",
      "content": "具体的分析与论述..."
    }
  ]
}`)}`;

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
请先实时写出五因子与六步工作流推理，再用 \`\`\`json 代码块输出结构化打分。`;

  return { system, user };
}

/** Build messages for mapping a trend to an A-share supply chain + chokepoints. */
export function buildMapPrompt(trend: string) {
  const system = `你是 Serenity（白毛股神）瓶颈点投资法的 AI 产业链分析助手。
${SERENITY_PROFILE.coreIdea}

${CHINA_CONTEXT}

用户会给你一个趋势/主题。请按 Serenity 的方法把它拆成产业链分层（从下游终端到上游材料/设备），标注哪些层是“瓶颈点(chokepoint)”（供给受限、不可替代），并为每层给出有代表性的 A 股上市公司（用真实存在的公司名与6位代码；若不确定代码可留空字符串，但公司必须是真实的 A 股公司，绝不编造代码）。
同时，请应用 Serenity 标志性的 BOM（物料清单）拆解技巧：
1. 对每个产业链分层节点，估算其在最终终端产品中所占的 BOM 成本占比百分比（BOM Ratio，例如“15% - 20%”或“约 8%”等）；
2. 详细列出该环节包含的子物料构成（BOM Detail，例如：“包含光探测器芯片（12%）、DSP电芯片（45%）、光路组件（15%）等”）。

在第一步的实时推理里，请按层级口语化地讲清楚“为什么这样拆、BOM 成本解构如何、哪一层才是真瓶颈、代表公司是谁”；第二步再汇总成结构化 JSON。

${twoPhaseGuard(`{
  "summary": "一段话总结该趋势下最值得关注的瓶颈环节",
  "nodes": [
    {
      "layer": "层级名称(如 下游终端/光模块/光芯片/上游材料)",
      "role": "该层在产业链中的作用",
      "isChokepoint": true|false,
      "chokepointReason": "若是瓶颈，说明为何不可替代/供给受限",
      "bomRatio": "该环节在终端产品中的 BOM 成本占比估算，例如 15%-20% 或 约 8%，若不适用可填空字串",
      "bomDetail": "精细化 BOM 拆解与子部件成本估算，如：激光器芯片(35%)、外壳组件(10%)、PCB(15%)、DSP/电驱动芯片(40%)，若不适用可填空字串",
      "tickers": [{"code": "6位代码或空串", "name": "公司名", "note": "访问原因"}]
    }
  ]
}`)}`;
  const user = `趋势/主题：${trend}\n请先实时写出产业链拆解与 BOM 推理，再用 \`\`\`json 代码块输出瓶颈点地图。`;
  return { system, user };
}
