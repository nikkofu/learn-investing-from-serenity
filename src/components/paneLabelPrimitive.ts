/**
 * 窗格名称标签基元：在所附序列所在窗格的左上角画一行小字（如「MACD」「RSI」「KDJ」）。
 * lightweight-charts 没有原生的「副图标题」，故用 series primitive 在该窗格画布上直接绘制文字。
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

class LabelRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: PaneLabelPrimitive) {}
  draw(target: RenderTarget): void {
    const text = this._src.text;
    const color = this._src.color;
    if (!text) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.font = "bold 10px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillStyle = color;
      ctx.fillText(text, 6, 3);
      ctx.restore();
    });
  }
}

class LabelView implements IPrimitivePaneView {
  private readonly _renderer: LabelRenderer;
  constructor(src: PaneLabelPrimitive) {
    this._renderer = new LabelRenderer(src);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

export class PaneLabelPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  text: string;
  readonly color: string;
  private _requestUpdate: (() => void) | null = null;
  private readonly _views: LabelView[];

  constructor(text: string, color: string) {
    this.text = text;
    this.color = color;
    this._views = [new LabelView(this)];
  }
  /** 更新标签文字（随光标显示当前数值），触发轻量重绘。 */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this._requestUpdate?.();
  }
  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this._requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this._requestUpdate = null;
  }
  updateAllViews(): void {}
  paneViews(): readonly IPrimitivePaneView[] {
    return this._views;
  }
}
