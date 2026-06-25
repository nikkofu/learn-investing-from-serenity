/**
 * 交易计划色块渲染层（lightweight-charts v5 自定义 series primitive）。
 *
 * 复刻 TradingView「Cardwell RSI Trade Navigator [MarkitTick]」等脚本里那套醒目的
 * 交易计划可视化：以入场根为锚向右画一组水平矩形带——风险带（Entry↔止损，红）+
 * 多层盈利带（Entry↔TP1↔TP2↔TP3，绿），每个价位再配一条贯穿的虚线 + 右侧价格轴标签
 * （× SL / ► Entry / ● TP1 / ★ TP2 / ▲ TP3）。
 *
 * lightweight-charts 的 LineSeries/AreaSeries 无法表达「两价位之间、自某根向右延伸的填充矩形」，
 * 故用官方的 series primitive 接口在画布上直接绘制：
 *   - 填充矩形 → zOrder "bottom"（画在 K 线之下，半透明，不挡蜡烛）；
 *   - 价位虚线 → zOrder "top"（画在 K 线之上，清晰可见，对标 TV）；
 *   - 右轴标签 → priceAxisViews（库自动避让堆叠，颜色/文案完全自定义）。
 * 坐标用 media 空间（CSS 像素），与 priceToCoordinate / timeToCoordinate 的返回口径一致。
 */
import type {
  IChartApi,
  ISeriesApi,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

// 从库的渲染器签名里取出画布目标类型（CanvasRenderingTarget2D），避免直接依赖 fancy-canvas。
type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** 一条填充带：from~to 两价位之间、自锚点向右延伸的矩形。 */
export interface TradeZoneBand {
  from: number;
  to: number;
  /** 半透明填充色（rgba）。 */
  fill: string;
}

/** 一个价位刻度：贯穿虚线 + 右轴标签。 */
export interface TradeZoneLevel {
  price: number;
  lineColor: string;
  /** 右轴标签文案（如 "SL 4.83" / "Entry 4.48" / "TP1 4.13"）。 */
  axisText: string;
  axisBg: string;
  axisFg: string;
}

/** 交易计划色块的全部绘制数据。 */
export interface TradeZonesData {
  /** 入场锚定根的时间：矩形带从这里向右画到画布右沿。 */
  anchorTime: Time;
  bands: TradeZoneBand[];
  levels: TradeZoneLevel[];
}

class ZonesRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: TradeZonesPrimitive, private readonly _mode: "fill" | "line") {}

  draw(target: RenderTarget): void {
    const chart = this._src.chart;
    const series = this._src.series;
    const data = this._src.data;
    if (!chart || !series || !data) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      // 锚定根不在当前序列数据里（如逐根回放游标尚未到入场根）→ 不画，避免色块铺满全图。
      const xc = ts.timeToCoordinate(data.anchorTime);
      if (xc == null) return;
      const x0 = xc;
      if (x0 >= width) return;

      if (this._mode === "fill") {
        for (const b of data.bands) {
          const yA = series.priceToCoordinate(b.from);
          const yB = series.priceToCoordinate(b.to);
          if (yA == null || yB == null) continue;
          ctx.fillStyle = b.fill;
          ctx.fillRect(x0, Math.min(yA, yB), width - x0, Math.abs(yA - yB));
        }
        return;
      }

      ctx.save();
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1;
      for (const lv of data.levels) {
        const y = series.priceToCoordinate(lv.price);
        if (y == null) continue;
        ctx.strokeStyle = lv.lineColor;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class ZonesView implements IPrimitivePaneView {
  private readonly _renderer: ZonesRenderer;
  constructor(src: TradeZonesPrimitive, private readonly _mode: "fill" | "line") {
    this._renderer = new ZonesRenderer(src, _mode);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return this._mode === "fill" ? "bottom" : "top";
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/** 交易计划色块 primitive：attach 到蜡烛序列即可绘制（数据不可变，计划变更时由调用方重建并重新 attach）。 */
export class TradeZonesPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  readonly data: TradeZonesData;
  private readonly _views: ZonesView[];
  private _axisViews: ISeriesPrimitiveAxisView[] = [];

  constructor(data: TradeZonesData) {
    this.data = data;
    this._views = [new ZonesView(this, "fill"), new ZonesView(this, "line")];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    const series = this.series;
    this._axisViews = this.data.levels.map((lv) => ({
      coordinate: () => series.priceToCoordinate(lv.price) ?? -100,
      text: () => lv.axisText,
      textColor: () => lv.axisFg,
      backColor: () => lv.axisBg,
      visible: () => true,
      tickVisible: () => true,
    }));
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this._axisViews = [];
  }

  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return this._views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this._axisViews;
  }
}
