"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  createSeriesMarkers,
  CrosshairMode,
  PriceScaleMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type ISeriesMarkersPluginApi,
  type Time,
  type CandlestickData,
  type LineData,
  type WhitespaceData,
} from "lightweight-charts";
import type { Candle } from "@/lib/types";
import type { TradeAction } from "@/lib/quant";
import { candlesByPeriod } from "@/lib/candleAgg";
import { computeMACD, computeRSI, computeKDJ, computeBOLL, computeResonance } from "@/lib/indicators";
import type { ChartDrawing, MarkerDrawing, DrawingColor } from "@/lib/drawings";
import { listTvStrategies, getTvStrategy, type TvStrategyLayers, type TradePlan } from "@/lib/tvStrategies";
import { TradeZonesPrimitive, type TradeZonesData, type TradeZoneBand, type TradeZoneLevel } from "./tradeZonesPrimitive";

interface LightweightChartProps {
  candles: Candle[];
  trades: TradeAction[];
  code?: string;
  fq?: "qfq" | "hfq";
  drawings?: ChartDrawing[];
  /** 初始策略图层 id（如从 ?layer= 进入时自动叠加 TV 复刻策略，""=关闭）。 */
  initialTvStrategyId?: string;
}

// AI 画图叠加层配色（语义色，与蜡烛涨跌色区分开）
const DRAW_COLORS: Record<DrawingColor, string> = {
  support: "#38bdf8",
  resistance: "#f59e0b",
  neutral: "#94a3b8",
  bull: "#10b981",
  bear: "#ef4444",
};
const drawColor = (c?: DrawingColor) => DRAW_COLORS[c ?? "neutral"];

type Timeframe = "5m" | "15m" | "30m" | "60m" | "1D" | "1W" | "1M";
const INTRADAY_TFS: Timeframe[] = ["5m", "15m", "30m", "60m"];
const DAILY_TFS: Timeframe[] = ["1D", "1W", "1M"];

const UP = "#ef4444"; // 阳（涨）红
const DOWN = "#10b981"; // 阴（跌）绿
const RESONANCE = "#e879f9"; // 共振标注色（紫粉，与涨跌/买卖标记区分）

const MA_DEFS: { period: number; color: string; key: string }[] = [
  { period: 5, color: "#fef08a", key: "ma5" },
  { period: 10, color: "#c084fc", key: "ma10" },
  { period: 20, color: "#4ade80", key: "ma20" },
  { period: 60, color: "#fb923c", key: "ma60" },
  { period: 120, color: "#a855f7", key: "ma120" },
  { period: 250, color: "#ef4444", key: "ma250" },
];

const REPLAY_SPEEDS: { label: string; ms: number }[] = [
  { label: "慢", ms: 700 },
  { label: "中", ms: 350 },
  { label: "快", ms: 120 },
];

// 分时（5/15/30/60m）日期形如 "YYYY-MM-DD HH:MM"（北京时间）：按 UTC 解析成时间戳，
// 使 lightweight-charts 的 UTC 标签恰好显示为北京钟面时间；日线则用业务日字符串。
const isIntradayTf = (tf: Timeframe) => tf.endsWith("m");
function makeToTime(intraday: boolean) {
  return (d: string): Time =>
    intraday
      ? (Math.floor(Date.parse(d.replace(" ", "T") + ":00Z") / 1000) as unknown as Time)
      : (d as unknown as Time);
}

function maOf(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Wilder ATR（与 GBB Supertrend 同口径 ATR(10)）：返回与 K 线等长数组。
function atrOf(candles: Candle[], period = 10): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  let atr = NaN;
  for (let i = 0; i < n; i++) {
    const h = candles[i].high, l = candles[i].low;
    const pc = i > 0 ? candles[i - 1].close : candles[i].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    if (i === 0) atr = tr;
    else if (i < period) atr = (atr * i + tr) / (i + 1);
    else atr = (atr * (period - 1) + tr) / period;
    out[i] = atr;
  }
  return out;
}

// Wilder ADX（趋势强度 0~100）：返回与 K 线等长数组。
function adxOf(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;
  let trS = 0, pdmS = 0, ndmS = 0, adx = NaN;
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    const pdm = up > dn && up > 0 ? up : 0;
    const ndm = dn > up && dn > 0 ? dn : 0;
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    if (i <= period) { trS += tr; pdmS += pdm; ndmS += ndm; if (i < period) continue; }
    else { trS = trS - trS / period + tr; pdmS = pdmS - pdmS / period + pdm; ndmS = ndmS - ndmS / period + ndm; }
    const pdi = trS ? (100 * pdmS) / trS : 0;
    const ndi = trS ? (100 * ndmS) / trS : 0;
    const dx = pdi + ndi ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
    if (i < 2 * period) { adx = Number.isNaN(adx) ? dx : (adx * (i - period) + dx) / (i - period + 1); }
    else adx = (adx * (period - 1) + dx) / period;
    out[i] = adx;
  }
  return out;
}

