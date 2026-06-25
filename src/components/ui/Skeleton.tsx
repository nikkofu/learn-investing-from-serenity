/**
 * 数据加载骨架。lines>1 渲染多行条；用于替代裸 "加载中..." 文字。
 */
export default function Skeleton({
  lines = 1,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  if (lines <= 1) {
    return (
      <div
        className={`h-4 animate-pulse rounded-[var(--radius-sm)] bg-[var(--hover)] ${className}`}
      />
    );
  }
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-[var(--radius-sm)] bg-[var(--hover)]"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}
