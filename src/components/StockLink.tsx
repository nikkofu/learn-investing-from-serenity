import Link from "next/link";

/**
 * 个股链接：把出现的个股代码/名称统一渲染为可跳转链接。
 * 主体（名称/代码）→ /analyze 个股分析；尾随 K 线图标 → /chart 看 K 线。
 * 非 6 位 A 股代码时退化为纯文本，不渲染链接。
 */
export default function StockLink({
  code,
  name,
  className,
  newTab = false,
}: {
  code: string;
  name?: string;
  className?: string;
  /** 是否新标签页打开（列表页常用，避免丢失当前筛选）。 */
  newTab?: boolean;
}) {
  const valid = /^\d{6}$/.test(code);
  if (!valid) return <span className={className}>{name ?? code}</span>;
  const target = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <Link
        href={`/analyze?code=${code}`}
        {...target}
        title="个股分析"
        className="hover:text-[var(--accent)] hover:underline"
      >
        {name ? `${name} ${code}` : code}
      </Link>
      <Link
        href={`/chart?code=${code}`}
        {...target}
        title="看 K 线图"
        aria-label="看 K 线图"
        className="inline-flex items-center justify-center rounded border border-[var(--border)] p-0.5 text-[var(--muted)] hover:border-[var(--accent-line)] hover:text-[var(--accent)]"
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 3v18h18" />
          <path d="m19 8-5 5-4-4-4 4" />
        </svg>
      </Link>
    </span>
  );
}
