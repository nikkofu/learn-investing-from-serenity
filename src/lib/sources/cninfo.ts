/**
 * 巨潮资讯公告（cninfo.com.cn）— 官方公告全文检索，不封 IP。
 * orgId 并非统一格式（如 601318→9900002221），首次调用拉取官方映射表并缓存，
 * 查不到再回退老格式（#19）。
 */

import { UA, toStr } from "./http";
import type { CninfoAnnouncement } from "./types";

let orgIdMap: Map<string, string> | null = null;

interface SzseStock {
  code: string;
  orgId: string;
}

async function getOrgId(code: string): Promise<string> {
  if (!orgIdMap) {
    try {
      const res = await fetch("http://www.cninfo.com.cn/new/data/szse_stock.json", {
        headers: { "User-Agent": UA },
        cache: "no-store",
      });
      const d = (await res.json()) as { stockList?: SzseStock[] };
      orgIdMap = new Map((d.stockList ?? []).map((s) => [s.code, s.orgId]));
    } catch {
      orgIdMap = new Map();
    }
  }
  const hit = orgIdMap.get(code);
  if (hit) return hit;
  // fallback：老格式（仅部分老股票适用）
  if (code.startsWith("6")) return `gssh0${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `gsbj0${code}`;
  return `gssz0${code}`;
}

function tsToDate(ts: unknown): string {
  if (typeof ts === "number" || (typeof ts === "string" && /^\d+$/.test(ts))) {
    return new Date(Number(ts)).toISOString().slice(0, 10);
  }
  return toStr(ts).slice(0, 10);
}

interface CninfoResp {
  announcements?: Array<{
    announcementTitle?: string;
    announcementTypeName?: string;
    announcementTime?: number | string;
    announcementId?: string;
  }> | null;
}

/** 巨潮公告全文检索（按股票，倒序最新）。 */
export async function getCninfoAnnouncements(
  code: string,
  pageSize = 30,
): Promise<CninfoAnnouncement[]> {
  const orgId = await getOrgId(code);
  const body = new URLSearchParams({
    stock: `${code},${orgId}`,
    tabName: "fulltext",
    pageSize: String(pageSize),
    pageNum: "1",
    column: "",
    category: "",
    plate: "",
    seDate: "",
    searchkey: "",
    secid: "",
    sortName: "",
    sortType: "",
    isHLtitle: "true",
  });
  const res = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://www.cninfo.com.cn/new/disclosure",
      Origin: "https://www.cninfo.com.cn",
    },
    body,
    cache: "no-store",
  });
  const d = (await res.json()) as CninfoResp;
  return (d.announcements ?? []).map((a) => ({
    title: toStr(a.announcementTitle),
    type: toStr(a.announcementTypeName),
    date: tsToDate(a.announcementTime),
    url: `https://www.cninfo.com.cn/new/disclosure/detail?annoId=${toStr(a.announcementId)}`,
  }));
}
