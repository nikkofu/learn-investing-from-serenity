interface RadarFactor {
  label: string;
  score: number; // 0..max
}

interface RadarChartProps {
  factors: RadarFactor[];
  max?: number;
  size?: number;
  textColor?: string;
  borderColor?: string;
  accentColor?: string;
  accentSoftColor?: string;
}

/**
 * 轻量无依赖 SVG 雷达（多边形）图，用于瓶颈点五因子打分展示。
 * 颜色跟随主题 CSS 变量，SVG 属性不解析 var()，因此通过 inline style 设置。
 */
export default function RadarChart({
  factors,
  max = 5,
  size = 300,
  textColor = "var(--text)",
  borderColor = "var(--border)",
  accentColor = "var(--accent)",
  accentSoftColor = "var(--accent-soft)",
}: RadarChartProps) {
  const n = factors.length;
  if (n === 0) return null;

  // 四周留白 padding，防止标签溢出被裁切（黄金比例 0.35）
  const pad = size * 0.35;
  const vbSize = size + pad * 2;
  const cx = vbSize / 2;
  const cy = vbSize / 2;
  // 雷达图数据半径 R（黄金比例 0.28）
  const R = size * 0.28; 
  const rings = max;

  // 从顶部开始顺时针的角度
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
    <svg viewBox={`0 0 ${vbSize} ${vbSize}`} className="mx-auto w-full max-w-[320px]" role="img" aria-label="五因子雷达图">
      {/* 网格环 */}
      {Array.from({ length: rings }, (_, k) => (
        <polygon
          key={k}
          points={poly((R * (k + 1)) / rings)}
          style={{ fill: "none", stroke: borderColor, strokeWidth: 1 }}
        />
      ))}
      {/* 轴线 */}
      {factors.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} style={{ stroke: borderColor, strokeWidth: 1 }} />;
      })}
      {/* 数据多边形 */}
      <polygon
        points={dataPoly}
        style={{ fill: accentSoftColor, stroke: accentColor, strokeWidth: 2, strokeLinejoin: "round" }}
      />
      {/* 数据顶点圆点 */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} style={{ fill: accentColor }} />
      ))}
      {/* 标签文字 */}
      {factors.map((f, i) => {
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";

        // 字号：兼顾网页展示和海报导出的可读性（在 300px 尺寸下更清晰易读）
        const computedFontSize = Math.max(10, Math.round(size * 0.075));
        const baseOffset = size * 0.12; // 文字离雷达图边缘的合理距离 (0.12)

        // dy 微调：替代 dominantBaseline，防止 html-to-image 序列化翻转 Bug
        let dy = "0.35em";
        let offsetR = baseOffset;
        if (i === 0) {
          dy = "-0.3em";   // 最上方：文字往上顶
          offsetR = baseOffset * 0.75;
        } else if (i === 2 || i === 3) {
          dy = "0.9em";    // 下方：文字往下沉
          offsetR = baseOffset * 0.75;
        }

        const [lx, ly] = point(i, R + offsetR);
        const labelText = `${f.label} ${f.score}`;
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dy={dy}
            fontSize={computedFontSize}
            style={{
              fill: textColor,
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            {labelText}
          </text>
        );
      })}
    </svg>
  );
}
