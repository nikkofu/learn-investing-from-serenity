interface RadarFactor {
  label: string;
  score: number; // 0..max
}

/**
 * Lightweight dependency-free SVG radar (polygon) chart for the
 * Chokepoint five factors. Colours follow the active theme via CSS vars.
 * Note: SVG presentation attributes do not resolve var(), so colours are
 * applied via inline `style` (CSS) instead of fill/stroke attributes.
 */
export default function RadarChart({
  factors,
  max = 5,
  size = 300,
}: {
  factors: RadarFactor[];
  max?: number;
  size?: number;
}) {
  const n = factors.length;
  if (n === 0) return null;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.32; // data radius; leaves room for labels
  const rings = max; // one ring per integer level

  // angle for vertex i, starting at top, clockwise
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angle(i)),
    cy + r * Math.sin(angle(i)),
  ];
  const poly = (r: number) =>
    factors.map((_, i) => point(i, r).map((v) => v.toFixed(1)).join(",")).join(" ");

  const dataPoints = factors.map((f, i) => point(i, (Math.max(0, Math.min(max, f.score)) / max) * R));
  const dataPoly = dataPoints.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[320px]" role="img" aria-label="五因子雷达图">
      {/* grid rings */}
      {Array.from({ length: rings }, (_, k) => (
        <polygon
          key={k}
          points={poly((R * (k + 1)) / rings)}
          style={{ fill: "none", stroke: "var(--border)", strokeWidth: 1 }}
        />
      ))}
      {/* axes */}
      {factors.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} style={{ stroke: "var(--border)", strokeWidth: 1 }} />;
      })}
      {/* data polygon */}
      <polygon
        points={dataPoly}
        style={{ fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 2, strokeLinejoin: "round" }}
      />
      {/* data vertices */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} style={{ fill: "var(--accent)" }} />
      ))}
      {/* labels */}
      {factors.map((f, i) => {
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
        
        // 传统 dy 高度微调：替代 dominantBaseline 防止 html-to-image 序列化翻转 Bug
        let dy = "0.35em"; // 居中
        let offsetR = 15;  // 顶点向外的偏移像素
        if (i === 0) {
          dy = "-0.2em";   // 最上方顶点：文字往上顶
          offsetR = 12;
        } else if (i === 2 || i === 3) {
          dy = "0.85em";   // 下方顶点：文字往下沉
          offsetR = 12;
        }
        
        const [lx, ly] = point(i, R + offsetR);
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dy={dy}
            fontSize={11}
            style={{
              fill: "var(--text)",
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            {f.label} {f.score}
          </text>
        );
      })}
    </svg>
  );
}
