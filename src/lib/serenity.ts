import type { ChokepointFactorKey, Candle, StockQuote, ChokepointAssessment, CritiqueReport } from "./types";

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

【强制证据引用】每个因子除 rationale 外，还必须给出 evidence 字段：明确引用下方“行情/统计数据块”里的具体字段与数值作为打分依据（例如「市盈率TTM=45.2、近窗口涨跌+12.3%、区间位置=82%」）。**若该因子找不到可引用的数据支撑，evidence 必须填「无直接数据支撑」，并相应下调该因子分数**——宁可保守，不要无证据地给高分。

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
  "factors": [{"key": "demand|supply|attention|valueCapture|catalyst", "score": "0.0-5.0之间的数值，精度0.1，如3.5", "rationale": "...", "evidence": "引用数据块中的具体字段与数值；无支撑则填『无直接数据支撑』"}],
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

/** Build messages for analyzing an A-share industry sector through the chokepoint lens. */
export function buildSectorAnalyzePrompt(args: {
  sectorName: string;
  sectorCode: string;
  sectorPrice: number;
  sectorChangePct: number;
  sectorNetInflow: number;
  riseCount: number;
  fallCount: number;
  stocks: Array<{ code: string; name: string; price: number; changePct: number; turnoverPct: number }>;
  matchedKnowledge?: {
    themeName: string;
    themeThesis: string;
    tweets: { date: string; text: string }[];
  } | null;
}) {
  const {
    sectorName,
    sectorCode,
    sectorPrice,
    sectorChangePct,
    sectorNetInflow,
    riseCount,
    fallCount,
    stocks,
    matchedKnowledge,
  } = args;

  const factorsDoc = CHOKEPOINT_FACTORS.map(
    (f) => `- ${f.key} (${f.zh} ${f.en}, 权重 ${f.weight}): ${f.description}`
  ).join("\n");

  const knowledgeDoc = matchedKnowledge ? `
【Serenity 一手知识库关联笔记】
已为您从本地知识库中匹配到与该行业板块最相关的 Serenity 一手研报与推文观点：
- 关联主题：${matchedKnowledge.themeName}
- 主题核心论述：${matchedKnowledge.themeThesis}
- Serenity 一手推文要点参考：
${matchedKnowledge.tweets.map((t, idx) => `  [推文 ${idx + 1}] (${t.date}): ${t.text}`).join("\n")}
请在对该行业板块进行深度分析时，**高度参考并融入以上 Serenity 的一手研报观点**，确保推导结论符合其投资逻辑。
` : "";

  const system = `你是 Serenity（白毛股神）投资方法论的 AI 行业板块分析助手。Serenity 的核心方法是“瓶颈点投资法(Chokepoint)”：${SERENITY_PROFILE.coreIdea}

${CHINA_CONTEXT}
${knowledgeDoc}

你要对给定的 A 股行业板块，按照下面五个因子各打 0.0 - 5.0 分（0.0=完全不符合，5.0=极强符合，最小打分单位可以到 0.1，如：3.5，1.8），并给出一句中文理由（理由要尽量结合该行业在产业链中的位置以及成分股表现，不要编造不存在的财务数字）：
${factorsDoc}

【重要推理指令】
在第一步的实时推理里，请像投研日记一样有条理、简洁地展开你的深度分析，包含以下要点：
1. 【大趋势与行业定位】：确认该板块是否处于某项确定性强的宏观大趋势（如 AI 算力、国产替代等），并画出其在产业链中的位置。
2. 【行业瓶颈识别】：剖析该行业本身是否为产业链中供给受限、难以替代的瓶颈环节，或者该行业内存在哪些子瓶颈环节。
3. 【数据与资金面验证】：结合板块自身涨跌幅、主力净流入、个股换手率等指标，研判当前的资金关注度与热度级别。
4. 【价值捕获与商业壁垒】：探讨该行业龙头的议价权、毛利率、客户黏性以及产能供给情况，验证其将瓶颈地位转化为高额现金流的能力。
5. 【板块核心催化剂与核心标的】：梳理近期的催化事件（行业招标、国产认证导入等），并指出成分股中最有“卡脖子”潜力的龙头或隐形冠军标的。
6. 【风控与投资评级】：指出该板块目前的主要投资风险（警惕反身性回撤、产能过剩、下游逻辑证伪），并给出综合投资评级。

请在自然语言推理中写明分析思路，第二步再汇总成结构化 JSON。verdict 用「核心瓶颈板块 / 弹性跟风板块 / 普通周期板块 / 回避观望」之一，thesis 为120字内的 Serenity 风格板块瓶颈点论述，risks/catalysts 各 2-4 条，score 为 0.0 - 5.0 之间的数值，精度 0.1。

${twoPhaseGuard(`{
  "factors": [{"key": "demand|supply|attention|valueCapture|catalyst", "score": "0.0-5.0之间的数值，精度0.1，如3.5", "rationale": "..."}],
  "verdict": "...",
  "thesis": "...",
  "chokepoints": ["BOM卡脖子节点1", "BOM卡脖子节点2", "..."],
  "leaders": [
    {"code": "6位个股代码", "name": "个股名称", "role": "对应该个股在板块中的瓶颈地位或龙头角色描述"}
  ],
  "risks": ["..."],
  "catalysts": ["..."]
}`)}`;

  const dataBlock = {
    板块名称: sectorName,
    板块代码: sectorCode,
    最新点数: sectorPrice,
    今日涨跌幅: `${sectorChangePct}%`,
    今日主力净流入元: sectorNetInflow,
    上涨家数: riseCount,
    下跌家数: fallCount,
    代表成分股行情: stocks.map(s => ({
      代码: s.code,
      名称: s.name,
      最新价: s.price,
      涨跌幅: `${s.changePct}%`,
      换手率: `${s.turnoverPct}%`
    }))
  };

  const user = `请分析以下 A 股行业板块及成分股行情：
${JSON.stringify(dataBlock, null, 2)}
请先实时写出五因子与行业瓶颈推理，再用 \`\`\`json 代码块输出结构化打分。`;

  return { system, user };
}


