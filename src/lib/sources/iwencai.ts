/**
 * iwencai（问财）NL 语义搜索 — 唯一能力：跨主题自然语言检索研报/公告/新闻。
 * 需要 API Key（环境变量 IWENCAI_API_KEY）+ X-Claw 鉴权头。未配置 key 时调用会抛错。
 * 按标的搜研报更稳的走 eastmoney.getEmReports；iwencai 仅用于 NL 主题检索。
 */

const IWENCAI_BASE = process.env.IWENCAI_BASE_URL ?? "https://openapi.iwencai.com";
const IWENCAI_KEY = process.env.IWENCAI_API_KEY ?? "";

export function iwencaiConfigured(): boolean {
  return Boolean(IWENCAI_KEY);
}

function hex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function clawHeaders(callType = "normal"): Record<string, string> {
  return {
    "X-Claw-Call-Type": callType,
    "X-Claw-Skill-Id": "report-search",
    "X-Claw-Skill-Version": "2.0.0",
    "X-Claw-Plugin-Id": "none",
    "X-Claw-Plugin-Version": "none",
    "X-Claw-Trace-Id": hex(32),
  };
}

export type IwencaiChannel = "report" | "announcement" | "news";

export interface IwencaiArticle {
  uid?: string;
  title?: string;
  publish_date?: string;
  score?: number | string;
  extra?: unknown;
  [k: string]: unknown;
}

/** iwencai 语义搜索。channel: report/announcement/news；size 可调到 50。 */
export async function iwencaiSearch(
  query: string,
  channel: IwencaiChannel = "report",
  size = 50,
): Promise<IwencaiArticle[]> {
  if (!IWENCAI_KEY) throw new Error("IWENCAI_API_KEY 未配置");
  const res = await fetch(`${IWENCAI_BASE}/v1/comprehensive/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${IWENCAI_KEY}`,
      "Content-Type": "application/json",
      ...clawHeaders(),
    },
    body: JSON.stringify({ channels: [channel], app_id: "AIME_SKILL", query, size }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`iwencai HTTP ${res.status}`);
  const data = (await res.json()) as { status_code?: number; status_msg?: string; data?: IwencaiArticle[] };
  if ((data.status_code ?? 0) !== 0) throw new Error(`iwencai error: ${data.status_msg ?? ""}`);
  return data.data ?? [];
}

/** 同一 uid 仅保留 score 最高的段落，按发布日期倒序。 */
export function dedupArticles(articles: IwencaiArticle[]): IwencaiArticle[] {
  const best = new Map<string, IwencaiArticle>();
  for (const a of articles) {
    const uid = a.uid || `${a.title ?? ""}|${a.publish_date ?? ""}`;
    const score = Number(a.score ?? 0);
    const cur = best.get(uid);
    if (!cur || score > Number(cur.score ?? 0)) best.set(uid, a);
  }
  return Array.from(best.values()).sort((x, y) =>
    String(y.publish_date ?? "").localeCompare(String(x.publish_date ?? "")),
  );
}
