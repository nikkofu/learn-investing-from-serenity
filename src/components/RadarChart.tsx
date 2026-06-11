interface RadarFactor {
  label: string;
  score: number; // 0..max
}

/**
 * Lightweight dependency-free SVG radar (polygon) chart for the
 * Chokepoint five factors. Colours follow the active theme via CSS vars.
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
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {/* axes */}
      {factors.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />;
      })}
      {/* data polygon */}
      <polygon points={dataPoly} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      {/* data vertices */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill="var(--accent)" />
      ))}
      {/* labels */}
      {factors.map((f, i) => {
        const [lx, ly] = point(i, R + 22);
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-[var(--text)]"
            fontSize={12}
          >
            <tspan fontWeight={500}>{f.label}</tspan>
            <tspan className="fill-[var(--accent)]" fontWeight={700} dx={5}>
              {f.score}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