// 由交易计划构造色块渲染数据（对标 TV Cardwell RSI Trade Navigator）：
// 风险带（Entry↔SL，红）+ 多层盈利带（Entry↔TP1↔TP2↔TP3，绿，越近入场越浓）+ 各价位右轴标签。
// 配色按「盈亏语义」（红=风险/绿=盈利，同 TV），与 A 股蜡烛涨跌色（红涨绿跌）属不同维度。
const ZONE_RISK = "239,68,68"; // 红
const ZONE_REWARD = "16,185,129"; // 绿
const ZONE_TP_SYM = ["●", "★", "▲"];
const ZONE_REWARD_ALPHA = [0.2, 0.15, 0.11, 0.08];
function buildTradeZones(plan: TradePlan, anchorTime: Time): TradeZonesData {
  const f = (v: number) => v.toFixed(2);
  const bands: TradeZoneBand[] = [{ from: plan.entry, to: plan.stop, fill: `rgba(${ZONE_RISK},0.16)` }];
  const ladder = [plan.entry, ...plan.targets.map((t) => t.price)];
  for (let k = 0; k < ladder.length - 1; k++) {
    bands.push({ from: ladder[k], to: ladder[k + 1], fill: `rgba(${ZONE_REWARD},${ZONE_REWARD_ALPHA[Math.min(k, ZONE_REWARD_ALPHA.length - 1)]})` });
  }
  const levels: TradeZoneLevel[] = [
    { price: plan.stop, lineColor: `rgba(${ZONE_RISK},0.9)`, axisText: `× SL ${f(plan.stop)}`, axisBg: "#b91c1c", axisFg: "#fff" },
    { price: plan.entry, lineColor: "rgba(96,165,250,0.95)", axisText: `► Entry ${f(plan.entry)}`, axisBg: "#1e3a8a", axisFg: "#fff" },
    ...plan.targets.map((t, k): TradeZoneLevel => ({
      price: t.price,
      lineColor: `rgba(${ZONE_REWARD},0.9)`,
      axisText: `${ZONE_TP_SYM[Math.min(k, ZONE_TP_SYM.length - 1)]} ${t.label} ${f(t.price)}`,
      axisBg: "#047857",
      axisFg: "#fff",
    })),
  ];
  return { anchorTime, bands, levels };
}

