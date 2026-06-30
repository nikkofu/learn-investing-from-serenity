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
  /** 每根 K 线的中轨价位位移（= slope×周期折算），用于向右线性外推预测段。 */
  slopePerBar: number;
  /** 预测段根数：自最后一根向右外推多少根（回归通道延伸/预测区）。 */
  projectBars: number;
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
      type Col = { x: number; yU: number; yM: number; yL: number };
      // 历史段：把每根可定位的点换算成画布坐标（off-screen / 回放未到的点 timeToCoordinate 返回 null，跳过）。
      const hist: Col[] = [];
      for (const p of data.points) {
        const x = ts.timeToCoordinate(p.time);
        const yU = series.priceToCoordinate(p.upper);
        const yM = series.priceToCoordinate(p.mid);
        const yL = series.priceToCoordinate(p.lower);
        if (x == null || yU == null || yM == null || yL == null) continue;
        hist.push({ x, yU, yM, yL });
      }
      if (hist.length < 2) return;

      // 预测段：自最后一根已结算点起按每根斜率向右线性外推 projectBars 根（回归通道延伸/预测区）。
      // x 用 barSpacing 推进（未来根无数据点、timeToCoordinate 取不到），y 仍用 priceToCoordinate 以兼容对数/百分比标度。
      const proj: Col[] = [];
      const last = data.points[data.points.length - 1];
      const upperDiff = last.upper - last.mid;
      const lowerDiff = last.mid - last.lower;
      const bs = ts.options().barSpacing;
      const xLast = hist[hist.length - 1].x;
      for (let k = 1; k <= data.projectBars && bs > 0; k++) {
        const midP = last.mid + data.slopePerBar * k;
        const yU = series.priceToCoordinate(midP + upperDiff);
        const yM = series.priceToCoordinate(midP);
        const yL = series.priceToCoordinate(midP - lowerDiff);
        if (yU == null || yM == null || yL == null) continue;
        proj.push({ x: xLast + k * bs, yU, yM, yL });
      }
      const all = proj.length ? hist.concat(proj) : hist;

      // 1) 轨间填充带（历史 + 预测整体），沿上轨左→右、下轨右→左闭合。
      ctx.beginPath();
      ctx.moveTo(all[0].x, all[0].yU);
      for (let i = 1; i < all.length; i++) ctx.lineTo(all[i].x, all[i].yU);
      for (let i = all.length - 1; i >= 0; i--) ctx.lineTo(all[i].x, all[i].yL);
      ctx.closePath();
      ctx.fillStyle = data.areaFill;
      ctx.fill();

      // 2) 三轨描边：历史段实显，预测段更长虚线 + 更低不透明度以示「外推预测」。
      const strokeRun = (cols: Col[], key: "yU" | "yM" | "yL", color: string, dash: number[], width: number, alpha: number) => {
        if (cols.length < 2) return;
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
      const fc = faintColor();
      strokeRun(hist, "yU", data.upperStroke, [2, 3], 1.6, 1);
      strokeRun(hist, "yL", data.lowerStroke, [2, 3], 1.6, 1);
      strokeRun(hist, "yM", fc, [1, 4], 1, 0.6);
      if (proj.length) {
        const pj = [hist[hist.length - 1], ...proj];
        strokeRun(pj, "yU", data.upperStroke, [6, 4], 1.4, 0.7);
        strokeRun(pj, "yL", data.lowerStroke, [6, 4], 1.4, 0.7);
        strokeRun(pj, "yM", fc, [2, 5], 0.9, 0.45);
      }
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
