"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { tradeSizeTag, type TradeAction, type TechnicalAssessment } from "@/lib/quant";
import { candlesByPeriod } from "@/lib/candleAgg";
import { computeMACD, computeRSI, computeKDJ, computeBOLL, computeResonance, computePatternSignals, type ResonancePoint, type PatternSignal } from "@/lib/indicators";
import type { ChartDrawing, MarkerDrawing, DrawingColor } from "@/lib/drawings";
import { listTvStrategies, getTvStrategy, type TvStrategyLayers, type TradePlan } from "@/lib/tvStrategies";
import { TradeZonesPrimitive, type TradeZonesData, type TradeZoneBand, type TradeZoneLevel } from "./tradeZonesPrimitive";
import { TradeReasonsPrimitive, type TradeReasonLabel } from "./tradeReasonsPrimitive";
import { RegressionChannelPrimitive, type RegressionChannelData, type RegressionChannelPoint } from "./regressionChannelPrimitive";

interface LightweightChartProps {
  candles: Candle[];
  trades: TradeAction[];
  code?: string;
  fq?: "qfq" | "hfq";
  drawings?: ChartDrawing[];
  /** 回归通道数据（来自诊断管线 technical.trendChannel，与 /scanner 展开评估同口径）。 */
  trendChannel?: TechnicalAssessment["trendChannel"] | null;
  /** 初始策略图层 id（如从 ?layer= 进入时自动叠加 TV 复刻策略，""=关闭）。 */
  initialTvStrategyId?: string;
  /** 引擎控件插槽：父级「图表引擎 / 买卖引擎」控件渲染进工具栏首行，与策略图层/回放同处一行，省出一行高度。 */
  engineSlot?: ReactNode;
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

// 从交易理由首部的「【…】」中提取简短策略标签（去掉版本号如 -v7），用于 BS 标记角标 / 浮层标题。
function reasonTag(reason: string): string | null {
  const m = reason.match(/^\s*【([^】]+)】/);
  if (!m) return null;
  return m[1].replace(/[-_ ]?v\d+$/i, "").trim() || null;
}

type Timeframe = "5m" | "15m" | "30m" | "60m" | "1D" | "1W" | "1M";
const INTRADAY_TFS: Timeframe[] = ["5m", "15m", "30m", "60m"];
const DAILY_TFS: Timeframe[] = ["1D", "1W", "1M"];

const UP = "#ef4444"; // 阳（涨）红
const DOWN = "#10b981"; // 阴（跌）绿
// 共振标注色：按方向分「好 / 坏 / 中性」上色（遵循 A 股市场惯例「红涨绿跌」：看多红、看空绿、分歧灰），
// 颜色 + ▲▼◆ 形状即可表意，故标记文案去掉「共振」二字。
const RESO_BULL = "#ef4444"; // 看多共振（利好 / 做多）— 红（A股涨色）
const RESO_BEAR = "#10b981"; // 看空共振（利空 / 做空）— 绿（A股跌色）
const RESO_NEUTRAL = "#94a3b8"; // 多空分歧（中性 / 信号打架）
const resoColor = (d: ResonancePoint["dir"]) => (d === "bull" ? RESO_BULL : d === "bear" ? RESO_BEAR : RESO_NEUTRAL);
const resoGlyph = (d: ResonancePoint["dir"]) => (d === "bull" ? "▲" : d === "bear" ? "▼" : "◆");
// 读数条上的共振说明（标题 + 命中指标）：中性时含「看多 …」「看空 …」两组。
function resoLegend(r: ResonancePoint): { text: string; color: string } {
  const head = r.dir === "bull" ? "看多共振" : r.dir === "bear" ? "看空共振" : "多空分歧";
  return { text: `${head}：${r.reasons.join(r.dir === "neutral" ? " · " : "+")}`, color: resoColor(r.dir) };
}

// 通用形态标记配色（顶/底背离按方向遵循 A 股红涨绿跌；量能极值为中性，用橙/蓝区分）：
const PAT_TOP = RESO_BEAR; // 顶背离（看空）— 绿
const PAT_BOTTOM = RESO_BULL; // 底背离（看多）— 红
const PAT_CLIMAX = "#f59e0b"; // 天量（放量高潮）— 橙
const PAT_DRY = "#38bdf8"; // 地量（极度缩量）— 蓝
const patColor = (k: PatternSignal["kind"]) =>
  k === "topDivergence" ? PAT_TOP : k === "bottomDivergence" ? PAT_BOTTOM : k === "volumeClimax" ? PAT_CLIMAX : PAT_DRY;

// 默认可视范围 ≈ 近 6 个月（按周期换算的 K 线根数）；右侧再留若干根空白便于看清最新走势与标签。
const RIGHT_MARGIN_BARS = 8;
function defaultVisibleBars(tf: Timeframe): number {
  if (tf === "1W") return 28; // ≈半年周线
  if (tf === "1M") return 8; // ≈半年月线
  if (tf.endsWith("m")) return 96; // 分时：显示最近若干根
  return 126; // 日线 ≈ 6 个月交易日
}

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

export default function LightweightChart({ candles: rawCandles, trades, code, fq = "qfq", drawings = [], trendChannel, initialTvStrategyId = "", engineSlot }: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // 每个序列携带自己的「按可见 K 线重绘」闭包，回放时仅重绘数据、不重建图表。
  const paintersRef = useRef<((vc: Candle[]) => void)[]>([]);
  // 均线序列引用（按 key），勾选 MA 时仅切换其可见性、不重建图表，避免重置缩放/平移/时间位置。
  const maSeriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});
  // 记忆当前可视逻辑范围：切换指标/形态等触发重建时还原它，避免布局被重置（切换标的/周期才清空）。
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null);
  // 数据标识：candles 引用变化（切换标的/周期/回测）时视为新数据，清空记忆范围并回到默认近 6 个月视图。
  const dataKeyRef = useRef<Candle[] | null>(null);

  const [period, setPeriod] = useState<Timeframe>("1D");
  const [yScaleMode, setYScaleMode] = useState<"linear" | "log" | "pct">("linear");
  // 副图振荡指标默认全开，各占独立窗格（分开显示，量纲不互扰）
  const [indMacd, setIndMacd] = useState(true);
  const [indRsi, setIndRsi] = useState(true);
  const [indKdj, setIndKdj] = useState(true);
  const [showBoll, setShowBoll] = useState(true);
  // 回归通道（与 /scanner 展开评估同口径）默认开启，可单独关闭。
  const [showChannel, setShowChannel] = useState(true);
  const [showResonance, setShowResonance] = useState(true);
  // 通用形态标记（顶背离/底背离/天量/地量）默认开启，可单独关闭。
  const [showPatterns, setShowPatterns] = useState(true);
  // BS 点旁是否常驻显示触发理由标签（默认开启；点位密集时可关闭以减少遮挡）。
  const [showTradeReasons, setShowTradeReasons] = useState(true);
  // 策略图层：选中的 TradingView 复刻策略 id（""=关闭）
  const [tvStrategyId, setTvStrategyId] = useState(initialTvStrategyId);
  // 从 ?layer= 进入或外部切换标的时，跟随更新选中的策略图层（让「从回测页点进自动叠加」生效）。
  useEffect(() => {
    setTvStrategyId(initialTvStrategyId);
  }, [initialTvStrategyId]);
  const [maOn, setMaOn] = useState<Record<string, boolean>>({ ma5: true, ma10: true, ma20: true, ma60: true, ma120: true, ma250: true });
  const [legend, setLegend] = useState<{ date: string; o: number; h: number; l: number; c: number; v: number; chg: number; reso?: string; resoColor?: string; st?: string; pat?: string; patColor?: string } | null>(null);

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
  // 回归通道绘制数据：以 technical.trendChannel（最近 60 日收盘价线性回归 + 标准差上下轨）为源，
  // 沿最近 N 根 K 线还原三轨斜线，口径与经典 SVG（QuantChart）/scanner 评估完全一致：
  // 周/月线 channelLen=12、日内不展示；slope 按 1W×5 / 1M×20 折算到对应周期每根的位移。
  const channelData = useMemo<RegressionChannelData | null>(() => {
    if (!trendChannel || intraday) return null;
    const len = candles.length;
    if (len < 2) return null;
    const { slope, upperLine, lowerLine, midLine, type } = trendChannel;
    const weekly = period === "1W";
    const monthly = period === "1M";
    const channelLen = Math.min(len, weekly || monthly ? 12 : 60);
    const startIndex = len - channelLen;
    const upperDiff = upperLine - midLine;
    const lowerDiff = midLine - lowerLine;
    const factor = weekly ? 5 : monthly ? 20 : 1;
    const points: RegressionChannelPoint[] = [];
    for (let i = startIndex; i < len; i++) {
      const offset = len - 1 - i;
      const midVal = midLine - slope * offset * factor;
      points.push({ time: toTime(candles[i].date), upper: midVal + upperDiff, mid: midVal, lower: midVal - lowerDiff });
    }
    if (points.length < 2) return null;
    const up = type === "up"; // 上行通道红、其余（down/range）绿，与经典 SVG 同色口径
    return {
      points,
      areaFill: up ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
      upperStroke: up ? "rgba(239,68,68,0.22)" : "rgba(16,185,129,0.18)",
      lowerStroke: up ? "rgba(239,68,68,0.18)" : "rgba(16,185,129,0.22)",
    };
  }, [trendChannel, intraday, period, candles, toTime]);
  const resonance = useMemo(() => computeResonance(candles, macd, rsi, kdj, boll), [candles, macd, rsi, kdj, boll]);
  const resoByDate = useMemo(() => {
    const m = new Map<string, (typeof resonance)[number]>();
    for (const r of resonance) { const c = candles[r.index]; if (c) m.set(c.date, r); }
    return m;
  }, [resonance, candles]);
  // 通用形态信号：顶背离 / 底背离 / 天量 / 地量（带判断说明），用于主图打标 + 读数条说明。
  const patterns = useMemo(() => computePatternSignals(candles, rsi), [candles, rsi]);
  const patternByDate = useMemo(() => {
    const m = new Map<string, PatternSignal>();
    for (const p of patterns) { const c = candles[p.index]; if (c) m.set(c.date, p); }
    return m;
  }, [patterns, candles]);
  // 交易按日期索引：用于鼠标悬停 BS 标记时弹出该笔买卖的完整理由 / 分批比例 / 盈亏。
  const tradeByDate = useMemo(() => {
    const m = new Map<string, TradeAction>();
    for (const t of trades) m.set(t.date, t);
    return m;
  }, [trades]);
  // BS 理由标注层数据：买点锚当根最低价（标签落 K 线下方）、卖点锚最高价（落上方），
  // 文案 = 策略简称（理由【…】）+ 卖点本笔盈亏；坐标在 primitive 内随平移/缩放实时换算。
  const tradeReasonLabels = useMemo<TradeReasonLabel[]>(() => {
    const byDate = new Map<string, Candle>();
    for (const c of candles) byDate.set(c.date, c);
    const labels: TradeReasonLabel[] = [];
    for (const t of trades) {
      const tag = reasonTag(t.reason);
      if (!tag) continue;
      const c = byDate.get(t.date);
      const isBuy = t.type === "buy";
      const anchorPrice = c ? (isBuy ? c.low : c.high) : t.price;
      const pct = !isBuy && t.profitPct != null ? `${t.profitPct >= 0 ? "+" : ""}${t.profitPct.toFixed(1)}%` : undefined;
      labels.push({ time: toTime(t.date), anchorPrice, isBuy, tag, pct });
    }
    return labels;
  }, [trades, candles, toTime]);
  // 悬停在 BS 信号上的浮层（x/y 为图表容器内像素坐标）。
  const [signalTip, setSignalTip] = useState<{ x: number; y: number; cw: number; trade: TradeAction } | null>(null);

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
      .map((t) => {
        // 标记文案：B/S + 分批仓位（建仓/减仓/清仓 X%）。触发理由（策略简称）+ 卖点盈亏由
        // TradeReasonsPrimitive 常驻标注层呈现（可经「BS理由」开关切换），此处不再重复以免拥挤。
        const parts = [t.type === "buy" ? "B" : "S"];
        const sizeTag = tradeSizeTag(t.type, t.sizePct);
        if (sizeTag) parts.push(sizeTag);
        return {
          time: toTime(t.date),
          position: t.type === "buy" ? "belowBar" : "aboveBar",
          color: t.type === "buy" ? UP : DOWN,
          shape: t.type === "buy" ? "arrowUp" : "arrowDown",
          text: parts.join(" "),
        };
      });
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
              color: resoColor(r.dir),
              shape: "circle" as const,
              text: `${resoGlyph(r.dir)}×${r.score}`,
            };
          })
      : [];
    // 通用形态标记：顶背离(绿▼) / 底背离(红▲) 落价格高低点外侧；天量(橙) / 地量(蓝) 落 K 线下方。
    const patternMarkers: SeriesMarker<Time>[] = showPatterns
      ? patterns
          .filter((p) => p.index <= vc.length - 1)
          .map((p) => {
            const c = candles[p.index];
            const isVol = p.kind === "volumeClimax" || p.kind === "volumeDry";
            return {
              time: toTime(c.date),
              position: (p.dir === "bear" ? "aboveBar" : "belowBar") as "aboveBar" | "belowBar",
              color: patColor(p.kind),
              shape: (isVol ? "circle" : "square") as "circle" | "square",
              text: p.label,
            };
          })
      : [];
    const all = [...markers, ...drawMarkers, ...resoMarkers, ...patternMarkers, ...stFlipMarkers].sort((a, b) =>
      typeof a.time === "number" && typeof b.time === "number" ? a.time - b.time : String(a.time).localeCompare(String(b.time))
    );
    markersApiRef.current?.setMarkers(all);
    const last = vc[vc.length - 1];
    if (last) {
      const r = resoByDate.get(last.date);
      const rl = r ? resoLegend(r) : undefined;
      const pat = patternByDate.get(last.date);
      setLegend({ date: last.date, o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume || 0, chg: last.changePct ?? 0, reso: rl?.text, resoColor: rl?.color, st: tvReadout(vc.length - 1), pat: pat ? `${pat.label}：${pat.detail}` : undefined, patColor: pat ? patColor(pat.kind) : undefined });
    }
  }, [trades, toTime, drawings, intraday, showResonance, resonance, showPatterns, patterns, candles, resoByDate, patternByDate, tvLayers, tvReadout]);

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
      timeScale: { borderColor, timeVisible: intraday, secondsVisible: false, rightOffset: RIGHT_MARGIN_BARS },
    });
    chartRef.current = chart;
    paintersRef.current = [];
    maSeriesRef.current = {};

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

    // 均线：始终创建全部 MA 序列并存引用，仅按 maOn 切换 visible。
    // 这样勾选/取消 MA 只切换该线可见性（见下方独立 effect），不触发图表重建，避免布局（缩放/平移/时间位置）被重置。
    for (const def of MA_DEFS) {
      const s = chart.addSeries(LineSeries, { color: def.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: maOn[def.key] });
      maSeriesRef.current[def.key] = s;
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

    // 回归通道（与 /scanner 展开评估、经典 SVG 同口径）：以自定义 primitive 在主图底层
    // 绘制半透明轨间填充 + 上/下/中三轨斜线，挂在 K 线序列上随平移/缩放自动重绘。
    if (showChannel && channelData) {
      candleSeries.attachPrimitive(new RegressionChannelPrimitive(channelData));
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

    // BS 触发理由常驻标注层：在每个买卖点旁画策略简称 + 卖点盈亏，横向避让，随平移/缩放重排。
    candleSeries.attachPrimitive(new TradeReasonsPrimitive({ labels: tradeReasonLabels, enabled: showTradeReasons }));

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
    // 主图相对更高更大；副图（量价/MACD/RSI/KDJ）高度较此前缩小约 25%（1.4→1.05）。
    if (panes[0]) panes[0].setStretchFactor(4);
    for (let pi = 1; pi < panes.length; pi++) panes[pi]?.setStretchFactor(1.05);

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

    // 可视范围：新数据 → 默认近 6 个月 + 右侧留白；非新数据（仅切指标/形态/MA 等触发重建）→ 还原上次范围，布局不被重置。
    const ts = chart.timeScale();
    const isNewData = dataKeyRef.current !== candles;
    dataKeyRef.current = candles;
    if (!isNewData && savedRangeRef.current) {
      ts.setVisibleLogicalRange(savedRangeRef.current);
    } else {
      savedRangeRef.current = null;
      const total = viewCandles.length;
      const bars = defaultVisibleBars(period);
      if (total > bars) {
        ts.setVisibleLogicalRange({ from: total - bars, to: total - 1 + RIGHT_MARGIN_BARS });
      } else {
        ts.fitContent();
      }
    }
    // 记忆用户后续的缩放/平移，供下次重建时还原。
    const onRange = ts.subscribeVisibleLogicalRangeChange((r) => { if (r) savedRangeRef.current = { from: r.from, to: r.to }; });
    void onRange;

    const onMove = chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setSignalTip(null); return; }
      const cd = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      if (!cd) { setSignalTip(null); return; }
      const matchIdx = candles.findIndex((c) => toTime(c.date) === param.time);
      const match = matchIdx >= 0 ? candles[matchIdx] : undefined;
      const dateStr = match?.date ?? String(param.time);
      const r = resoByDate.get(dateStr);
      const rl = r ? resoLegend(r) : undefined;
      const pat = patternByDate.get(dateStr);
      setLegend({ date: dateStr, o: cd.open, h: cd.high, l: cd.low, c: cd.close, v: match?.volume || 0, chg: match?.changePct ?? 0, reso: rl?.text, resoColor: rl?.color, st: tvReadout(matchIdx), pat: pat ? `${pat.label}：${pat.detail}` : undefined, patColor: pat ? patColor(pat.kind) : undefined });
      // 悬停到含 BS 信号的交易日时，弹出该笔买卖的完整理由浮层。
      const trade = tradeByDate.get(dateStr);
      if (trade && param.point) setSignalTip({ x: param.point.x, y: param.point.y, cw: containerRef.current?.clientWidth ?? 0, trade });
      else setSignalTip(null);
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
    // 故意不依赖 maOn：MA 勾选只切换序列可见性（见下方独立 effect），不重建图表，避免布局被重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, macd, rsi, kdj, boll, resoByDate, showBoll, showChannel, channelData, indMacd, indRsi, indKdj, yScaleMode, intraday, drawings, toTime, paint, tvLayers, tradeReasonLabels, showTradeReasons]);

  // MA 勾选切换：仅改对应序列可见性，不触发图表重建（避免缩放/平移/时间位置被重置）。
  useEffect(() => {
    for (const def of MA_DEFS) maSeriesRef.current[def.key]?.applyOptions({ visible: maOn[def.key] });
  }, [maOn]);

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
    <div className="flex flex-col h-full min-h-0 gap-2">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[9.5px] font-mono text-[var(--muted)] select-none shrink-0">
        {engineSlot && (
          <div className="flex items-center gap-1">
            {engineSlot}
            <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" />
          </div>
        )}
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
          <label
            className={`flex items-center gap-1 ${trendChannel && !intraday ? "cursor-pointer hover:text-[var(--text)]" : "opacity-40 cursor-not-allowed"}`}
            title={trendChannel ? (intraday ? "回归通道仅在日/周/月 K 显示（基于日线回归）" : "回归通道：与 /scanner 展开评估同口径（最近 60 日线性回归 + 标准差上下轨）") : "暂无回归通道数据（诊断管线未返回 trendChannel）"}
          >
            <input type="checkbox" checked={showChannel} disabled={!trendChannel || intraday} onChange={(e) => setShowChannel(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
            回归通道
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

        <div className="flex items-center gap-1" title="共振：MACD/RSI/KDJ/BOLL ≥2 个同向信号时在主图打标——▲看多(红) / ▼看空(绿) / ◆多空分歧(灰)，遵循A股红涨绿跌惯例，颜色即表意；悬停看命中指标">
          <button onClick={() => setShowResonance((v) => !v)} className={`flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] border border-[var(--border)] ${showResonance ? "bg-[var(--hover)] text-[var(--text)]" : "bg-[var(--inset)] text-[var(--faint)] hover:text-[var(--text)]"}`}>
            <span className="inline-flex items-center" style={{ letterSpacing: "-1px" }}><span style={{ color: RESO_BULL }}>▲</span><span style={{ color: RESO_NEUTRAL }}>◆</span><span style={{ color: RESO_BEAR }}>▼</span></span> 共振{resonance.length > 0 ? `(${resonance.length})` : ""}
          </button>
        </div>

        <div className="flex items-center gap-1" title="通用形态：自动标注顶背离(绿▼,价新高量价/动能不配合,警惕回落) / 底背离(红▲,价新低动能转强,反弹将至) / 天量(橙●,异常放量,见顶或主力换手) / 地量(蓝●,极度缩量,抛压衰竭关注变盘)；悬停标记看判断说明。">
          <button onClick={() => setShowPatterns((v) => !v)} className={`flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] border border-[var(--border)] ${showPatterns ? "bg-[var(--hover)] text-[var(--text)]" : "bg-[var(--inset)] text-[var(--faint)] hover:text-[var(--text)]"}`}>
            <span className="inline-flex items-center" style={{ letterSpacing: "-1px" }}><span style={{ color: PAT_BOTTOM }}>▲</span><span style={{ color: PAT_CLIMAX }}>●</span><span style={{ color: PAT_TOP }}>▼</span></span> 形态{patterns.length > 0 ? `(${patterns.length})` : ""}
          </button>
        </div>

        <div className="flex items-center gap-1" title="BS理由：在每个买卖点旁常驻显示触发理由（策略简称）与卖点本笔盈亏；点位密集时可关闭以减少遮挡，悬停标记仍可见完整理由。">
          <button onClick={() => setShowTradeReasons((v) => !v)} className={`flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer rounded-[1px] border border-[var(--border)] ${showTradeReasons ? "bg-[var(--hover)] text-[var(--text)]" : "bg-[var(--inset)] text-[var(--faint)] hover:text-[var(--text)]"}`}>
            <span style={{ color: DOWN }}>B</span>/<span style={{ color: UP }}>S</span>理由
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

      {/* 图表容器 + OHLCV 读数条：填满可用高度（全屏自适应，底部日期不再被裁切），autoSize 让画布跟随容器 */}
      <div className="relative w-full flex-1 min-h-[320px]">
        {legend && (
          <div className="absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono pointer-events-none bg-[var(--surface)]/90 backdrop-blur-sm px-1.5 py-0.5 rounded-[1px] max-w-[70%]">
            <span className="text-[var(--faint)]">{legend.date}</span>
            <span>开 <span style={{ color: chgColor }}>{fmt(legend.o)}</span></span>
            <span>高 <span style={{ color: chgColor }}>{fmt(legend.h)}</span></span>
            <span>低 <span style={{ color: chgColor }}>{fmt(legend.l)}</span></span>
            <span>收 <span style={{ color: chgColor }}>{fmt(legend.c)}</span></span>
            <span style={{ color: chgColor }}>{legend.chg >= 0 ? "+" : ""}{legend.chg.toFixed(2)}%</span>
            <span className="text-[var(--faint)]">量 {(legend.v / 100).toFixed(0)} 手</span>
            {replayOn && <span className="text-[var(--accent)]">● 回放中</span>}
            {legend.reso && <span style={{ color: legend.resoColor ?? RESO_NEUTRAL }}>● {legend.reso}</span>}
            {legend.pat && <span style={{ color: legend.patColor ?? RESO_NEUTRAL }}>◆ {legend.pat}</span>}
            {legend.st && <span className="text-[var(--accent)]">▣ 策略 {legend.st}</span>}
          </div>
        )}
        {gbbStats && (
          <div className="absolute left-2 top-9 z-20 pointer-events-none font-mono text-[9.5px] bg-[var(--surface)]/95 backdrop-blur-sm border border-[var(--border)] shadow-md rounded-[2px] overflow-hidden min-w-[150px]">
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
          <div className="absolute left-2 top-9 z-20 pointer-events-none font-mono text-[9.5px] bg-[var(--surface)]/95 backdrop-blur-sm border border-[var(--border)] shadow-md rounded-[2px] overflow-hidden min-w-[150px]">
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
        {signalTip && (() => {
          const t = signalTip.trade;
          const isBuy = t.type === "buy";
          const sizeTag = tradeSizeTag(t.type, t.sizePct);
          const flip = signalTip.cw > 0 && signalTip.x > signalTip.cw - 248;
          return (
            <div
              className="absolute z-20 pointer-events-none font-mono text-[10px] bg-[var(--surface)]/95 border border-[var(--border)] rounded-[2px] shadow-lg overflow-hidden w-[230px]"
              style={{ left: flip ? signalTip.x - 242 : signalTip.x + 14, top: Math.max(4, signalTip.y - 12) }}
            >
              <div className={`flex items-center justify-between gap-2 px-2 py-1 border-b border-[var(--border)] ${isBuy ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                <span className="flex items-center gap-1.5">
                  <span className={`px-1 py-0.5 rounded-[1px] font-bold text-[8px] leading-none ${isBuy ? "bs-badge-up bg-red-500/15 text-red-400 border border-red-500/25" : "bs-badge-dn bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"}`}>
                    {isBuy ? "BUY 买入" : "SELL 卖出"}
                  </span>
                  {sizeTag && <span className="text-[8.5px] font-bold text-[var(--accent)]">{sizeTag}</span>}
                </span>
                <span className="text-[var(--faint)] tabular-nums">{t.date}</span>
              </div>
              <div className="px-2 py-1 space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">成交价</span>
                  <span className="font-semibold tabular-nums text-[var(--text)]">{t.price.toFixed(2)} 元</span>
                </div>
                {!isBuy && t.profitPct != null && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">单笔盈亏</span>
                    <span className={`font-bold tabular-nums ${t.profitPct >= 0 ? "bs-up" : "bs-dn"}`}>
                      {t.profitPct >= 0 ? "+" : ""}{t.profitPct.toFixed(2)}%
                    </span>
                  </div>
                )}
                <p className="text-[9.5px] text-[var(--muted)] leading-relaxed pt-0.5 border-t border-[var(--border)]/40">{t.reason}</p>
              </div>
            </div>
          );
        })()}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
