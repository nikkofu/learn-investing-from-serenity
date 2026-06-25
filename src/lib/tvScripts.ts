/**
 * TradingView 热门策略「发现」抓取库 —— 只抓取脚本列表页的**公开元数据**
 * （名称 / 作者 / 链接 / 点赞数 / 访问级别 / 缩略图 / 标的 / 版本 / 时间），
 * 用于在本系统里建立「值得复刻的 TV 策略」清单，逐个走 tvStrategies.ts 的人工逆向范式。
 *
 * 合规边界（务必保持）：
 *  - 只读公开列表页内嵌的 JSON 元数据，**不抓取脚本正文 / Pine 源码、不绕过任何付费墙**；
 *  - 全部保留原作者署名与原脚本回链（chart_url），仅作「参考 / 跳转」用途，不在本站复刻或宣称等价；
 *  - 数据版权归 TradingView 与各原作者所有。
 *
 * ⚠️ 仅在服务端运行（依赖 fetch 外网与 fs）。
 */
import { promises as fs } from "fs";
import path from "path";

/** 脚本列表页（第一页即「热门」默认排序）。 */
export const TV_SCRIPTS_URL = "https://cn.tradingview.com/scripts/?script_type=strategies";

const APP_DATA_DIR = path.join(process.cwd(), ".data");
export const TV_STRATEGIES_PATH = path.join(APP_DATA_DIR, "tv-strategies.json");

/** 访问级别：开源（源码可见）/ 受保护（闭源）/ 邀请制 / 未知。 */
export type TvScriptAccess = "open" | "protected" | "invite" | "unknown";

/** 一条 TV 策略的公开元数据（外链参考用，非本站复刻）。 */
export interface TvScriptRef {
  /** TradingView idea id。 */
  id: number;
  /** 脚本名称。 */
  name: string;
  /** 原脚本链接（chart_url，回链 TradingView）。 */
  url: string;
  /** 原作者用户名。 */
  author: string;
  /** 原作者主页。 */
  authorUrl: string;
  /** 访问级别（枚举）。 */
  access: TvScriptAccess;
  /** 访问级别中文标签。 */
  accessLabel: string;
  /** Pine 版本号（如 "6"）。 */
  version: string;
  /** 点赞数。 */
  likes: number;
  /** 评论数。 */
  comments: number;
  /** 是否被官方标「热门」。 */
  isHot: boolean;
  /** 是否被编辑精选。 */
  isPicked: boolean;
  /** 缩略图（中等尺寸 webp/png）。 */
  thumbnail: string | null;
  /** 关联标的全名（如 "ASX:FMG"）。 */
  symbol: string | null;
  /** 发布时间（ISO）。 */
  createdAt: string;
  /** 更新时间（ISO）。 */
  updatedAt: string;
  /** 简介摘要（去除 markdown 标题与多余空白，截断）。 */
  excerpt: string;
}

/** 落盘结构（与其它 sync 源一致：source + version + syncedAt + count + list）。 */
export interface TvStrategiesFile {
  source: "tvStrategies";
  version: number;
  syncedAt: string;
  count: number;
  list: TvScriptRef[];
}

const ACCESS_LABEL: Record<TvScriptAccess, string> = {
  open: "开源",
  protected: "受保护",
  invite: "邀请制",
  unknown: "未知",
};

/** TradingView script_access：1=开源 / 2=受保护（闭源）/ 3=邀请制。 */
function mapAccess(v: unknown): TvScriptAccess {
  if (v === 1) return "open";
  if (v === 2) return "protected";
  if (v === 3) return "invite";
  return "unknown";
}

/** 从一段以 `[` 开头的文本里，按「尊重字符串字面量」的方式取出第一个完整 JSON 数组。 */
function sliceJsonArray(text: string, startBracket: number): string | null {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let p = startBracket; p < text.length; p++) {
    const c = text[p];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return text.slice(startBracket, p + 1);
    }
  }
  return null;
}

/** 把 markdown 简介压成一行纯文本摘要。 */
function toExcerpt(desc: unknown, max = 180): string {
  if (typeof desc !== "string") return "";
  const flat = desc
    .replace(/[#*_>`~-]+/g, " ") // 去 markdown 记号
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

interface RawTvItem {
  id?: number;
  name?: string;
  chart_url?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  version?: string | number;
  comments_count?: number;
  likes_count?: number;
  is_hot?: boolean;
  is_picked?: boolean;
  script_type?: string;
  script_access?: number;
  user?: { username?: string };
  image?: { middle_webp?: string; middle?: string; big?: string };
  symbol?: { full_name?: string };
}

/** 从列表页 HTML 解析出 idea 元数据数组（找不到则抛错）。 */
export function parseTvScriptsHtml(html: string): TvScriptRef[] {
  const anchor = '"ideas":{"data":';
  const i = html.indexOf(anchor);
  if (i < 0) throw new Error("未在页面中找到脚本数据块（ideas.data），页面结构可能已变更");
  const itemsAt = html.indexOf('"items":', i);
  if (itemsAt < 0) throw new Error("未找到 items 字段，页面结构可能已变更");
  const bracketAt = html.indexOf("[", itemsAt);
  if (bracketAt < 0) throw new Error("未找到 items 数组起始，页面结构可能已变更");
  const arrText = sliceJsonArray(html, bracketAt);
  if (!arrText) throw new Error("items 数组括号未闭合，解析失败");

  let raw: RawTvItem[];
  try {
    raw = JSON.parse(arrText) as RawTvItem[];
  } catch (err) {
    throw new Error(`items JSON 解析失败：${err instanceof Error ? err.message : err}`);
  }

  return raw
    .filter((it) => it && typeof it.id === "number" && it.script_type === "strategy")
    .map((it): TvScriptRef => {
      const access = mapAccess(it.script_access);
      const author = it.user?.username || "未知作者";
      return {
        id: it.id as number,
        name: (it.name || "").trim() || "（无标题）",
        url: it.chart_url || "",
        author,
        authorUrl: author !== "未知作者" ? `https://cn.tradingview.com/u/${encodeURIComponent(author)}/` : "",
        access,
        accessLabel: ACCESS_LABEL[access],
        version: String(it.version ?? ""),
        likes: Number(it.likes_count ?? 0),
        comments: Number(it.comments_count ?? 0),
        isHot: !!it.is_hot,
        isPicked: !!it.is_picked,
        thumbnail: it.image?.middle_webp || it.image?.middle || it.image?.big || null,
        symbol: it.symbol?.full_name || null,
        createdAt: it.created_at || "",
        updatedAt: it.updated_at || "",
        excerpt: toExcerpt(it.description),
      };
    });
}

/** 抓取并解析 TV 策略列表第一页（热门）。失败抛错，由上层 sync 统一处理。 */
export async function fetchTopTvStrategies(): Promise<TvScriptRef[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let html: string;
  try {
    const res = await fetch(TV_SCRIPTS_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`TradingView 返回 HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  return parseTvScriptsHtml(html);
}

/** 读取已落盘的 TV 策略清单（无则返回空结构）。 */
export async function loadTvStrategies(): Promise<TvStrategiesFile | null> {
  try {
    return JSON.parse(await fs.readFile(TV_STRATEGIES_PATH, "utf8")) as TvStrategiesFile;
  } catch {
    return null;
  }
}
