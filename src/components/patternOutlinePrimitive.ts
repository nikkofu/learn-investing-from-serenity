/**
 * 形态轮廓渲染层（lightweight-charts v5 自定义 series primitive）。
 *
 * 把一组「有序关键点」按给定顺序连成多段线，可选闭合并以半透明同色填充，用于把 AI 识别出的
 * 经典形态（三角形/楔形/旗形/通道/头肩/双顶双底等）的几何边界**明显地**画出来——而不是只给
 * 零散的横线/标注。LineSeries 要求时间严格递增、单值，无法表达「时间回折/闭合」的折线，故用
 * 官方 series primitive 接口在画布上直接绘制。坐标用 media 空间（CSS 像素），画在 K 线之上
 * （zOrder "top"）以保证醒目。
 */
import type {
  IChartApi,
  ISeriesApi,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** 形态上的一个关键点（时间 + 价位）。 */
export interface PatternOutlinePoint {
  time: Time;
  price: number;
}
/** 单个形态轮廓：有序点序列 + 是否闭合 + 描边/填充色 + 标签。 */
export interface PatternOutlineShape {
  points: PatternOutlinePoint[];
  closed: boolean;
  stroke: string; // 不透明描边色
  fill: string; // 半透明填充色（""=不填充）
  label: string;
}
export interface PatternOutlineData {
  shapes: PatternOutlineShape[];
}

class OutlineRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: PatternOutlinePrimitive) {}

  draw(target: RenderTarget): void {
    const chart = this._src.chart;
    const series = this._src.series;
    const data = this._src.data;
    if (!chart || !series || !data || data.shapes.length === 0) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      for (const shape of data.shapes) {
        const cols: { x: number; y: number }[] = [];
        for (const p of shape.points) {
          const x = ts.timeToCoordinate(p.time);
          const y = series.priceToCoordinate(p.price);
          if (x == null || y == null) continue;
          cols.push({ x, y });
        }
        if (cols.length < 2) continue;

        // 1) 闭合形态：半透明同色填充，使「三角形/楔形」的面积可见。
        if (shape.closed && cols.length >= 3 && shape.fill) {
          ctx.beginPath();
          ctx.moveTo(cols[0].x, cols[0].y);
          for (let i = 1; i < cols.length; i++) ctx.lineTo(cols[i].x, cols[i].y);
          ctx.closePath();
          ctx.fillStyle = shape.fill;
          ctx.fill();
        }

        // 2) 粗描边（醒目）。
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cols[0].x, cols[0].y);
        for (let i = 1; i < cols.length; i++) ctx.lineTo(cols[i].x, cols[i].y);
        if (shape.closed && cols.length >= 3) ctx.closePath();
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.strokeStyle = shape.stroke;
        ctx.stroke();

        // 3) 关键点小圆点强调。
        ctx.fillStyle = shape.stroke;
        for (const c of cols) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // 4) 标签：画在最高（y 最小）顶点上方。
        if (shape.label) {
          let top = cols[0];
          for (const c of cols) if (c.y < top.y) top = c;
          ctx.save();
          ctx.font = "11px sans-serif";
          const padX = 4;
          const w = ctx.measureText(shape.label).width + padX * 2;
          const h = 15;
          const bx = top.x - w / 2;
          const by = top.y - h - 4;
          ctx.fillStyle = shape.stroke;
          ctx.fillRect(bx, by, w, h);
          ctx.fillStyle = "#ffffff";
          ctx.textBaseline = "middle";
          ctx.fillText(shape.label, bx + padX, by + h / 2);
          ctx.restore();
        }
      }
    });
  }
}

class OutlineView implements IPrimitivePaneView {
  private readonly _renderer: OutlineRenderer;
  constructor(src: PatternOutlinePrimitive) {
    this._renderer = new OutlineRenderer(src);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "top"; // 画在 K 线之上，保证形态轮廓醒目
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/** 形态轮廓 primitive：attach 到蜡烛序列即绘制（数据不可变，变更时由调用方重建并重新 attach）。 */
export class PatternOutlinePrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  readonly data: PatternOutlineData;
  private readonly _views: OutlineView[];

  constructor(data: PatternOutlineData) {
    this.data = data;
    this._views = [new OutlineView(this)];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
  }

  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return this._views;
  }
}
