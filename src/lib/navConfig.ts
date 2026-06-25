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
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
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
    items: [{ href: "/", label: "工作台", icon: LayoutDashboard }],
  },
  {
    id: "discover",
    label: "发现",
    items: [
      { href: "/methodology", label: "方法论 / 知识库", icon: BookOpen },
      { href: "/map", label: "趋势 → 产业链拆解", icon: Network },
      { href: "/sectors", label: "板块热力", icon: LayoutGrid },
      { href: "/scanner", label: "热门股扫描", icon: ScanSearch },
      { href: "/mining", label: "智能挖掘", icon: Pickaxe },
    ],
  },
  {
    id: "analyze",
    label: "分析",
    items: [
      { href: "/analyze", label: "个股分析", icon: LineChart },
      { href: "/chart", label: "K 线图表", icon: CandlestickChart },
      { href: "/compare", label: "横向对比", icon: GitCompare },
      { href: "/momentum", label: "动量轮动", icon: TrendingUp },
    ],
  },
  {
    id: "strategy",
    label: "策略与回测",
    items: [
      { href: "/strategies", label: "策略市场", icon: Store },
      { href: "/backtest", label: "策略回测", icon: FlaskConical },
      { href: "/arb", label: "套利雷达", icon: Radar },
    ],
  },
  {
    id: "trade",
    label: "交易与监控",
    items: [
      { href: "/watchlist", label: "自选 / 收藏", icon: Star },
      { href: "/paper", label: "纸面交易", icon: Wallet },
      { href: "/alerts", label: "盘中盯盘", icon: Bell },
    ],
  },
  {
    id: "system",
    label: "系统",
    items: [
      { href: "/sync", label: "数据同步", icon: RefreshCw },
      { href: "/settings", label: "设置", icon: Settings },
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
