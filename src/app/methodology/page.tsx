import { loadCurated, loadPostsDigest } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  const [curated, posts] = await Promise.all([loadCurated(), loadPostsDigest()]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="text-2xl font-semibold tracking-tight">方法论 / 知识库</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {curated.profile.alias} · {curated.profile.handle} · Reddit {curated.profile.reddit}
        </p>
        <p className="mt-3 text-sm leading-6 text-zinc-300">{curated.profile.bio}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{curated.method.summary}</p>
        <p className="mt-2 text-xs text-amber-400/80">{curated.profile.selfReportedReturns}</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">交易原则</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {curated.principles.map((p, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-zinc-300">
              {p}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold">主题 → A 股瓶颈点映射</h2>
        <p className="-mt-3 text-xs text-zinc-500">
          他做美股，但每个主题在 A 股都有对应的“瓶颈点”环节。代码均经东方财富接口校验。
        </p>
        {curated.themes.map((t) => (
          <div key={t.name} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{t.name}</h3>
              <div className="flex flex-wrap gap-1">
                {t.usExamples.map((u) => (
                  <span key={u} className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
                    ${u}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{t.thesis}</p>
            <div className="mt-4 space-y-3">
              {t.aShareMapping.map((seg) => (
                <div key={seg.segment}>
                  <p className="mb-1.5 text-xs font-medium text-emerald-300">{seg.segment}</p>
                  <div className="flex flex-wrap gap-2">
                    {seg.companies.map((c) => (
                      <div key={c.code} className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs">
                        <span className="font-medium text-zinc-100">{c.name}</span>{" "}
                        <span className="font-mono text-zinc-500">{c.code}</span>
                        <p className="mt-0.5 max-w-[16rem] text-[11px] leading-4 text-zinc-400">{c.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {posts.available && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            近期 X 发言<span className="ml-2 text-xs font-normal text-zinc-500">（共收录 {posts.count} 条）</span>
          </h2>
          <div className="space-y-3">
            {posts.recent.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span>{p.date}</span>
                  {p.tickers.slice(0, 6).map((t) => (
                    <span key={t} className="font-mono text-sky-400">${t}</span>
                  ))}
                </div>
                <p className="whitespace-pre-line text-sm leading-6 text-zinc-300 line-clamp-4">{p.text}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
        <h2 className="mb-2 text-base font-semibold text-amber-300">风险与免责</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-300">
          {curated.risks.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