export default function LightweightChart({ candles: rawCandles, trades, code, fq = "qfq", drawings = [], initialTvStrategyId = "" }: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // 每个序列携带自己的「按可见 K 线重绘」闭包，回放时仅重绘数据、不重建图表。
  const paintersRef = useRef<((vc: Candle[]) => void)[]>([]);

  const [period, setPeriod] = useState<Timeframe>("1D");
  const [yScaleMode, setYScaleMode] = useState<"linear" | "log" | "pct">("linear");
  // 副图振荡指标默认全开，各占独立窗格（分开显示，量纲不互扰）
  const [indMacd, setIndMacd] = useState(true);
  const [indRsi, setIndRsi] = useState(true);
  const [indKdj, setIndKdj] = useState(true);
  const [showBoll, setShowBoll] = useState(true);
  const [showResonance, setShowResonance] = useState(true);
  // 策略图层：选中的 TradingView 复刻策略 id（""=关闭）
  const [tvStrategyId, setTvStrategyId] = useState(initialTvStrategyId);
  // 从 ?layer= 进入或外部切换标的时，跟随更新选中的策略图层（让「从回测页点进自动叠加」生效）。
  useEffect(() => {
    setTvStrategyId(initialTvStrategyId);
  }, [initialTvStrategyId]);
  const [maOn, setMaOn] = useState<Record<string, boolean>>({ ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma250: false });
  const [legend, setLegend] = useState<{ date: string; o: number; h: number; l: number; c: number; v: number; chg: number; reso?: string; st?: string } | null>(null);

  // 逐根回放：replayN = 当前显露的 K 线根数（null = 关闭，显示全部）
  const [replayN, setReplayN] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(350);

  // 日内分时：选中 5/15/30/60m 时按需拉取（不走日线 props）
  const [intradayCandles, setIntradayCandles] = useState<Candle[] | null>(null);
  const [tfLoading, setTfLoading] = useState(false);
  const [tfErr, setTfErr] = useState("");
  const intraday = isIntradayTf(period);

  const candles = useMemo(
    () => (intraday ? intradayCandles ?? [] : candlesByPeriod(rawCandles, period as "1D" | "1W" | "1M")),
    [rawCandles, period, intraday, intradayCandles]
  );
  const toTime = useCallback((d: string): Time => makeToTime(intraday)(d), [intraday]);
  const macd = useMemo(() => computeMACD(candles), [candles]);
  const rsi = useMemo(() => computeRSI(candles), [candles]);
  const kdj = useMemo(() => computeKDJ(candles), [candles]);
  const boll = useMemo(() => computeBOLL(candles), [candles]);
  const resonance = useMemo(() => computeResonance(candles, macd, rsi, kdj, boll), [candles, macd, rsi, kdj, boll]);
  const resoByDate = useMemo(() => {
    const m = new Map<string, (typeof resonance)[number]>();
    for (const r of resonance) { const c = candles[r.index]; if (c) m.set(c.date, r); }
    return m;
  }, [resonance, candles]);

  // 策略图层：已复刻的 TV 策略列表 + 当前选中策略算出的图层（方向线/翻转点/regime）
  const tvMetas = useMemo(() => listTvStrategies(), []);
  const tvLayers = useMemo<TvStrategyLayers | null>(
    () => (tvStrategyId ? getTvStrategy(tvStrategyId)?.compute(candles) ?? null : null),
    [tvStrategyId, candles]
  );
  // 某根的策略读数（多空 / regime / 线值），供读数条展示。
  const tvReadout = useCallback(
    (idx: number): string | undefined => {
      if (!tvLayers || idx < 0 || idx >= candles.length) return undefined;
      const d = tvLayers.dir[idx];
      const rg = tvLayers.regime[idx];
      const lv = tvLayers.line[idx];
      const rv = tvLayers.regimeValue[idx];
      const dirTxt = d === 1 ? "多头" : d === -1 ? "空头" : "--";
      const rgTxt = rg === "trend" ? "趋势" : rg === "chop" ? "震荡" : "转折";
      const effTxt = Number.isFinite(rv) ? ` · 效率 ${(rv * 100).toFixed(0)}%` : "";
      return `${dirTxt} · ${rgTxt}${effTxt}${Number.isFinite(lv as number) ? ` · 线 ${(lv as number).toFixed(2)}` : ""}`;
    },
    [tvLayers, candles]
  );

  const startN = useMemo(() => Math.min(60, candles.length), [candles.length]);
  const viewCandles = useMemo(
    () => (replayN === null ? candles : candles.slice(0, Math.max(1, Math.min(replayN, candles.length)))),
    [candles, replayN]
  );

  // GBB 统计表（对标 TV [GBB] 右上角面板）：当前显露末根的 Trend / ATR / ADX / Strength / HTF Bias / Since Signal。
  // 仅对「跟踪线型」策略（无 tradePlan，如 GBB）展示；带交易计划的策略（如 Cardwell）改用下方 Navigator 面板。
  const gbbStats = useMemo(() => {
    if (!tvLayers || tvLayers.tradePlan || viewCandles.length === 0) return null;
    const idx = viewCandles.length - 1;
    const atr = atrOf(candles, 10);
    const adx = adxOf(candles, 14);
    const ma50 = maOf(candles, 50);
    const d = tvLayers.dir[idx];
    const rv = tvLayers.regimeValue[idx];
    const past = tvLayers.flips.filter((f) => f.index <= idx);
    const sinceSignal = past.length ? idx - past[past.length - 1].index : null;
    const m = ma50[idx];
    const htf = m == null ? "--" : candles[idx].close >= m ? "多" : "空";
    return {
      trendUp: d === 1,
      trend: d === 1 ? "多头 Bull" : d === -1 ? "空头 Bear" : "--",
      atr: Number.isFinite(atr[idx]) ? atr[idx] : NaN,
      adx: Number.isFinite(adx[idx]) ? adx[idx] : NaN,
      strength: Number.isFinite(rv) ? rv * 100 : NaN,
      htf,
      sinceSignal,
    };
  }, [tvLayers, viewCandles, candles]);

  // Navigator 面板（对标 TV Cardwell RSI Trade Navigator 右上角读数）：方向 / RSI / 入场 / 止损 / 目标 / 距信号根数。
  const navStats = useMemo(() => {
    const plan = tvLayers?.tradePlan;
    if (!plan || viewCandles.length === 0) return null;
    const idx = viewCandles.length - 1;
    const sinceSignal = idx - plan.anchorIndex;
    return {
      dir: plan.dir,
      bias: plan.dir === 1 ? "多 Bull" : "空 Bear",
      rsiVal: Number.isFinite(rsi[idx]) ? rsi[idx] : NaN,
      entry: plan.entry,
      stop: plan.stop,
      targets: plan.targets,
      sinceSignal: sinceSignal >= 0 ? sinceSignal : null,
    };
  }, [tvLayers, viewCandles, rsi]);

  // 切换标的/周期后回放参数复位
  useEffect(() => {
    setReplayN(null);
    setPlaying(false);
  }, [rawCandles, period]);

  // 日内分时按需拉取（切换个股/复权/分钟周期重拉）
  useEffect(() => {
    if (!intraday) {
      setIntradayCandles(null);
      setTfErr("");
      return;
    }
    if (!code) return;
    let cancelled = false;
    setTfLoading(true);
    setTfErr("");
    fetch(`/api/market/kline?code=${code}&period=${period}&fq=${fq}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || `加载失败: ${r.status}`);
        if (!cancelled) setIntradayCandles(j.candles ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setTfErr(e instanceof Error ? e.message : "分时加载失败");
          setIntradayCandles([]);
        }
      })
      .finally(() => {
        if (!cancelled) setTfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [intraday, code, period, fq]);

  // 将当前可见 K 线刷到所有序列 + 标记 + 读数条
  const paint = useCallback((vc: Candle[]) => {
    for (const p of paintersRef.current) p(vc);
    const inRange = new Set(vc.map((c) => c.date));
    const markers: SeriesMarker<Time>[] = trades
      .filter((t) => inRange.has(t.date))
      .map((t) => ({
        time: toTime(t.date),
        position: t.type === "buy" ? "belowBar" : "aboveBar",
        color: t.type === "buy" ? DOWN : UP,
        shape: t.type === "buy" ? "arrowUp" : "arrowDown",
        text: t.type === "buy" ? "B" : "S",
      }));
    const drawMarkers: SeriesMarker<Time>[] = (intraday ? [] : drawings)
      .filter((d): d is MarkerDrawing => d.type === "marker")
      .map((d) => ({ time: toTime(d.date), position: "aboveBar", color: drawColor(d.color), shape: "circle", text: d.text }));
    const stFlipMarkers: SeriesMarker<Time>[] = tvLayers
      ? tvLayers.flips
          .filter((f) => f.index <= vc.length - 1)
          .map((f): SeriesMarker<Time> => {
            const c = candles[f.index];
            return {
              time: toTime(c.date),
              position: f.dir === "up" ? "belowBar" : "aboveBar",
              color: f.dir === "up" ? UP : DOWN,
              shape: f.dir === "up" ? "arrowUp" : "arrowDown",
              text: f.dir === "up" ? "翻多" : "翻空",
            };
          })
      : [];
    const resoMarkers: SeriesMarker<Time>[] = showResonance
      ? resonance
          .filter((r) => r.index <= vc.length - 1)
          .map((r) => {
            const c = candles[r.index];
            return {
              time: toTime(c.date),
              position: r.dir === "bull" ? "belowBar" : "aboveBar",
              color: RESONANCE,
              shape: "circle" as const,
              text: `共振${r.dir === "bull" ? "▲" : "▼"}×${r.score}`,
            };
          })
      : [];
    const all = [...markers, ...drawMarkers, ...resoMarkers, ...stFlipMarkers].sort((a, b) =>
      typeof a.time === "number" && typeof b.time === "number" ? a.time - b.time : String(a.time).localeCompare(String(b.time))
    );
    markersApiRef.current?.setMarkers(all);
    const last = vc[vc.length - 1];
    if (last) {
      const r = resoByDate.get(last.date);
      setLegend({ date: last.date, o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume || 0, chg: last.changePct ?? 0, reso: r ? `${r.dir === "bull" ? "看多共振" : "看空共振"}：${r.reasons.join("+")}` : undefined, st: tvReadout(vc.length - 1) });
    }
  }, [trades, toTime, drawings, intraday, showResonance, resonance, candles, resoByDate, tvLayers, tvReadout]);

  // 结构层：仅在「指标/周期/纵轴/副图」变化时重建图表与序列（不随回放游标变动）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;

    const css = getComputedStyle(document.documentElement);
    const textColor = css.getPropertyValue("--text").trim() || "#d4d4d4";
    const borderColor = css.getPropertyValue("--border").trim() || "#2a2a2a";

    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor, fontFamily: "monospace", fontSize: 10, attributionLogo: false, panes: { separatorColor: borderColor } },
      grid: { vertLines: { color: borderColor, style: LineStyle.Dotted }, horzLines: { color: borderColor, style: LineStyle.Dotted } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor, mode: yScaleMode === "log" ? PriceScaleMode.Logarithmic : yScaleMode === "pct" ? PriceScaleMode.Percentage : PriceScaleMode.Normal },
      timeScale: { borderColor, timeVisible: intraday, secondsVisible: false, rightOffset: 4 },
    });
    chartRef.current = chart;
    paintersRef.current = [];

    const candleSeries = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN });
    candleSeriesRef.current = candleSeries;
    paintersRef.current.push((vc) =>
      candleSeries.setData(vc.map((c): CandlestickData => ({ time: toTime(c.date), open: c.open, high: c.high, low: c.low, close: c.close })))
    );
    markersApiRef.current = createSeriesMarkers(candleSeries, []);

    // 成交量（主图底部叠加，独立隐藏价格轴）
    const volSeries = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: UP });
    paintersRef.current.push((vc) => volSeries.setData(vc.map((c) => ({ time: toTime(c.date), value: c.volume || 0, color: (c.close >= c.open ? UP : DOWN) + "66" }))));
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    // 均线
    for (const def of MA_DEFS) {
      if (!maOn[def.key]) continue;
      const s = chart.addSeries(LineSeries, { color: def.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      paintersRef.current.push((vc) => {
        const arr = maOf(vc, def.period);
        s.setData(vc.map((c, i) => (arr[i] != null ? { time: toTime(c.date), value: arr[i] as number } : null)).filter((p): p is { time: Time; value: number } => p !== null));
      });
    }

    // 布林带
    if (showBoll) {
      const mk = (pick: (b: typeof boll) => number[], dashed: boolean) => {
        const s = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        paintersRef.current.push((vc) => {
          const vals = pick(boll);
          s.setData(vc.map((c, i) => (Number.isFinite(vals[i]) ? { time: toTime(c.date), value: vals[i] } : null)).filter((p): p is { time: Time; value: number } => p !== null));
        });
      };
      mk((b) => b.upper, false);
      mk((b) => b.mid, true);
      mk((b) => b.lower, false);
    }

    // 策略图层：TradingView 复刻策略叠加（方向线，A 股配色多头红/空头绿，翻转处断开；翻多/翻空标记在 paint 中统一打）
    if (tvLayers) {
      // 双线着色（多头红 / 空头绿）：各自只在对应方向上有值、其余置空白。
      // 不依赖 lightweight-charts v5 线序列的「逐点色」（实测 v5 不渲染逐点 color，导致图层不可见），改用两条底色线保证清晰可见。
      // 趋势云带（对标 TV [GBB] 线附近的半透明填充）：两条 Area（多头绿 / 空头红），
      // 顶色半透明、底色全透明形成「贴线渐隐」的云带；自身线设透明，可见线由下方两条粗线绘制。
      const cloudUp = chart.addSeries(AreaSeries, { lineColor: "rgba(0,0,0,0)", topColor: "rgba(239,68,68,0.22)", bottomColor: "rgba(239,68,68,0.0)", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const cloudDn = chart.addSeries(AreaSeries, { lineColor: "rgba(0,0,0,0)", topColor: "rgba(16,185,129,0.20)", bottomColor: "rgba(16,185,129,0.0)", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const stUp = chart.addSeries(LineSeries, { color: UP, lineWidth: 3, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const stDn = chart.addSeries(LineSeries, { color: DOWN, lineWidth: 3, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      paintersRef.current.push((vc) => {
        const upData: (LineData<Time> | WhitespaceData<Time>)[] = [];
        const dnData: (LineData<Time> | WhitespaceData<Time>)[] = [];
        const upCloud: (LineData<Time> | WhitespaceData<Time>)[] = [];
        const dnCloud: (LineData<Time> | WhitespaceData<Time>)[] = [];
        for (let i = 0; i < vc.length; i++) {
          const t = toTime(vc[i].date);
          const v = tvLayers.line[i];
          const d = tvLayers.dir[i];
          if (v == null || !Number.isFinite(v) || d === 0) { upData.push({ time: t }); dnData.push({ time: t }); upCloud.push({ time: t }); dnCloud.push({ time: t }); continue; }
          if (d === 1) { upData.push({ time: t, value: v }); dnData.push({ time: t }); upCloud.push({ time: t, value: v }); dnCloud.push({ time: t }); }
          else { dnData.push({ time: t, value: v }); upData.push({ time: t }); dnCloud.push({ time: t, value: v }); upCloud.push({ time: t }); }
        }
        cloudUp.setData(upCloud);
        cloudDn.setData(dnCloud);
        stUp.setData(upData);
        stDn.setData(dnData);
      });

      // 当前交易计划（R 倍数目标）：若末根仍为多头，以最近一次翻多价为入场、Supertrend 线为止损，
      // 画出入场 / 止损 / 1R~3R 目标横线（对标 TV [GBB] 右侧的 R 目标盒，仅供研究、非投资建议）。
      const lastIdx = candles.length - 1;
      if (lastIdx >= 0 && tvLayers.dir[lastIdx] === 1) {
        const upFlips = tvLayers.flips.filter((f) => f.dir === "up" && f.index <= lastIdx);
        const entry = upFlips.length ? upFlips[upFlips.length - 1].price : NaN;
        const stop = tvLayers.line[lastIdx];
        if (Number.isFinite(entry) && stop != null && Number.isFinite(stop) && entry > stop) {
          const r = entry - stop;
          const lines: { price: number; color: string; style: LineStyle; title: string }[] = [
            { price: entry, color: "#f59e0b", style: LineStyle.Solid, title: "入场" },
            { price: stop, color: DOWN, style: LineStyle.Dashed, title: "止损" },
            { price: entry + r, color: UP, style: LineStyle.Dashed, title: "T1 · 1R" },
            { price: entry + 2 * r, color: UP, style: LineStyle.Dashed, title: "T2 · 2R" },
            { price: entry + 3 * r, color: UP, style: LineStyle.Dashed, title: "T3 · 3R" },
          ];
          for (const ln of lines) {
            stUp.createPriceLine({ price: ln.price, color: ln.color, lineWidth: 1, lineStyle: ln.style, axisLabelVisible: true, title: ln.title });
          }
        }
      }
    }

    // 交易计划色块（对标 TV「Cardwell RSI Trade Navigator」）：策略给出 tradePlan 时，以入场根为锚
    // 向右画风险带(红)/盈利带(绿) + 各价位右轴标签（× SL / ► Entry / ● TP1 / ★ TP2 / ▲ TP3）。
    const plan = tvLayers?.tradePlan;
    if (plan && plan.anchorIndex >= 0 && plan.anchorIndex < candles.length) {
      const zones = buildTradeZones(plan, toTime(candles[plan.anchorIndex].date));
      candleSeries.attachPrimitive(new TradeZonesPrimitive(zones));
    }

    // 副图振荡指标：各占独立窗格（分开显示，量纲互不干扰）
    let paneIdx = 1;
    const lineP = (vals: number[], color: string, pane: number) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane);
      paintersRef.current.push((vc) => s.setData(vc.map((c, i) => (Number.isFinite(vals[i]) ? { time: toTime(c.date), value: vals[i] } : null)).filter((p): p is { time: Time; value: number } => p !== null)));
      return s;
    };
    const guide = (s: ISeriesApi<"Line">, level: number) =>
      s.createPriceLine({ price: level, color: borderColor, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: String(level) });

    if (indMacd) {
      const p = paneIdx++;
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
      paintersRef.current.push((vc) => hist.setData(vc.map((c, i) => (Number.isFinite(macd.macd[i]) ? { time: toTime(c.date), value: macd.macd[i], color: (macd.macd[i] >= 0 ? UP : DOWN) + "99" } : null)).filter((q): q is { time: Time; value: number; color: string } => q !== null)));
      lineP(macd.dif, "#eab308", p);
      lineP(macd.dea, "#38bdf8", p);
    }
    if (indRsi) {
      const p = paneIdx++;
      const s = lineP(rsi, "#eab308", p);
      guide(s, 70);
      guide(s, 30);
    }
    if (indKdj) {
      const p = paneIdx++;
      const s = lineP(kdj.k, "#eab308", p);
      lineP(kdj.d, "#38bdf8", p);
      lineP(kdj.j, "#ec4899", p);
      guide(s, 80);
      guide(s, 20);
    }
    const panes = chart.panes();
    if (panes[0]) panes[0].setStretchFactor(4);
    for (let pi = 1; pi < panes.length; pi++) panes[pi]?.setStretchFactor(1.4);

    // AI 画图叠加层（仅日线口径；横线/区间走价格线，趋势线走两点序列，标注走 marker）
    if (!intraday && drawings.length > 0) {
      for (const dr of drawings) {
        if (dr.type === "hline") {
          candleSeries.createPriceLine({ price: dr.price, color: drawColor(dr.color), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: dr.label });
        } else if (dr.type === "zone") {
          const col = drawColor(dr.color);
          candleSeries.createPriceLine({ price: dr.priceHigh, color: col, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `${dr.label} 上` });
          candleSeries.createPriceLine({ price: dr.priceLow, color: col, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `${dr.label} 下` });
        } else if (dr.type === "trendline") {
          const s = chart.addSeries(LineSeries, { color: drawColor(dr.color), lineWidth: 2, lineStyle: LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData([
            { time: toTime(dr.from.date), value: dr.from.price },
            { time: toTime(dr.to.date), value: dr.to.price },
          ]);
        }
      }
    }

    paint(viewCandles);
    chart.timeScale().fitContent();

    const onMove = chart.subscribeCrosshairMove((param) => {
      if (!param.time) return;
      const cd = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      if (!cd) return;
      const matchIdx = candles.findIndex((c) => toTime(c.date) === param.time);
      const match = matchIdx >= 0 ? candles[matchIdx] : undefined;
      const dateStr = match?.date ?? String(param.time);
      const r = resoByDate.get(dateStr);
      setLegend({ date: dateStr, o: cd.open, h: cd.high, l: cd.low, c: cd.close, v: match?.volume || 0, chg: match?.changePct ?? 0, reso: r ? `${r.dir === "bull" ? "看多共振" : "看空共振"}：${r.reasons.join("+")}` : undefined, st: tvReadout(matchIdx) });
    });
    void onMove;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersApiRef.current = null;
      paintersRef.current = [];
    };
    // 故意不依赖 viewCandles：回放游标变化由下方数据层处理，避免重建图表导致闪烁。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, macd, rsi, kdj, boll, resoByDate, maOn, showBoll, indMacd, indRsi, indKdj, yScaleMode, intraday, drawings, toTime, paint, tvLayers]);

  // 数据层：回放游标（viewCandles）变化时仅重绘数据，并把最新显露的 K 线滚入视野。
  useEffect(() => {
    if (!chartRef.current || paintersRef.current.length === 0) return;
    paint(viewCandles);
    if (replayN !== null) chartRef.current.timeScale().scrollToRealTime();
  }, [viewCandles, replayN, paint]);

  // 自动播放：按速度逐根推进，到末根自动停。
  useEffect(() => {
    if (!playing || replayN === null) return;
    if (replayN >= candles.length) { setPlaying(false); return; }
    const id = setInterval(() => {
      setReplayN((n) => (n === null ? n : Math.min(candles.length, n + 1)));
    }, speedMs);
    return () => clearInterval(id);
  }, [playing, speedMs, replayN, candles.length]);

  const fmt = (v: number) => v.toFixed(2);
  const chgColor = legend && legend.chg >= 0 ? UP : DOWN;
  const replayOn = replayN !== null;

  const enterReplay = () => { setReplayN(startN); setPlaying(false); };
  const exitReplay = () => { setReplayN(null); setPlaying(false); };
  const stepBack = () => setReplayN((n) => Math.max(2, (n ?? startN) - 1));
  const stepFwd = () => setReplayN((n) => Math.min(candles.length, (n ?? startN) + 1));
  const reset = () => { setReplayN(startN); setPlaying(false); };

  return (
    <div className="space-y-2">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 text-[9.5px] font-mono text-[var(--muted)] select-none">
        <div className="flex items-center gap-2.5">
          {MA_DEFS.map((d) => (
            <label key={d.key} className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
              <input type="checkbox" checked={!!maOn[d.key]} onChange={(e) => setMaOn((m) => ({ ...m, [d.key]: e.target.checked }))} className="rounded-[1px] accent-[var(--accent)]" />
              MA{d.period}
            </label>
          ))}
          <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
            <input type="checkbox" checked={showBoll} onChange={(e) => setShowBoll(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
            BOLL
          </label>
        </div>

        <div className="flex items-center gap-1" title="周期：分时 5/15/30/60m（日内，按需拉取） · 日/周/月 K">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)]">周期</span>
          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
            {INTRADAY_TFS.map((m) => (
              <button key={m} onClick={() => setPeriod(m)} className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] ${period === m ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"}`}>
                {m}
              </button>
            ))}
            <span className="w-px bg-[var(--border)] mx-0.5" />
            {DAILY_TFS.map((m) => (
              <button key={m} onClick={() => setPeriod(m)} className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] ${period === m ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"}`}>
                {m}
              </button>
            ))}
          </div>
          {tfLoading && <span className="text-[9px] text-[var(--accent)] ml-0.5">分时加载中…</span>}
          {tfErr && <span className="text-[9px] text-emerald-400 ml-0.5">{tfErr}</span>}
        </div>

        <div className="flex items-center gap-1" title="纵轴标度：线性 / 对数 / 百分比（lightweight-charts 原生）">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)]">纵轴</span>
          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
            {([["linear", "线性"], ["log", "对数"], ["pct", "%"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setYScaleMode(m)} className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] ${yScaleMode === m ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1" title="副图指标：MACD / RSI / KDJ 各占独立窗格（分开显示，可单独开关）">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)]">副图</span>
          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
            {([["MACD", indMacd, setIndMacd], ["RSI", indRsi, setIndRsi], ["KDJ", indKdj, setIndKdj]] as const).map(([label, on, set]) => (
              <button key={label} onClick={() => set((v) => !v)} className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] ${on ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1" title="共振：MACD/RSI/KDJ/BOLL ≥2 个同向信号时在主图打标（▲看多 / ▼看空），连续共振连成区域，悬停看命中指标">
          <button onClick={() => setShowResonance((v) => !v)} className={`flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] border border-[var(--border)] ${showResonance ? "bg-[var(--hover)] text-[var(--text)]" : "bg-[var(--inset)] text-[var(--faint)] hover:text-[var(--text)]"}`}>
            <span style={{ color: RESONANCE }}>●</span> 共振{resonance.length > 0 ? `(${resonance.length})` : ""}
          </button>
        </div>

        <div className="flex items-center gap-1" title="策略图层：把复刻的 TradingView 社区策略叠加到主图（方向线 + 翻多/翻空标记 + regime 读数），可套用到任意个股行情">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)]">策略图层</span>
          <select
            value={tvStrategyId}
            onChange={(e) => setTvStrategyId(e.target.value)}
            className="bg-[var(--inset)] border border-[var(--border)] text-[9.5px] font-semibold px-1.5 py-0.5 rounded-[1px] text-[var(--text)] cursor-pointer max-w-[200px]"
          >
            <option value="">关闭</option>
            {tvMetas.map((m) => (
              <option key={m.id} value={m.id}>{m.name} v{m.version}</option>
            ))}
          </select>
        </div>

        {/* 逐根回放（对标 TradingView Bar Replay） */}
        <div className="flex items-center gap-1" title="逐根回放：隐藏未来 K 线，单步或自动逐根显露，练习/复盘临场决策">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)]">回放</span>
          {!replayOn ? (
            <button onClick={enterReplay} className="px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] bg-[var(--inset)] border border-[var(--border)] text-[var(--faint)] hover:text-[var(--text)]">
              ▷ 开始回放
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
                <button onClick={reset} title="回到起点" className="px-1.5 py-0.5 text-[9.5px] cursor-pointer rounded-[1px] text-[var(--faint)] hover:text-[var(--text)]">⏮</button>
                <button onClick={stepBack} title="后退一根" className="px-1.5 py-0.5 text-[9.5px] cursor-pointer rounded-[1px] text-[var(--faint)] hover:text-[var(--text)]">◀</button>
                <button onClick={() => setPlaying((p) => !p)} title={playing ? "暂停" : "播放"} className="px-1.5 py-0.5 text-[9.5px] cursor-pointer rounded-[1px] text-[var(--text)]">{playing ? "⏸" : "▶"}</button>
                <button onClick={stepFwd} title="前进一根" className="px-1.5 py-0.5 text-[9.5px] cursor-pointer rounded-[1px] text-[var(--faint)] hover:text-[var(--text)]">▶|</button>
              </div>
              <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
                {REPLAY_SPEEDS.map((s) => (
                  <button key={s.ms} onClick={() => setSpeedMs(s.ms)} className={`px-1.5 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] ${speedMs === s.ms ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <span className="text-[9px] text-[var(--faint)] tabular-nums">{viewCandles.length}/{candles.length}</span>
              <button onClick={exitReplay} className="px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] text-[var(--faint)] hover:text-[var(--text)]">退出</button>
            </div>
          )}
        </div>
      </div>

      {/* 图表容器 + OHLCV 读数条（高度随副图窗格数自适应） */}
      <div className="relative w-full" style={{ height: 360 + ((indMacd ? 1 : 0) + (indRsi ? 1 : 0) + (indKdj ? 1 : 0)) * 90 }}>
        {legend && (
          <div className="absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono pointer-events-none bg-[var(--surface)]/70 px-1.5 py-0.5 rounded-[1px]">
            <span className="text-[var(--faint)]">{legend.date}</span>
            <span>开 <span style={{ color: chgColor }}>{fmt(legend.o)}</span></span>
            <span>高 <span style={{ color: chgColor }}>{fmt(legend.h)}</span></span>
            <span>低 <span style={{ color: chgColor }}>{fmt(legend.l)}</span></span>
            <span>收 <span style={{ color: chgColor }}>{fmt(legend.c)}</span></span>
            <span style={{ color: chgColor }}>{legend.chg >= 0 ? "+" : ""}{legend.chg.toFixed(2)}%</span>
            <span className="text-[var(--faint)]">量 {(legend.v / 100).toFixed(0)} 手</span>
            {replayOn && <span className="text-[var(--accent)]">● 回放中</span>}
            {legend.reso && <span style={{ color: RESONANCE }}>● {legend.reso}</span>}
            {legend.st && <span className="text-[var(--accent)]">▣ 策略 {legend.st}</span>}
          </div>
        )}
        {gbbStats && (
          <div className="absolute right-2 top-1 z-10 pointer-events-none font-mono text-[9.5px] bg-[var(--surface)]/85 border border-[var(--border)] rounded-[2px] overflow-hidden min-w-[150px]">
            <div className="px-2 py-0.5 bg-[var(--inset)] text-[var(--faint)] tracking-wide border-b border-[var(--border)]">GBB · {code ?? ""}</div>
            {[
              ["Trend", gbbStats.trend, gbbStats.trendUp ? UP : DOWN],
              ["ATR", Number.isFinite(gbbStats.atr) ? gbbStats.atr.toFixed(2) : "--", "var(--text)"],
              ["ADX", Number.isFinite(gbbStats.adx) ? `${gbbStats.adx.toFixed(0)}%` : "--", gbbStats.adx >= 25 ? UP : "var(--muted)"],
              ["Strength", Number.isFinite(gbbStats.strength) ? `${gbbStats.strength.toFixed(0)}%` : "--", "#f59e0b"],
              ["HTF Bias", gbbStats.htf, gbbStats.htf === "多" ? UP : gbbStats.htf === "空" ? DOWN : "var(--muted)"],
              ["Since Signal", gbbStats.sinceSignal == null ? "--" : `${gbbStats.sinceSignal} 根`, "var(--muted)"],
            ].map(([k, v, color]) => (
              <div key={k as string} className="flex justify-between gap-4 px-2 py-0.5">
                <span className="text-[var(--faint)]">{k}</span>
                <span style={{ color: color as string }} className="font-semibold tabular-nums">{v}</span>
              </div>
            ))}
          </div>
        )}
        {navStats && (
          <div className="absolute right-2 top-1 z-10 pointer-events-none font-mono text-[9.5px] bg-[var(--surface)]/85 border border-[var(--border)] rounded-[2px] overflow-hidden min-w-[150px]">
            <div className="px-2 py-0.5 bg-[var(--inset)] text-[var(--faint)] tracking-wide border-b border-[var(--border)]">Navigator · {code ?? ""}</div>
            {([
              ["Bias", navStats.bias, navStats.dir === 1 ? UP : DOWN],
              ["RSI", Number.isFinite(navStats.rsiVal) ? navStats.rsiVal.toFixed(1) : "--", navStats.rsiVal >= 50 ? UP : DOWN],
              ["► Entry", navStats.entry.toFixed(2), "#60a5fa"],
              ["× SL", navStats.stop.toFixed(2), UP],
              ...navStats.targets.map((t): [string, string, string] => [`${ZONE_TP_SYM[Math.min(t.r - 1, ZONE_TP_SYM.length - 1)]} ${t.label}·${t.r}R`, t.price.toFixed(2), DOWN]),
              ["Since Signal", navStats.sinceSignal == null ? "--" : `${navStats.sinceSignal} 根`, "var(--muted)"],
            ] as [string, string, string][]).map(([k, v, color]) => (
              <div key={k} className="flex justify-between gap-4 px-2 py-0.5">
                <span className="text-[var(--faint)]">{k}</span>
                <span style={{ color }} className="font-semibold tabular-nums">{v}</span>
              </div>
            ))}
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
