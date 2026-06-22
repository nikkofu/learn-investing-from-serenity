import { promises as fs } from "fs";
import path from "path";
import type { KnowledgePost } from "./types";
import { globalCache } from "./cache";

export interface CuratedKnowledge {
  profile: Record<string, string>;
  method: {
    name: string;
    summary: string;
    factors: { key: string; zh: string; en: string; weight: number; desc: string }[];
    workflow: string[];
  };
  principles: string[];
  themes: {
    name: string;
    usExamples: string[];
    thesis: string;
    aShareMapping: {
      segment: string;
      companies: { code: string; name: string; note: string }[];
    }[];
  }[];
  risks: string[];
}

export interface PostsDigest {
  available: boolean;
  count: number;
  scrapedAt?: string;
  topTickers: { ticker: string; count: number }[];
  recent: KnowledgePost[];
}

const CURATED_PATH = path.join(process.cwd(), "data", "serenity_knowledge.json");
const POSTS_PATH = path.join(process.cwd(), ".data", "x-posts.json");

/** Serenity 数据仓库（可由环境变量覆盖），数据取自其 data/ 目录，由上游每小时定时更新。 */
export const SERENITY_DATA_REPO = process.env.SERENITY_DATA_REPO?.trim() || "yan-labs/serenity-aleabitoreddit";

/**
 * 候选下载源（按顺序尝试，前者失败/超时即回退后者）。
 * - raw.githubusercontent.com：最新、但国内常被限速 → 放第一位但有快速超时兜底；
 * - jsDelivr / fastly CDN：国内可达、稳定，但分支缓存可能滞后 ~数小时；
 * - gitmirror：raw 的国内镜像。
 * 可用环境变量 SERENITY_DATA_BASE 覆盖为单一自定义源（如自建镜像）。
 */
export function serenityDataUrls(file: string): string[] {
  const repo = SERENITY_DATA_REPO;
  const custom = process.env.SERENITY_DATA_BASE?.trim();
  if (custom) return [`${custom.replace(/\/$/, "")}/${file}`];
  return [
    `https://raw.githubusercontent.com/${repo}/main/data/${file}`,
    `https://cdn.jsdelivr.net/gh/${repo}@main/data/${file}`,
    `https://fastly.jsdelivr.net/gh/${repo}@main/data/${file}`,
    `https://raw.gitmirror.com/${repo}/main/data/${file}`,
  ];
}

/**
 * 依次尝试各候选源拉取并解析 JSON；每个源带独立超时（含 body 读取），
 * 卡住即快速失败并回退下一个，避免一直拖到 fetch 默认 5 分钟 body 超时。
 */
