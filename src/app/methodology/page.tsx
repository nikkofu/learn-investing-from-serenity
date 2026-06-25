import { loadCurated, loadPostsDigest } from "@/lib/knowledge";
import { mapPostToSectors } from "@/lib/postMapping";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

function formatMetric(n?: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default async function MethodologyPage() {
  const [curated, posts] = await Promise.all([loadCurated(), loadPostsDigest()]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6">
        <PageHeader
          className="mb-0"
          title="方法论 / 知识库"
          subtitle={`${curated.profile.alias} · ${curated.profile.handle} · Reddit ${curated.profile.reddit}`}
        />
        <p className="mt-3 text-sm leading-6 text-[var(--text)]">{curated.profile.bio}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text)]">{curated.method.summary}</p>
        <p className="mt-2 text-xs text-[var(--warn)]">{curated.profile.selfReportedReturns}</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">交易原则</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {curated.principles.map((p, i) => (
            <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-sm leading-6 text-[var(--text)]">
              {p}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold">主题 → A 股瓶颈点映射</h2>
        <p className="-mt-3 text-xs text-[var(--faint)]">
          他做美股，但每个主题在 A 股都有对应的“瓶颈点”环节。代码均经东方财富接口校验。
        </p>
        {curated.themes.map((t) => {
          const themeCodes = Array.from(
            new Set(
              t.aShareMapping
                .flatMap((seg) => seg.companies.map((c) => c.code))
                .filter((code) => /^\d{6}$/.test(code)),
            ),
          );
          return (
          <div key={t.name} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{t.name}</h3>
              <div className="flex flex-wrap gap-1">
                {t.usExamples.map((u) => (
                  <span key={u} className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--accent)]">
                    ${u}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text)]">{t.thesis}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={`/map?trend=${encodeURIComponent(t.name)}&auto=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="按 Serenity 瓶颈点方法 AI 拆解该主题的产业链分层与卡脖子环节"
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M6 12h12"/></svg>
                拆解产业链瓶颈点 →
              </a>
              {themeCodes.length > 0 && (
                <a
                  href={`/scanner?codes=${themeCodes.join(",")}&title=${encodeURIComponent(t.name + " 瓶颈点个股")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="在热门股扫描器并发诊断该主题下的全部 A 股"
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--inset)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--accent-line)] hover:text-[var(--text)]"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  批量诊断 {themeCodes.length} 只 →
                </a>
              )}
            </div>
            <div className="mt-4 space-y-3">
              {t.aShareMapping.map((seg) => (
                <div key={seg.segment}>
                  <p className="mb-1.5 text-xs font-medium text-[var(--accent)]">{seg.segment}</p>
                  <div className="flex flex-wrap gap-2">
                    {seg.companies.map((c) => {
                      const isA = /^\d{6}$/.test(c.code);
                      const inner = (
                        <>
                          <span className="font-medium text-[var(--text)]">{c.name}</span>{" "}
                          <span className="font-mono text-[var(--faint)]">{c.code}</span>
                          <p className="mt-0.5 max-w-[16rem] text-[11px] leading-4 text-[var(--muted)]">{c.note}</p>
                        </>
                      );
                      return isA ? (
                        <a
                          key={c.code}
                          href={`/analyze?code=${c.code}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`个股诊断分析 · ${c.note}`}
                          className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs transition hover:border-[var(--accent-line)] hover:bg-[var(--hover)]"
                        >
                          {inner}
                        </a>
                      ) : (
                        <div key={c.code} className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs">
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })}
      </section>

      {posts.available && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">
            近期 X 发言<span className="ml-2 text-xs font-normal text-[var(--faint)]">（共收录 {posts.count} 条）</span>
          </h2>
          <p className="mb-3 text-xs text-[var(--faint)]">
            原文全文展示；每条已映射到知识库「主题 → A 股瓶颈点」表中最相关的板块/个股，点击可直接跳转诊断分析。
          </p>
          <div className="space-y-4">
            {posts.recent.map((p) => {
              const mapping = mapPostToSectors(p, curated.themes);
              const scannerHref = `/scanner?codes=${mapping.codes.join(",")}&title=${encodeURIComponent(
                `Serenity ${p.date} 发言相关瓶颈点`,
              )}`;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--faint)]">
                    <span className="font-medium text-[var(--muted)]">{p.date}</span>
                    {p.tickers.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {p.tickers.map((t) => (
                          <span key={t} className="font-mono text-[var(--accent)]">${t}</span>
                        ))}
                      </span>
                    )}
                    {p.metrics && (
                      <span className="flex items-center gap-2 text-[var(--faint)]">
                        <span title="点赞">♥ {formatMetric(p.metrics.likes)}</span>
                        <span title="转发">↻ {formatMetric(p.metrics.reposts)}</span>
                        {!!p.metrics.views && <span title="浏览">👁 {formatMetric(p.metrics.views)}</span>}
                      </span>
                    )}
                  </div>

                  <p className="whitespace-pre-line text-sm leading-6 text-[var(--text)]">{p.text}</p>

                  {mapping.themes.length > 0 ? (
                    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-[var(--accent)]">相关 A 股板块</span>
                        {mapping.themes.map((t) => (
                          <a
                            key={t.name}
                            href={`/map?trend=${encodeURIComponent(t.name)}&auto=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="拆解该板块的产业链瓶颈点 →"
                            className="inline-flex items-center gap-0.5 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                          >
                            {t.name}
                            <span className="text-[9px] opacity-70">↗</span>
                          </a>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {mapping.themes
                          .flatMap((t) => t.companies)
                          .filter((c, i, arr) => arr.findIndex((x) => x.code === c.code) === i)
                          .slice(0, 12)
                          .map((c) => (
                            <a
                              key={c.code}
                              href={`/analyze?code=${c.code}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`${c.segment} · ${c.note}`}
                              className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-2.5 py-1 text-xs transition hover:border-[var(--accent-line)] hover:bg-[var(--hover)]"
                            >
                              <span className="font-medium text-[var(--text)]">{c.name}</span>{" "}
                              <span className="font-mono text-[var(--faint)]">{c.code}</span>
                            </a>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--faint)]">
                      暂无直接对应的 A 股瓶颈点板块
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--muted)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
                    >
                      查看原文 ↗
                    </a>
                    {mapping.codes.length > 0 && (
                      <a
                        href={scannerHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] underline-offset-2 hover:underline"
                      >
                        在扫描器批量分析这 {mapping.codes.length} 只 →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] p-5">
        <h2 className="mb-2 text-base font-semibold text-[var(--warn)]">风险与免责</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--text)]">
          {curated.risks.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