/** 把行情快照压成紧凑数据块，供 Critic / Judge 复用同一份事实依据。 */
function factSummary(quote: StockQuote, stats: ReturnType<typeof import("./market").deriveStats>) {
  return {
    名称: quote.name,
    代码: quote.code,
    最新价: quote.price,
    涨跌幅百分比: quote.changePct,
    市盈率TTM: quote.pe,
    市净率: quote.pb,
    总市值元: quote.totalMarketCap,
    换手率百分比: quote.turnoverPct,
    近窗口统计: stats,
  };
}

/** 把生成器的初评压成紧凑文本，供 Critic / Judge 审阅。 */
function assessmentDigest(a: ChokepointAssessment) {
  return {
    totalScore: a.totalScore,
    verdict: a.verdict,
    thesis: a.thesis,
    recommendedBuy: a.recommendedBuy,
    factors: a.factors.map((f) => ({ key: f.key, score: f.score, rationale: f.rationale, evidence: f.evidence ?? "" })),
    risks: a.risks,
    catalysts: a.catalysts,
  };
}

/**
 * 自洽投票（self-consistency）打分器：仅依据数据块对五因子独立二次打分。
 * 用于多次采样后取每因子中位数，压低单趟 LLM 的随机方差。只输出紧凑 JSON。
 */
export function buildVotePrompt(args: {
  quote: StockQuote;
  stats: ReturnType<typeof import("./market").deriveStats>;
}) {
  const { quote, stats } = args;
  const factorsDoc = CHOKEPOINT_FACTORS.map(
    (f) => `- ${f.key} (${f.zh} ${f.en}, 权重 ${f.weight}): ${f.description}`,
  ).join("\n");
  const system = `你是 Serenity 瓶颈点投资法(Chokepoint)的打分器。请**仅依据下方数据块**，对五个因子各打 0.0 - 5.0 分（精度 0.1）。这是一次**独立的二次打分**（self-consistency 采样），请基于事实独立判断，不要附和任何先前结论，也不要编造数据块以外的财务数字。每个因子给出 evidence：引用数据块中的具体字段与数值；**若无可引用支撑，evidence 必须填「无直接数据支撑」并相应下调该因子分数**。
${factorsDoc}

只输出一个 \`\`\`json 代码块，不要任何其它内容：
\`\`\`json
{"factors": [{"key": "demand|supply|attention|valueCapture|catalyst", "score": 0.0, "evidence": "引用数据块字段；无则『无直接数据支撑』"}]}
\`\`\``;
  const user = `【标的行情/统计数据块（唯一可引用的事实来源）】
${JSON.stringify(factSummary(quote, stats), null, 2)}

请输出五因子打分 JSON。`;
  return { system, user };
}

/**
 * 批判者（Critic / Reflection 模式）：扮演严苛的“反方/做空尽调”分析师，
 * 主动寻找初评里缺乏证据支撑的论断、反证、过拟合/反身性/幸存者偏差，
 * 并给出一个总体置信度折扣。只输出结构化 JSON。
 */
