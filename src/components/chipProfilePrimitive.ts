/**
 * 筹码分布渲染层（lightweight-charts v5 自定义 series primitive）。
 *
 * 在主图右侧画一条「按价格分箱的筹码量水平直方图」（VRVP 风格）：每个价格箱体一根横条，长度正比
 * 于该价位的累积筹码量；以「指定日期」当日收盘价分色（获利盘红 / 套牢盘蓝，遵循 A 股红涨绿跌的
 * 表意惯例）；并在「区间内成交量最高那天的价格」对应的筹码位置画一条醒目的琥珀色条纹标注。
 *
 * 数据随鼠标悬停的日期实时变化（= 截至该日的筹码分布），由调用方在 crosshair move 时算好并通过
 * setData() 注入；primitive 用 attached 时拿到的 requestUpdate 触发轻量重绘，不重建图表。
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

export interface ChipProfileBin {
  price: number;
  volume: number;
}
export interface ChipProfileData {
  bins: ChipProfileBin[];
  maxVolume: number;
  /** 区间内成交量最高那天的收盘价（在筹码图上以条纹标注），无则 null。 */
  highlightPrice: number | null;
  /** 指定日期当日收盘价，用于获利/套牢分色，无则 null。 */
  currentPrice: number | null;
  /** 指定日期标签（画在直方图顶部）。 */
  dateLabel: string;
}

const EMPTY: ChipProfileData = { bins: [], maxVolume: 0, highlightPrice: null, currentPrice: null, dateLabel: "" };

class ChipRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: ChipProfilePrimitive) {}

  draw(target: RenderTarget): void {
    const series = this._src.series;
    if (!series || !this._src.enabled) return;
    const data = this._src.data;
    if (!data || data.bins.length === 0 || data.maxVolume <= 0) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const W = scope.mediaSize.width;
      const maxW = Math.min(150, W * 0.2); // 直方图最大宽度（右侧留白区）
      const rightX = W; // 贴右边缘

      // 横条厚度：用首尾箱体的像素跨度按箱数均分（兼容对数/百分比标度的非线性）。
      const yFirst = series.priceToCoordinate(data.bins[0].price);
      const yLast = series.priceToCoordinate(data.bins[data.bins.length - 1].price);
      let thickness = 5;
      if (yFirst != null && yLast != null && data.bins.length > 1) {
        thickness = Math.max(2, (Math.abs(yLast - yFirst) / (data.bins.length - 1)) * 0.82);
      }

      ctx.save();
      // 1) 各价位筹码横条
      for (const b of data.bins) {
        if (b.volume <= 0) continue;
        const y = series.priceToCoordinate(b.price);
        if (y == null) continue;
        const w = maxW * (b.volume / data.maxVolume);
        if (w < 0.5) continue;
        const profit = data.currentPrice != null && b.price <= data.currentPrice;
        ctx.fillStyle = profit ? "rgba(239, 68, 68, 0.34)" : "rgba(56, 189, 248, 0.30)";
        ctx.fillRect(rightX - w, y - thickness / 2, w, thickness);
      }

      // 2) 高量日价格 → 筹码条纹（贯穿直方图区的琥珀色横纹 + 价签）
      if (data.highlightPrice != null) {
        const hy = series.priceToCoordinate(data.highlightPrice);
        if (hy != null) {
          ctx.beginPath();
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "#f59e0b";
          ctx.moveTo(rightX - maxW, hy);
          ctx.lineTo(rightX, hy);
          ctx.stroke();
          ctx.setLineDash([]);
          const tag = `高量 ${data.highlightPrice.toFixed(2)}`;
          ctx.font = "9px sans-serif";
          const tw = ctx.measureText(tag).width + 6;
          ctx.fillStyle = "#f59e0b";
          ctx.fillRect(rightX - maxW - tw - 2, hy - 7, tw, 14);
          ctx.fillStyle = "#1a1a1a";
          ctx.textBaseline = "middle";
          ctx.fillText(tag, rightX - maxW - tw + 1, hy);
        }
      }

      // 3) 顶部标题：筹码@指定日期
      if (data.dateLabel) {
        const title = `筹码@${data.dateLabel}`;
        ctx.font = "bold 9px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
        const tw = ctx.measureText(title).width;
        ctx.fillText(title, rightX - tw - 4, 4);
      }
      ctx.restore();
    });
  }
}

class ChipView implements IPrimitivePaneView {
  private readonly _renderer: ChipRenderer;
  constructor(src: ChipProfilePrimitive) {
    this._renderer = new ChipRenderer(src);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "top"; // 画在 K 线之上（半透明），保证右侧筹码分布醒目
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

export class ChipProfilePrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  data: ChipProfileData;
  enabled: boolean;
  private _requestUpdate: (() => void) | null = null;
  private readonly _views: ChipView[];

  constructor(initial?: ChipProfileData, enabled = true) {
    this.data = initial ?? EMPTY;
    this.enabled = enabled;
    this._views = [new ChipView(this)];
  }

  /** 注入新的筹码数据（指定日期变化时调用），并触发轻量重绘。 */
  setData(data: ChipProfileData): void {
    this.data = data;
    this._requestUpdate?.();
  }
  /** 开关显示。 */
  setEnabled(on: boolean): void {
    this.enabled = on;
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
