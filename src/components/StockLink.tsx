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
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="3" y="6" width="2.4" height="6" rx="0.4" />
          <rect x="3.9" y="2.5" width="0.6" height="3.5" />
          <rect x="3.9" y="12" width="0.6" height="1.5" />
          <rect x="10.6" y="4" width="2.4" height="5" rx="0.4" />
          <rect x="11.5" y="2" width="0.6" height="2" />
          <rect x="11.5" y="9" width="0.6" height="4" />
        </svg>
      </Link>
    </span>
  );
}
