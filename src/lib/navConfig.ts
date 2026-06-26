import {
  LayoutDashboard,
  BookOpen,
  Network,
  LayoutGrid,
  ScanSearch,
  Pickaxe,
  LineChart,
  CandlestickChart,
  GitCompare,
  TrendingUp,
  Store,
  FlaskConical,
  Radar,
  Star,
  Wallet,
  Bell,
  RefreshCw,
  Database,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 搜索别名：英文 / 拼音全拼 / 拼音首字母，供命令面板模糊匹配（不展示）。 */
  keywords?: string;
};

export type NavGroup = {
  id: string;
  /** 分组标题；缺省则不渲染分组头（用于「概览」单项）。 */
  label?: string;
  items: NavItem[];
};

/**
 * 全站导航单一数据源（v0.48.1）。
 * 按投研工作流分组：概览 → 发现 → 分析 → 策略与回测 → 交易与监控 → 系统。
 * 新增页面只改这里。
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    items: [
      {
        href: "/",
        label: "工作台",
        icon: LayoutDashboard,
        keywords: "gongzuotai dashboard home shouye workbench gzt 首页 仪表盘",
      },
    ],
  },
  {
    id: "discover",
    label: "发现",
    items: [
      {
        href: "/methodology",
        label: "方法论 / 知识库",
        icon: BookOpen,
        keywords: "fangfalun zhishiku methodology knowledge ffl zsk",
      },
      {
        href: "/map",
        label: "趋势 → 产业链拆解",
        icon: Network,
        keywords: "qushi chanyelian map chain trend qs cyl",
      },
      {
        href: "/sectors",
        label: "板块热力",
        icon: LayoutGrid,
        keywords: "bankuai reli sectors heatmap bk rl",
      },
      {
        href: "/scanner",
        label: "热门股扫描",
        icon: ScanSearch,
        keywords: "remengu saomiao scanner scan rmg sm",
      },
      {
        href: "/mining",
        label: "智能挖掘",
        icon: Pickaxe,
        keywords: "zhineng wajue mining znwj",
      },
    ],
  },
  {
    id: "analyze",
    label: "分析",
    items: [
      {
        href: "/analyze",
        label: "个股分析",
        icon: LineChart,
        keywords: "gegu fenxi analyze stock analysis ggfx",
      },
      {
        href: "/chart",
        label: "K 线图表",
        icon: CandlestickChart,
        keywords: "kxian tubiao chart kline candlestick kx tb",
      },
      {
        href: "/compare",
        label: "横向对比",
        icon: GitCompare,
        keywords: "hengxiang duibi compare contrast hxdb",
      },
      {
        href: "/momentum",
        label: "动量轮动",
        icon: TrendingUp,
        keywords: "dongliang lundong momentum rotation dllr",
      },
    ],
  },
  {
    id: "strategy",
    label: "策略与回测",
    items: [
      {
        href: "/strategies",
        label: "策略市场",
        icon: Store,
        keywords: "celue shichang strategies market clsc",
      },
      {
        href: "/backtest",
        label: "策略回测",
        icon: FlaskConical,
        keywords: "celue huice backtest clhc",
      },
      {
        href: "/arb",
        label: "套利雷达",
        icon: Radar,
        keywords: "taoli leida arbitrage radar tlld",
      },
    ],
  },
  {
    id: "trade",
    label: "交易与监控",
    items: [
      {
        href: "/watchlist",
        label: "自选 / 收藏",
        icon: Star,
        keywords: "zixuan shoucang watchlist favorites zxsc",
      },
      {
        href: "/paper",
        label: "纸面交易",
        icon: Wallet,
        keywords: "zhimian jiaoyi paper trade zmjy",
      },
      {
        href: "/alerts",
        label: "盘中盯盘",
        icon: Bell,
        keywords: "panzhong dingpan alerts monitor pzdp",
      },
    ],
  },
  {
    id: "system",
    label: "系统",
    items: [
      {
        href: "/sync",
        label: "数据同步",
        icon: RefreshCw,
        keywords: "shuju tongbu sync data sjtb",
      },
      {
        href: "/market",
        label: "数据接口调试台",
        icon: Database,
        keywords: "shuju jiekou tiaoshi market data inspector debug api sjjk ts",
      },
      {
        href: "/settings",
        label: "设置",
        icon: Settings,
        keywords: "shezhi settings config preferences sz",
      },
    ],
  },
];

/** 扁平化所有菜单项（命令面板 / 面包屑复用）。 */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export type RouteMeta = {
  /** 所属分组标题（首页为「概览」）。 */
  group: string;
  /** 页面标题。 */
  title: string;
  /** 深层子路由的父路由（用于面包屑），可选。 */
  parent?: string;
};