export function buildCriticPrompt(args: {
  quote: StockQuote;
  stats: ReturnType<typeof import("./market").deriveStats>;
  assessment: ChokepointAssessment;
}) {
  const { quote, stats, assessment } = args;
  const system = `你是一名极其严苛、以“证伪”为天职的 A 股风控 / 做空尽调分析师，正在复核另一位分析师对某标的的瓶颈点初评。你的唯一目标是找出初评中**站不住脚的地方**，而不是附和它。

请重点审查：
1. **无证据论断**：哪些因子打分 / 论述没有引用真实数据支撑（evidence 为空、含糊、或与数据块矛盾）？逐条列出。
2. **反证 / 证伪**：有哪些数据或常识构成对“瓶颈点成立”的反向证据（如：估值已高、换手率显示已被充分关注、区间位置在高位追高、需求其实可被替代、供给并不稀缺）？
3. **过拟合 / 元层面风险**：是否存在叙事过拟合、反身性追高、幸存者偏差、用结果倒推逻辑？
4. **置信度折扣 confidenceHaircut（0-1）**：综合上述问题，给出应当下调的总体置信度比例（0=初评很扎实无需下调，1=逻辑基本被证伪）。

对每条反证，尽量标出它针对哪个因子(factorKey)以及建议的打分调整量(suggestedScoreDelta，负数=下调，范围 -3 ~ +1)。不要客气，宁可苛刻。${CHINA_CONTEXT}

只输出一个 \`\`\`json 代码块，结构如下，不要输出任何其它内容：
\`\`\`json
{
  "unsupportedClaims": ["缺乏证据支撑的论断..."],
  "disconfirming": [{"factorKey": "demand|supply|attention|valueCapture|catalyst", "issue": "反证描述", "severity": "high|medium|low", "suggestedScoreDelta": -1.5}],
  "overfitWarnings": ["过拟合/反身性/幸存者偏差等..."],
  "confidenceHaircut": 0.0,
  "summary": "一句话复核结论"
}
\`\`\``;

  const user = `【标的行情/统计数据块（唯一可引用的事实来源）】
${JSON.stringify(factSummary(quote, stats), null, 2)}

【待复核的瓶颈点初评】
${JSON.stringify(assessmentDigest(assessment), null, 2)}

请基于上方数据块严格证伪，输出 JSON 复核报告。`;

  return { system, user };
}

/**
 * 裁判（Judge / Aggregator 模式）：调和生成器初评与批判者复核，
 * 在批判成立处保守下调打分与置信度，保留证据，给出最终结论。只输出 JSON。
 */
export function buildJudgePrompt(args: {
  quote: StockQuote;
  stats: ReturnType<typeof import("./market").deriveStats>;
  assessment: ChokepointAssessment;
  critique: CritiqueReport;
}) {
  const { quote, stats, assessment, critique } = args;
  const factorsDoc = CHOKEPOINT_FACTORS.map((f) => `- ${f.key} (${f.zh}, 权重 ${f.weight})`).join("\n");
  const system = `你是资深投资委员会主审（裁判）。你面前有：一位分析师的瓶颈点初评，以及一位风控分析师的证伪复核。你的职责是**调和二者、得出更可靠的最终结论**，而不是简单取中点。

裁决原则：
- 批判**成立且有数据支撑**处，相应**下调**对应因子分数（采纳其 suggestedScoreDelta 的方向，幅度可自定）；批判牵强处可保留初评。
- evidence 仍为空或“无直接数据支撑”的因子，分数应偏保守。
- 给出 finalConfidence（0-1）：综合证据充分度与批判严重性；存在 high 级反证时应明显降低。
- 任一情况下都要**诚实**：宁可保守，不要为了好看而维持高分/买入推荐。

五因子（保持 key 不变）：
${factorsDoc}

只输出一个 \`\`\`json 代码块：
\`\`\`json
{
  "factors": [{"key": "demand|supply|attention|valueCapture|catalyst", "score": 0.0, "rationale": "调和后的理由", "evidence": "引用的数据；无则『无直接数据支撑』"}],
  "verdict": "隐形冠军|值得跟踪|一般|回避 + 半句话",
  "recommendedBuy": true,
  "buyPriceRange": "如 xx.x-xx.x 元，无则空字串",
  "sellPriceRange": "如 xx.x-xx.x 元，无则空字串",
  "finalConfidence": 0.0,
  "adjustmentNote": "相对初评做了哪些调整及原因，一两句"
}
\`\`\``;

  const user = `【标的行情/统计数据块】
${JSON.stringify(factSummary(quote, stats), null, 2)}

【生成器初评】
${JSON.stringify(assessmentDigest(assessment), null, 2)}

【风控复核】
${JSON.stringify(critique, null, 2)}

请输出调和后的最终 JSON。`;

  return { system, user };
}
