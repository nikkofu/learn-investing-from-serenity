/**
 * 回归通道渲染层（lightweight-charts v5 自定义 series primitive）。
 *
 * 与经典 SVG（QuantChart）/`scanner` 展开评估里的「回归通道」同口径：以 `technical.trendChannel`
 * （最近 60 日收盘价线性回归拟合，midLine ± 1.5·标准差 为上下轨）为数据源，沿最近 N 根 K 线
 * 还原出上轨 / 中轨 / 下轨三条斜线 + 轨间半透明填充带。
 *
 * lightweight-charts 的 LineSeries/AreaSeries 无法表达「两条斜线之间的填充带」，故用官方 series
 * primitive 接口在画布上直接绘制；坐标用 media 空间（CSS 像素），与 priceToCoordinate /
 * timeToCoordinate 返回口径一致。整体画在 K 线之下（zOrder "bottom"），不遮挡蜡烛与买卖标记。
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

// 从库的渲染器签名里取出画布目标类型（CanvasRenderingTarget2D），避免直接依赖 fancy-canvas。
type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** 通道上某根 K 线对应的三轨价位。 */
export interface RegressionChannelPoint {
  time: Time;
  upper: number;
  mid: number;
  lower: number;
}

/** 回归通道全部绘制数据（点序列 + 配色，与经典 SVG 一致）。 */
export interface RegressionChannelData {
  points: RegressionChannelPoint[];
  /** 轨间填充色（rgba，半透明）。 */
  areaFill: string;
  /** 上轨描边色（rgba）。 */
  upperStroke: string;
  /** 下轨描边色（rgba）。 */
  lowerStroke: string;
}

// 中轨色跟随主题 `--faint`（与经典 SVG 的 stroke="var(--faint)" opacity 0.5 同口径）；
// 读不到时退回深色主题默认值。
function faintColor(): string {
  if (typeof document === "undefined") return "#475569";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--faint").trim();
  return v || "#475569";
}

class ChannelRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: RegressionChannelPrimitive) {}

  draw(target: RenderTarget): void {
    const chart = this._src.chart;
    const series = this._src.series;
    const data = this._src.data;
    if (!chart || !series || !data || data.points.length < 2) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      // 把每根可定位的点换算成画布坐标（off-screen / 回放未到的点 timeToCoordinate 返回 null，跳过）。
      const cols: { x: number; yU: number; yM: number; yL: number }[] = [];
      for (const p of data.points) {
        const x = ts.timeToCoordinate(p.time);
        const yU = series.priceToCoordinate(p.upper);
        const yM = series.priceToCoordinate(p.mid);
        const yL = series.priceToCoordinate(p.lower);
        if (x == null || yU == null || yM == null || yL == null) continue;
        cols.push({ x, yU, yM, yL });
      }
      if (cols.length < 2) return;

      // 1) 轨间填充带：沿上轨左→右，再沿下轨右→左闭合。
      ctx.beginPath();
      ctx.moveTo(cols[0].x, cols[0].yU);
      for (let i = 1; i < cols.length; i++) ctx.lineTo(cols[i].x, cols[i].yU);
      for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i].x, cols[i].yL);
      ctx.closePath();
      ctx.fillStyle = data.areaFill;
      ctx.fill();

      // 2) 三轨描边：上/下轨虚线（dash 2 3），中轨更淡点线（dash 1 4，opacity 0.5）。
      const stroke = (key: "yU" | "yM" | "yL", color: string, dash: number[], width: number, alpha: number) => {
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.lineWidth = width;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.moveTo(cols[0].x, cols[0][key]);
        for (let i = 1; i < cols.length; i++) ctx.lineTo(cols[i].x, cols[i][key]);
        ctx.stroke();
        ctx.restore();
      };
      stroke("yU", data.upperStroke, [2, 3], 1.2, 1);
      stroke("yL", data.lowerStroke, [2, 3], 1.2, 1);
      stroke("yM", faintColor(), [1, 4], 0.8, 0.5);
    });
  }
}

class ChannelView implements IPrimitivePaneView {
  private readonly _renderer: ChannelRenderer;
  constructor(src: RegressionChannelPrimitive) {
    this._renderer = new ChannelRenderer(src);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "bottom"; // 画在 K 线之下，不遮挡蜡烛/买卖标记
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/** 回归通道 primitive：attach 到蜡烛序列即绘制（数据不可变，通道变更时由调用方重建并重新 attach）。 */
export class RegressionChannelPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  readonly data: RegressionChannelData;
  private readonly _views: ChannelView[];

  constructor(data: RegressionChannelData) {
    this.data = data;
    this._views = [new ChannelView(this)];
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