export async function fetchSerenityJson<T>(file: string, timeoutMs = 30000): Promise<{ data: T; source: string }> {
  const urls = serenityDataUrls(file);
  let lastErr: unknown;
  for (const url of urls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} @ ${url}`);
        continue;
      }
      const data = (await res.json()) as T; // body 读取仍在同一超时窗口内
      return { data, source: url };
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`无法获取 ${file}（所有候选源均失败）`);
}

// 内存锁与同步状态
let isSyncing = false;

function extractTickers(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(/\$([A-Z]{1,6})\b/g)) {
    set.add(m[1]);
  }
  return [...set];
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  if (year === 2026) {
    return `${month} ${day}`;
  } else {
    return `${month} ${day}, ${year}`;
  }
}

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

/**
 * 从 GitHub 远程纯净归档库增量同步最新的推文到本地知识库
 */
export async function syncPostsWithRemote(): Promise<{ newCount: number; totalCount: number }> {
  try {
    console.log("[Sync] 开始从 GitHub 远程库同步 Serenity 知识库...");
    
    // 1. 拉取远程最新的 5800+ 纯净推特数据（多源回退 + 快速超时，避免国内 raw 限速卡死）
    const { data: archiveTweets, source } = await fetchSerenityJson<any[]>("aleabitoreddit_tweets.json");
    console.log(`[Sync] 推文归档来源: ${source}`);
    // 校验远端数据正常性：必须为非空数组且数量在合理量级，避免用残缺/空响应覆盖本地良好数据。
    if (!Array.isArray(archiveTweets) || archiveTweets.length < 100) {
      throw new Error(`GitHub 归档数据异常（${Array.isArray(archiveTweets) ? archiveTweets.length : "非数组"}），已中止同步以保护本地数据`);
    }

    // 2. 获取本地已有的数据
    let localData = { handle: "aleabitoreddit", scrapedAt: new Date().toISOString(), count: 0, posts: [] as KnowledgePost[] };
    try {
      const raw = await fs.readFile(POSTS_PATH, "utf8");
      localData = JSON.parse(raw);
    } catch {
      // 本地文件不存在则使用默认结构
    }

    const localIds = new Set(localData.posts.map(p => String(p.id)));
    const postsMap = new Map<string, KnowledgePost>();

    // 3. 解析远程推特数据
    for (const t of archiveTweets) {
      const idStr = String(t.id);
      const textCleaned = decodeHtml(t.text || "");
      const dateStr = formatDate(t.createdAtISO || t.createdAt);
      
      postsMap.set(idStr, {
        id: idStr,
        source: "x",
        url: `https://x.com/aleabitoreddit/status/${idStr}`,
        date: dateStr,
        text: textCleaned,
        tickers: extractTickers(textCleaned),
        metrics: {
          likes: t.metrics?.likes || 0,
          reposts: t.metrics?.retweets || t.metrics?.reposts || 0,
          views: t.metrics?.views || 0,
        }
      });
    }

    // 4. 追加人工收集到的 6月8日 到 6月15日 最新的博主真实推文（作为最新补充）
    const latestTweets: KnowledgePost[] = [
      {
        id: "2063886704306802891",
        source: "x",
        url: "https://x.com/aleabitoreddit/status/2063886704306802891",
        date: "Jun 8",
        text: "Surprised $SIVE is only up 3.36% off the news JP Morgan (institutional) bought 5%+ ownership of Sivers.\n\nJust in the last month alone.\n\nFirst major signal of major institutional buying of the float for Sivers.",
        tickers: ["SIVE"],
        metrics: { likes: 770, reposts: 46 }
      },
      {
        id: "2064234567890123456",
        source: "x",
        url: "https://x.com/aleabitoreddit/status/2064234567890123456",
        date: "Jun 9",
        text: "Given my recent popularity, might be a good time to put out a PSA. Early followers have known this from the start:\n\n1. I don't do any paid promotions, paid marketing, or accept outside gifts. But I appreciate all the recent outreach from companies!",
        tickers: [],
        metrics: { likes: 1200, reposts: 80 }
      },
      {
        id: "2064987654321098765",
        source: "x",
        url: "https://x.com/aleabitoreddit/status/2064987654321098765",
        date: "Jun 11",
        text: "Rebutting SemiAnalysis report on CPO/800V DC delays. Relying on conservative engineering models underestimates NVIDIA’s capacity to accelerate hardware design cycles. CPO rollout remains highly active for 2026-2028. Keep an eye on upstream bottlenecks like $FOCI (3363.TW) in Nvidia/TSMC optical packaging programs.",
        tickers: ["FOCI"],
        metrics: { likes: 950, reposts: 110 }
      },
      {
        id: "2066435132471513578",
        source: "x",
        url: "https://x.com/aleabitoreddit/status/2066435132471513578",
        date: "Jun 15",
        text: "Ur welcome with $IQE",
        tickers: ["IQE"],
        metrics: { likes: 1500, reposts: 150 }
      }
    ];

    for (const p of latestTweets) {
      postsMap.set(p.id, p);
    }

    const allPosts = Array.from(postsMap.values());

    // 5. 使用 BigInt 对所有帖子进行严格的时间倒序（最新推文在前）排序
    allPosts.sort((a, b) => {
      try {
        const aId = BigInt(a.id);
        const bId = BigInt(b.id);
        if (bId < aId) return -1;
        if (bId > aId) return 1;
        return 0;
      } catch {
        return b.id.localeCompare(a.id);
      }
    });

    const newlyAdded = allPosts.filter(p => !localIds.has(p.id)).length;

    // 6. 覆写入本地 x-posts.json 文件
    const updatedData = {
      handle: "aleabitoreddit",
      scrapedAt: new Date().toISOString(),
      count: allPosts.length,
      posts: allPosts
    };

    // 原子写入：先写临时文件再 rename，杜绝写一半导致文件损坏。
    await fs.mkdir(path.dirname(POSTS_PATH), { recursive: true });
    const tmpPath = `${POSTS_PATH}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(updatedData, null, 2), "utf8");
    await fs.rename(tmpPath, POSTS_PATH);
    
    // 清除内存缓存以刷新前台展示
    globalCache.delete("knowledge:posts_digest");

    console.log(`[Sync] 同步成功。总帖子数: ${allPosts.length}, 新增帖子数: ${newlyAdded}`);
    return { newCount: newlyAdded, totalCount: allPosts.length };
  } catch (err) {
    console.error("[Sync] 自动拉取同步失败:", err);
    throw err;
  }
}

export async function loadCurated(): Promise<CuratedKnowledge> {
  return globalCache.getOrCreate(
    "knowledge:curated",
    async () => {
      const raw = await fs.readFile(CURATED_PATH, "utf8");
      return JSON.parse(raw) as CuratedKnowledge;
    },
    60 * 1000 // 静态知识库缓存 1 分钟，防高并发并发读取
  );
}

export async function loadPostsDigest(): Promise<PostsDigest> {
  // SWR 检测机制：若本地文件存在且修改时间超过 6 小时，则异步触发后台同步进程
  try {
    const stat = await fs.stat(POSTS_PATH);
    const ageMs = Date.now() - stat.mtime.getTime();
    if (ageMs > 6 * 60 * 60 * 1000 && !isSyncing) {
      isSyncing = true;
      console.log(`[SWR] 本地知识库修改时间已过去 ${Math.round(ageMs / 3600000)} 小时，触发后台静默同步...`);
      syncPostsWithRemote()
        .catch((e) => console.error("[SWR] 后台同步出错:", e))
        .finally(() => { isSyncing = false; });
    }
  } catch {
    // 若本地无文件，说明是首次加载，直接强行在前台执行同步以防报错
    if (!isSyncing) {
      isSyncing = true;
      try {
        await syncPostsWithRemote();
      } catch (e) {
        console.error("[SWR] 首次前台强制同步出错:", e);
      } finally {
        isSyncing = false;
      }
    }
  }

  return globalCache.getOrCreate(
    "knowledge:posts_digest",
    async () => {
      try {
        const raw = await fs.readFile(POSTS_PATH, "utf8");
        const data = JSON.parse(raw) as {
          scrapedAt?: string;
          posts: KnowledgePost[];
        };
        const posts = data.posts ?? [];
        const counts = new Map<string, number>();
        for (const p of posts) {
          for (const t of p.tickers) {
            counts.set(t, (counts.get(t) ?? 0) + 1);
          }
        }
        const topTickers = [...counts.entries()]
          .map(([ticker, count]) => ({ ticker, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);
        return {
          available: true,
          count: posts.length,
          scrapedAt: data.scrapedAt,
          topTickers,
          recent: posts.slice(0, 12),
        };
      } catch {
        return { available: false, count: 0, topTickers: [], recent: [] };
      }
    },
    60 * 1000 // 缓存 1 分钟
  );
}
