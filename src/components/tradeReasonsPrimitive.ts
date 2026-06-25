/**
 * 买卖 BS 点「触发理由」常驻标注层（lightweight-charts v5 自定义 series primitive）。
 *
 * lightweight-charts 的 setMarkers 标记文案是单行、且在拥挤时会被库自动丢弃，无法稳定
 * 地在每个 BS 点旁常驻展示「触发理由」。故用官方 series primitive 接口在画布上直接绘制
 * 一枚枚小标签：买点画在 K 线下方、卖点画在上方，标签内容 = 策略简称（理由【…】）+ 卖点
 * 本笔盈亏。坐标用 media 空间（CSS 像素），与 priceToCoordinate / timeToCoordinate 同口径，
 * 因此随平移 / 缩放自动重排；同一 lane（买 / 卖）内自左向右贪心避让，互相重叠的标签跳过，
 * 避免长周期密集成交时糊成一片。
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

/** 单个 BS 点的理由标签数据。 */
export interface TradeReasonLabel {
  time: Time;
  /** 锚定价位：买点用当根最低价（标签落在 K 线下方）、卖点用最高价（落在上方）。 */
  anchorPrice: number;
  isBuy: boolean;
  /** 策略简称（理由【…】内文案，已去版本号）。 */
  tag: string;
  /** 卖点本笔盈亏文案，如 "+8.5%"；买点为空。 */
  pct?: string;
}

export interface TradeReasonsData {
  labels: TradeReasonLabel[];
  /** 关闭时整层不绘制（工具栏「BS理由」开关）。 */
  enabled: boolean;
}

const BUY_COLOR = "#ef4444"; // 买 / 看多（A股涨色红）
const SELL_COLOR = "#10b981"; // 卖 / 看空（A股跌色绿）
const PROFIT_UP = "#f87171"; // 盈（红）
const PROFIT_DN = "#34d399"; // 亏（绿）
const FONT_SIZE = 10;
const PAD_X = 4;
const GAP = 3;
const BOX_H = FONT_SIZE + 6;
const ANCHOR_GAP = 46; // 标签与 K 线高低点的像素间距：需越过库自带的 B/S 仓位标记（箭头+文字），并向边缘外推以免遮挡 MA / 指标线

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

class ReasonsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: TradeReasonsPrimitive) {}

  draw(target: RenderTarget): void {
    const chart = this._src.chart;
    const series = this._src.series;
    const data = this._src.data;
    if (!chart || !series || !data || !data.enabled || data.labels.length === 0) return;
    const ts = chart.timeScale();

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      ctx.save();
      ctx.font = `bold ${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textBaseline = "middle";

      const placeLane = (isBuy: boolean) => {
        const items = data.labels
          .filter((l) => l.isBuy === isBuy && l.tag)
          .map((l) => {
            const x = ts.timeToCoordinate(l.time);
            const yAnchor = series.priceToCoordinate(l.anchorPrice);
            if (x == null || yAnchor == null) return null;
            const tagW = ctx.measureText(l.tag).width;
            const pctW = l.pct ? ctx.measureText(l.pct).width + GAP : 0;
            const w = tagW + pctW + PAD_X * 2;
            return { l, x, yAnchor, w, tagW };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null)
          .sort((a, b) => a.x - b.x);

        let lastRight = -Infinity;
        for (const it of items) {
          const rawLeft = it.x - it.w / 2;
          // 横向避让：与上一枚已绘标签重叠则跳过。
          if (rawLeft < lastRight + 2) continue;
          const left = Math.max(2, Math.min(width - it.w - 2, rawLeft));
          lastRight = left + it.w;
          const top = isBuy ? it.yAnchor + ANCHOR_GAP : it.yAnchor - ANCHOR_GAP - BOX_H;
          const laneColor = isBuy ? BUY_COLOR : SELL_COLOR;

          roundRect(ctx, left, top, it.w, BOX_H, 2);
          ctx.fillStyle = "rgba(15,23,42,0.86)";
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = laneColor;
          ctx.stroke();

          ctx.textAlign = "left";
          ctx.fillStyle = laneColor;
          ctx.fillText(it.l.tag, left + PAD_X, top + BOX_H / 2);
          if (it.l.pct) {
            ctx.fillStyle = it.l.pct.startsWith("-") ? PROFIT_DN : PROFIT_UP;
            ctx.fillText(it.l.pct, left + PAD_X + it.tagW + GAP, top + BOX_H / 2);
          }
        }
      };

      placeLane(true);
      placeLane(false);
      ctx.restore();
    });
  }
}

class ReasonsView implements IPrimitivePaneView {
  private readonly _renderer: ReasonsRenderer;
  constructor(src: TradeReasonsPrimitive) {
    this._renderer = new ReasonsRenderer(src);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/** BS 理由标注 primitive：attach 到蜡烛序列即可绘制（数据变更时由调用方重建并重新 attach）。 */
export class TradeReasonsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  readonly data: TradeReasonsData;
  private readonly _views: ReasonsView[];

  constructor(data: TradeReasonsData) {
    this.data = data;
    this._views = [new ReasonsView(this)];
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
