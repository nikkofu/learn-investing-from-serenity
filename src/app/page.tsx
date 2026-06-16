import Link from "next/link";
import { loadCurated, loadPostsDigest } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [curated, posts] = await Promise.all([loadCurated(), loadPostsDigest()]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--accent-soft)] to-transparent p-6 sm:p-8">
        <p className="text-sm text-[var(--accent)]">学习 Serenity · 白毛股神 · 瓶颈点投资法</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          用 AI 把「瓶颈点投资法」落到 A 股
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text)]">
          {curated.profile.coreIdea}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/map" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90">
            趋势 → 产业链拆解
          </Link>
          <Link href="/analyze" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--hover)]">
            个股瓶颈点评分
          </Link>
          <Link href="/methodology" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--hover)]">
            方法论 / 知识库
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">瓶颈点五因子</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {curated.method.factors.map((f) => (
            <div key={f.key} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{f.zh}</span>
                <span className="text-xs text-[var(--accent)]">{Math.round(f.weight * 100)}%</span>
              </div>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--faint)]">{f.en}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="mb-3 text-lg font-semibold">六步工作流</h2>
          <ol className="space-y-2">
            {curated.method.workflow.map((w, i) => (
              <li key={i} className="flex gap-3 text-sm text-[var(--text)]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs text-[var(--accent)]">
                  {i + 1}
                </span>
                <span className="leading-6">{w}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="mb-3 text-lg font-semibold">知识库</h2>
          {posts.available ? (
            <>
              <p className="text-sm text-[var(--text)]">
                已收录 <span className="font-semibold text-[var(--accent)]">{posts.count}</span> 条 Serenity X 发言
              </p>
              <p className="mt-3 mb-2 text-xs text-[var(--faint)]">他最常提及（美股）</p>
              <div className="flex flex-wrap gap-1.5">
                {posts.topTickers.slice(0, 12).map((t) => (
                  <span key={t.ticker} className="rounded-md bg-[var(--hover)] px-2 py-0.5 font-mono text-xs text-[var(--text)]">
                    ${t.ticker} <span className="text-[var(--faint)]">{t.count}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              尚未抓取 X 发言。运行 <code className="rounded bg-[var(--hover)] px-1 font-mono text-xs">node scripts/scrape-x.mjs</code> 构建一手知识库。
            </p>
          )}
          <Link href="/methodology" className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline">
            查看完整方法论与主题映射 →
          </Link>
        </div>
      </section>
    </div>
  );
}
