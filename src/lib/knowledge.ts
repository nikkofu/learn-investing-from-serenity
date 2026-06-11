import { promises as fs } from "fs";
import path from "path";
import type { KnowledgePost } from "./types";

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

export async function loadCurated(): Promise<CuratedKnowledge> {
  const raw = await fs.readFile(CURATED_PATH, "utf8");
  return JSON.parse(raw) as CuratedKnowledge;
}

export async function loadPostsDigest(): Promise<PostsDigest> {
  try {
    const raw = await fs.readFile(POSTS_PATH, "utf8");
    const data = JSON.parse(raw) as {
      scrapedAt?: string;
      posts: KnowledgePost[];
    };
    const posts = data.posts ?? [];
    const counts = new Map<string, number>();
    for (const p of posts) for (const t of p.tickers) counts.set(t, (counts.get(t) ?? 0) + 1);
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
}
