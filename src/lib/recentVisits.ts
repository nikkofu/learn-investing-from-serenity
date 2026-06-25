import { NAV_ITEMS, ROUTE_META } from "./navConfig";

/**
 * 命令面板「最近访问」：纯前端 localStorage 记录，零后端、零新依赖。
 * 记录两类条目：页面（pathname）与个股（6 位代码）。
 */
export type RecentVisit =
  | { type: "page"; href: string; ts: number }
  | { type: "stock"; code: string; ts: number };

const LS_KEY = "serenity-recent-visits";
const MAX = 12;

function read(): RecentVisit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is RecentVisit =>
        v &&
        typeof v.ts === "number" &&
        ((v.type === "page" && typeof v.href === "string") ||
          (v.type === "stock" && typeof v.code === "string")),
    );
  } catch {
    return [];
  }
}

function write(list: RecentVisit[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event("serenity-recent-visits-updated"));
  } catch {
    /* ignore */
  }
}

/** 记录页面访问；仅登记导航中可识别的路由，去重置顶。 */
export function recordPageVisit(href: string) {
  const known = NAV_ITEMS.some((i) => i.href === href) || Boolean(ROUTE_META[href]);
  if (!known) return;
  const list = read().filter((v) => !(v.type === "page" && v.href === href));
  list.unshift({ type: "page", href, ts: Date.now() });
  write(list);
}

/** 记录个股访问（命令面板直达时调用），去重置顶。 */
export function recordStockVisit(code: string) {
  if (!/^\d{6}$/.test(code)) return;
  const list = read().filter((v) => !(v.type === "stock" && v.code === code));
  list.unshift({ type: "stock", code, ts: Date.now() });
  write(list);
}

/** 读取最近访问（已按时间倒序），可限制数量。 */
export function getRecentVisits(limit = MAX): RecentVisit[] {
  return read()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}