/** 路由 → 层级元信息。深层子路由单独登记。 */
export const ROUTE_META: Record<string, RouteMeta> = {
  "/": { group: "概览", title: "工作台" },
  "/methodology": { group: "发现", title: "方法论 / 知识库" },
  "/map": { group: "发现", title: "趋势 → 产业链拆解" },
  "/sectors": { group: "发现", title: "板块热力" },
  "/scanner": { group: "发现", title: "热门股扫描" },
  "/mining": { group: "发现", title: "智能挖掘" },
  "/analyze": { group: "分析", title: "个股分析" },
  "/chart": { group: "分析", title: "K 线图表" },
  "/compare": { group: "分析", title: "横向对比" },
  "/momentum": { group: "分析", title: "动量轮动" },
  "/strategies": { group: "策略与回测", title: "策略市场" },
  "/backtest": { group: "策略与回测", title: "策略回测" },
  "/backtest/strategy": {
    group: "策略与回测",
    title: "单股 / 多池回测",
    parent: "/backtest",
  },
  "/backtest/pairs": {
    group: "策略与回测",
    title: "配对回测",
    parent: "/backtest",
  },
  "/arb": { group: "策略与回测", title: "套利雷达" },
  "/watchlist": { group: "交易与监控", title: "自选 / 收藏" },
  "/paper": { group: "交易与监控", title: "纸面交易" },
  "/alerts": { group: "交易与监控", title: "盘中盯盘" },
  "/sync": { group: "系统", title: "数据同步" },
  "/market": { group: "系统", title: "数据接口调试台" },
  "/settings": { group: "系统", title: "设置" },
};

/** 当前 pathname 命中的顶层导航项 href（用于侧栏高亮）。 */
export function activeHref(pathname: string): string | null {
  if (pathname === "/") return "/";
  // 最长前缀匹配，保证 /backtest/strategy 命中 /backtest。
  const candidates = NAV_ITEMS.filter(
    (i) => i.href !== "/" && pathname.startsWith(i.href),
  ).sort((a, b) => b.href.length - a.href.length);
  return candidates[0]?.href ?? null;
}

/** 子序列匹配：query 的每个字符按序出现在 target 中即命中，返回紧凑度评分（越大越好）。 */
function subsequenceScore(query: string, target: string): number {
  let ti = 0;
  let firstHit = -1;
  let lastHit = -1;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    let found = -1;
    while (ti < target.length) {
      if (target[ti] === ch) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found === -1) return -1;
    if (firstHit === -1) firstHit = found;
    lastHit = found;
  }
  // 命中区间越短、越靠前，得分越高。
  const span = lastHit - firstHit;
  return 100 - span - firstHit * 0.1;
}

export type NavSearchHit = NavItem & { group: string };

/**
 * 命令面板菜单搜索：按 标题 + keywords 模糊匹配（子串优先，其次子序列）。
 * 空 query 返回空数组（由调用方决定是否展示「最近访问」）。
 */
export function searchNavItems(query: string): NavSearchHit[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];
  const scored: { item: NavItem; score: number }[] = [];
  for (const item of NAV_ITEMS) {
    const haystack = `${item.label} ${item.keywords ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, "");
    let score = -1;
    const idx = haystack.indexOf(q);
    if (idx >= 0) {
      score = 1000 - idx;
    } else {
      const sub = subsequenceScore(q, haystack);
      if (sub >= 0) score = sub;
    }
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item }) => ({
    ...item,
    group: ROUTE_META[item.href]?.group ?? "",
  }));
}
