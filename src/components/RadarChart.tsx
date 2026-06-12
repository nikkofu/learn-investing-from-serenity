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

  // 精密调优核心图形占比，使蛛网多边形占整个 SVG 视口区域的 80% 以上（直径占比 80%）
  const vbSize = size;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.40; // 半径设为 40%，使图形直径刚好达到 80% 占比 
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
    <svg 
      viewBox={`0 0 ${vbSize} ${vbSize}`} 
      className="mx-auto w-full max-w-[320px]" 
      style={{ overflow: "visible" }}
      role="img" 
      aria-label="五因子雷达图"
    >
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

        // 字号：将字号等比例缩小 30%，消除与其他布局重合的可能
        const computedFontSize = Math.max(8, Math.round(size * 0.065 * 0.7));
        const baseOffset = size * 0.04; // 紧凑的文字离雷达图边缘的合理距离 (4%)

        // 对 2, 3, 4, 5 个因子位置（即代码 i=1, 2, 3, 4）进行横向微调，使其安全收缩在视口内
        let dy = "0.35em";
        let offsetR = baseOffset;
        let lxOffset = 0;
        let lyOffset = 0;

        if (i === 0) {
          dy = "-0.4em";   // 最上方：文字往上顶
          offsetR = baseOffset * 0.4;
        } else if (i === 1) {
          lxOffset = -size * 0.045; // 右偏上：往左偏，防止超出右边缘
          lyOffset = -size * 0.01;
        } else if (i === 2) {
          dy = "0.9em";    // 右偏下：文字往下沉并往左偏
          lxOffset = -size * 0.035;
          offsetR = baseOffset * 0.4;
        } else if (i === 3) {
          dy = "0.9em";    // 左偏下：文字往下沉并往右偏
          lxOffset = size * 0.035;
          offsetR = baseOffset * 0.4;
        } else if (i === 4) {
          lxOffset = size * 0.045;  // 左偏上：往右偏，防止超出左边缘
          lyOffset = -size * 0.01;
        }

        const [lxRaw, lyRaw] = point(i, R + offsetR);
        const lx = lxRaw + lxOffset;
        const ly = lyRaw + lyOffset;
        const labelText = f.label; // 去掉打分数值的显示，直接显示名字
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
