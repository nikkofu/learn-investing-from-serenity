import Link from "next/link";
import { loadCurated, loadPostsDigest } from "@/lib/knowledge";
import { Card, SectionTitle } from "@/components/ui";
import MarketSnapshot from "@/components/home/MarketSnapshot";
import WatchlistSnapshot from "@/components/home/WatchlistSnapshot";
import HotList from "@/components/home/HotList";
import RecentAlerts from "@/components/home/RecentAlerts";
import QuickLinks from "@/components/home/QuickLinks";
import SectorMini from "@/components/home/SectorMini";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [curated, posts] = await Promise.all([loadCurated(), loadPostsDigest()]);

  return (
    <div className="space-y-6">
      {/* Hero（紧凑）：品牌定位 + 主 CTA + ⌘K 提示 */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-gradient-to-br from-[var(--accent-soft)] to-transparent p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[var(--text-sm)] text-[var(--accent)]">学习 Serenity · 白毛股神 · 瓶颈点投资法</p>
            <h1 className="mt-1.5 text-[var(--text-h1)] font-semibold leading-[var(--lh-h1)] tracking-tight">
              用 AI 把「瓶颈点投资法」落到 A 股
            </h1>
            <p className="mt-2 max-w-2xl text-[var(--text-sm)] leading-[var(--lh-sm)] text-[var(--muted)]">
              {curated.profile.coreIdea}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--muted)] sm:inline-flex">
            按
            <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
            全局搜索
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Link href="/map" target="_blank" rel="noopener noreferrer" className="rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[var(--text-sm)] font-medium text-[var(--accent-fg)] hover:opacity-90">
            趋势 → 产业链拆解
          </Link>
          <Link href="/analyze" target="_blank" rel="noopener noreferrer" className="rounded-[var(--radius-md)] border border-[var(--border)] px-4 py-2 text-[var(--text-sm)] hover:bg-[var(--hover)]">
            个股瓶颈点评分
          </Link>
          <Link href="/methodology" target="_blank" rel="noopener noreferrer" className="rounded-[var(--radius-md)] border border-[var(--border)] px-4 py-2 text-[var(--text-sm)] hover:bg-[var(--hover)]">
            方法论 / 知识库
          </Link>
        </div>
      </section>

      {/* 仪表盘：各模块独立 fetch + Skeleton + 失败降级，任一挂掉不阻断整页 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
        <div className="md:col-span-1 lg:col-span-2"><MarketSnapshot /></div>
        <div className="md:col-span-1 lg:col-span-2"><WatchlistSnapshot /></div>
        <div className="md:col-span-2 lg:col-span-2"><HotList /></div>
        <div className="md:col-span-1 lg:col-span-4"><RecentAlerts /></div>
        <div className="md:col-span-1 lg:col-span-2"><QuickLinks /></div>
        <div className="md:col-span-2 lg:col-span-6"><SectorMini /></div>
      </div>

      {/* 品牌下沉：瓶颈点方法论 + 知识库 */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle title="瓶颈点五因子" desc="押注被忽视、不可替代、供给受限的上游环节" className="mb-3" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {curated.method.factors.map((f) => (
              <Card key={f.key} padding="md">
                <div className="flex items-baseline justify-between">
                  <span className="text-[var(--text-sm)] font-medium text-[var(--text)]">{f.zh}</span>
                  <span className="text-[var(--text-xs)] text-[var(--accent)]">{Math.round(f.weight * 100)}%</span>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--faint)]">{f.en}</p>
                <p className="mt-2 text-[var(--text-xs)] leading-[var(--lh-xs)] text-[var(--muted)]">{f.desc}</p>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle
            title="知识库"
            action={
              <Link href="/methodology" target="_blank" rel="noopener noreferrer" className="text-[var(--text-sm)] text-[var(--accent)] hover:underline">
                方法论 →
              </Link>
            }
            className="mb-3"
          />
          <Card className="h-[calc(100%-2.75rem)]">
            {posts.available ? (
              <>
                <p className="text-[var(--text-sm)] text-[var(--text)]">
                  已收录 <span className="font-semibold text-[var(--accent)]">{posts.count}</span> 条 Serenity X 发言
                </p>
                <p className="mt-3 mb-2 text-[var(--text-xs)] text-[var(--faint)]">他最常提及（美股）</p>
                <div className="flex flex-wrap gap-1.5">
                  {posts.topTickers.slice(0, 12).map((t) => (
                    <span key={t.ticker} className="rounded-[var(--radius-sm)] bg-[var(--hover)] px-2 py-0.5 font-mono text-[var(--text-xs)] text-[var(--text)]">
                      ${t.ticker} <span className="text-[var(--faint)]">{t.count}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[var(--text-sm)] text-[var(--muted)]">
                尚未抓取 X 发言。运行 <code className="rounded bg-[var(--hover)] px-1 font-mono text-[var(--text-xs)]">node scripts/scrape-x.mjs</code> 构建一手知识库。
              </p>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
