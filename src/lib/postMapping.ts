import type { CuratedKnowledge } from "./knowledge";

type Theme = CuratedKnowledge["themes"][number];

export interface MappedCompany {
  code: string;
  name: string;
  note: string;
  segment: string;
}

export interface MappedTheme {
  name: string;
  /** 命中得分（ticker 命中 + 关键词命中），用于排序。 */
  score: number;
  /** 命中的美股 ticker（取自该主题的 usExamples 或扩展词典）。 */
  matchedTickers: string[];
  /** 命中的正文关键词。 */
  matchedKeywords: string[];
  companies: MappedCompany[];
}

export interface PostMapping {
  themes: MappedTheme[];
  /** 去重后的全部 A 股代码，用于「在扫描器批量分析」链接。 */
  codes: string[];
}

/**
 * 主题扩展规则：每条用一个 anchor（该主题 usExamples 里的任一 ticker）绑定到具体主题，
 * 避免对主题中文名做脆弱的字符串硬编码。extraTickers / keywords 用于覆盖博主常发但
 * 不在 usExamples 里的标的与话题词。关键词统一小写匹配。
 */
interface ThemeRule {
  anchor: string;
  extraTickers: string[];
  keywords: string[];
}

const THEME_RULES: ThemeRule[] = [
  {
    // AI 算力 / Neocloud 基建：光模块、光芯片、CPO、neocloud、超大规模资本开支
    anchor: "NBIS",
    extraTickers: [
      "AAOI", "LITE", "COHR", "POET", "FOCI", "IQE", "AXTI", "SIVE", "INFN", "ANET",
      "NVDA", "AVGO", "MRVL", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "ORCL", "SMCI", "DELL", "VRT", "CRDO",
    ],
    keywords: [
      "optical", "cpo", "co-packaged", "transceiver", "光模块", "光芯片", "硅光", "silicon photonics",
      "neocloud", "datacenter", "data center", "数据中心", "hyperscaler", "capex", "资本开支",
      "gpu", "h100", "h200", "gb200", "gb300", "blackwell", "rubin", "800g", "1.6t", "liquid cool", "液冷",
      "idc", "算力", "inference", "训练集群",
    ],
  },
  {
    // 高速连接 / 互联：retimer、PCIe、铜连接、connector
    anchor: "ALAB",
    extraTickers: ["MRVL", "CRDO", "SMCI", "AMPL"],
    keywords: [
      "retimer", "pcie", "interconnect", "互联", "铜连接", "copper", "backplane", "connector",
      "高速连接", "nvlink", "scale-up", "scale up", "线缆", "线束",
    ],
  },
  {
    // 半导体主控 / 国产替代：代工、设备、材料、存储
    anchor: "TSM",
    extraTickers: [
      "AMD", "INTC", "MU", "SNDK", "WOLF", "ON", "AOSL", "XFAB", "ASYS", "AEHR", "AMAT", "LRCX", "KLAC", "ASML", "NVMI",
    ],
    keywords: [
      "foundry", "代工", "wafer", "晶圆", "lithography", "光刻", "etch", "刻蚀", "deposition", "薄膜",
      "设备", "材料", "国产替代", "国替", "存储", "memory", "hbm", "dram", "nand", "封装", "advanced packaging",
      "yield", "节点", "制程",
    ],
  },
  {
    // 机器人 / 减速器
    anchor: "RR",
    extraTickers: ["TSLA", "ABB", "ISRG", "SERV"],
    keywords: [
      "robot", "humanoid", "机器人", "人形", "减速器", "harmonic", "谐波", "actuator", "执行器",
      "丝杠", "ball screw", "灵巧手", "dexterous",
    ],
  },
  {
    // 稀土 / 国防安全
    anchor: "MP",
    extraTickers: ["LYSCF", "TMC", "KTOS", "AVAV", "PLTR"],
    keywords: [
      "rare earth", "稀土", "magnet", "永磁", "neodymium", "钕铁硼", "defense", "国防", "军工",
      "export control", "出口管制", "供应安全",
    ],
  },
  {
    // 储能 / 电力
    anchor: "FLNC",
    extraTickers: ["ENPH", "SEDG", "FCEL", "NVTS", "POWI", "VICR", "EOSE", "STEM", "RUN"],
    keywords: [
      "battery", "电池", "储能", "energy storage", "grid", "电网", "power", "电力", "ups",
      "inverter", "逆变", "光伏", "solar", "ress", "bess",
    ],
  },
];

function resolveTheme(themes: Theme[], anchor: string): Theme | undefined {
  return themes.find((t) => t.usExamples.includes(anchor));
}

/**
 * 将一条博主发言映射到知识库中最相关的 A 股「主题 → 瓶颈点」板块。
 * 评分 = ticker 命中数 ×2 + 关键词命中数；只返回有命中的主题，按得分降序。
 * 不臆造：无任何命中时返回空，前端据此显示「无直接对应 A 股板块」。
 */
export function mapPostToSectors(
  post: { text: string; tickers: string[] },
  themes: Theme[],
): PostMapping {
  const text = (post.text || "").toLowerCase();
  const postTickers = new Set(post.tickers.map((t) => t.toUpperCase()));

  const mapped: MappedTheme[] = [];

  for (const rule of THEME_RULES) {
    const theme = resolveTheme(themes, rule.anchor);
    if (!theme) continue;

    const themeTickers = new Set<string>([...theme.usExamples, ...rule.extraTickers].map((t) => t.toUpperCase()));
    const matchedTickers = [...postTickers].filter((t) => themeTickers.has(t));
    const matchedKeywords = rule.keywords.filter((kw) => text.includes(kw.toLowerCase()));

    const score = matchedTickers.length * 2 + matchedKeywords.length;
    if (score === 0) continue;

    const companies: MappedCompany[] = theme.aShareMapping.flatMap((seg) =>
      seg.companies.map((c) => ({ code: c.code, name: c.name, note: c.note, segment: seg.segment })),
    );

    mapped.push({
      name: theme.name,
      score,
      matchedTickers,
      matchedKeywords,
      companies,
    });
  }

  mapped.sort((a, b) => b.score - a.score);

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const t of mapped) {
    for (const c of t.companies) {
      if (!seen.has(c.code)) {
        seen.add(c.code);
        codes.push(c.code);
      }
    }
  }

  return { themes: mapped, codes };
}
