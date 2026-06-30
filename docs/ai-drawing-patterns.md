# AI 画图：形态可视化增强（A / B / C）

> 目标：让 `/chart` 的「AI 画图」在识别出经典技术形态（三角形/楔形/旗形/通道/头肩/双顶双底等）时，
> 不再只是零散的横线+标注，而是**把定义该形态的几何边界明显地画出来**。

## 背景与问题

AI 画图链路：前端按钮 → `POST /api/chart/draw` → LLM 输出「绘图基元」JSON → `sanitizeDrawPlan` 夹紧/吸附 →
`LightweightChart` 渲染。

原有基元只有 4 种：`hline`(横线) / `trendline`(两点斜线) / `zone`(价格区间) / `marker`(标注点)。
缺陷：

1. **没有"形态轮廓"基元**——三角形/楔形只能用零散线段近似，视觉上拼不成一个完整图形。
2. 模型经常**只给一条水平阻力线 + 标注，漏掉定义形态的斜趋势线**，于是更看不出形态。
3. AI 画线**偏细偏淡**（1–2px），密集主图上不够醒目；同一形态的多条线颜色不统一，难以归组。

## 方案（依次实施 A → B → C）

### A. 强化 system prompt（约束模型输出几何）

`src/app/api/chart/draw/route.ts` 的 `SYSTEM`：

- 新增 `pattern` 基元说明（见 C）。
- 硬性规则：**识别出有名字的形态时，必须用 `pattern`（或成对 `trendline`）把定义其几何的边界按顺序连点画出**，
  不允许只给单条横线。给出各形态的连点指引（上升三角形=下沿抬高低点+上沿水平高点；楔形/旗形/通道=上下两条边；
  头肩=左肩-头-右肩+颈线；双顶双底=两顶/底 marker+颈线 hline+支撑/阻力 zone）。
- **同形态同色**：同一形态相关的所有基元用同一 `color`，便于用户一眼归组。

### B. 渲染更醒目 + 同形态成组同色

`src/components/LightweightChart.tsx` 的 AI 叠加层：

- `hline` 线宽 1→2；`trendline` 线宽 2→3；`zone` 边线 1→2。
- 同形态同色由 A 的 prompt 规则保证（渲染层按各基元自带 `color` 着色，颜色一致即视觉成组）。
- `pattern` 轮廓用更粗更亮的描边（2.5px）；闭合形态加半透明同色填充，使"三角形/楔形"的面积可见。

### C. 新增「形态轮廓」基元 `pattern`

- 数据结构（`src/lib/drawings.ts`）：
  ```ts
  interface PatternDrawing {
    type: "pattern";
    shape: string;                 // triangle|wedge|flag|channel|head_shoulders|double_top|double_bottom|...
    closed: boolean;               // 是否闭合（连尾回首，形成多边形）
    points: { date: string; price: number }[]; // 有序关键点（顺序即连线顺序，不排序）
    label: string;
    color?: DrawingColor;
  }
  ```
- 校验（`sanitizeDrawPlan`）：逐点吸附到真实交易日、价位夹紧；`points` 至少 2 个（闭合需 ≥3）；**保持给定顺序**。
- 渲染（新文件 `src/components/patternOutlinePrimitive.ts`，lightweight-charts v5 series primitive）：
  按顺序把各点换算成画布坐标，`moveTo`→`lineTo` 连成多段线；`closed` 时 `closePath` 并以半透明同色填充；
  画在 K 线之上（zOrder `top`）以保证醒目；在最高点附近画一个小标签。LineSeries 无法表达"时间会回折/闭合"的折线，
  故用 canvas primitive 直接绘制。

## 不动的部分

- 实时层（SSE / 现价线 / 临时今日蜡烛）、K 线历史与缓存、V3 策略、回归通道、交易计划带——均不改。
- 仅日线/周/月线口径叠加 AI 画图；分时不画（沿用既有判断）。

## 验收

- 选「形态识别」「趋势线」，对三角形/双底等应能看到：定义形态的斜边/轮廓被明显画出（粗线+闭合填充），
  同一形态各基元同色；`npm run typecheck` src 0 报错。
