"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { calculateChipDistribution } from "@/lib/quant";
import type { ChipDistributionResult, BacktestResult, TradeAction, TechnicalAssessment } from "@/lib/quant";
import { computeMACD, computeRSI, computeKDJ, computeBOLL } from "@/lib/indicators";
import { PREFERRED_PRO_STRATEGY_ID, readSavedStrategyId, saveStrategyId } from "@/lib/strategyPref";
import { computePerformanceReport } from "@/lib/performance";
import BacktestReport from "./BacktestReport";
import type { Candle } from "@/lib/types";

interface QuantChartProps {
  quantData: {
    chips: ChipDistributionResult;
    backtest: BacktestResult;
    backtests?: {
      traditional: BacktestResult;
      chokepoint: BacktestResult;
    };
    strategies?: {
      meta: { id: string; name: string; version: string; description: string; tags?: string[] };
      result: BacktestResult;
    }[];
    defaultStrategyId?: string;
    technical?: TechnicalAssessment;
    candles?: Candle[];
    projections?: { date: string; bull: number; base: number; bear: number }[];
  };
  currentPrice: number;
  height?: number;
  externalPeriod?: "1D" | "1W" | "1M";
}

/** 本笔交易的仓位比例（0..1）：buy=占满仓资金比例，sell=占当前持仓比例；未设视为整仓。 */
function tradeFraction(t: TradeAction): number {
  return t.sizePct != null ? Math.max(0, Math.min(1, t.sizePct)) : 1;
}
/** 仓位比例 → 标记不透明度（卖 1/2 ≈ 0.5；保留 0.3 下限以免过淡看不见）。 */
function fractionOpacity(frac: number): number {
  return Math.max(0.3, Math.min(1, frac));
}
/** 仓位比例的简短角标（满仓不显示，常见分数用 ½⅓¼，其余用百分比）。 */
function fractionBadge(frac: number): string {
  if (frac >= 0.999) return "";
  const known: [number, string][] = [[0.25, "¼"], [0.33, "⅓"], [0.5, "½"], [0.67, "⅔"], [0.75, "¾"]];
  for (const [v, s] of known) if (Math.abs(frac - v) < 0.03) return s;
  return `${Math.round(frac * 100)}%`;
}
/** 操作仓位中文描述：建/加仓 or 减/清仓 + 百分比。 */
function positionActionLabel(t: TradeAction): string {
  const frac = tradeFraction(t);
  const pct = Math.round(frac * 100);
  if (t.type === "buy") return frac >= 0.999 ? "建仓 · 满仓(100%)" : `加/建仓 · ${pct}%`;
  return frac >= 0.999 ? "清仓 · 全部(100%)" : `减仓 · ${pct}%`;
}

// 辅助：获取自然周的分组键
function getYearWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const numberOfDays = Math.floor((d.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((numberOfDays + oneJan.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

// 聚合周K算法
function aggregateWeeklyCandles(dailyCandles: Candle[]): Candle[] {
  if (!dailyCandles || dailyCandles.length === 0) return [];
  
  const weeksMap = new Map<string, Candle[]>();
  for (const c of dailyCandles) {
    const key = getYearWeek(c.date);
    if (!weeksMap.has(key)) {
      weeksMap.set(key, []);
    }
    weeksMap.get(key)!.push(c);
  }
  
  const weekly: Candle[] = [];
  for (const [_, weekCandles] of weeksMap.entries()) {
    weekCandles.sort((a, b) => a.date.localeCompare(b.date));
    const open = weekCandles[0].open;
    const close = weekCandles[weekCandles.length - 1].close;
    const highs = weekCandles.map(w => w.high);
    const lows = weekCandles.map(w => w.low);
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const volume = weekCandles.reduce((s, w) => s + (w.volume || 0), 0);
    const amount = weekCandles.reduce((s, w) => s + (w.amount || 0), 0);
    weekly.push({
      date: weekCandles[weekCandles.length - 1].date,
      open,
      close,
      high,
      low,
      volume,
      amount,
      changePct: Number(((close - open) / (open || 1) * 100).toFixed(2)),
      turnoverPct: Number(weekCandles.reduce((s, w) => s + (w.turnoverPct || 0), 0).toFixed(2)),
    });
  }
  // 按日期由远及近排序
  return weekly.sort((a, b) => a.date.localeCompare(b.date));
}

// 聚合月K算法
function aggregateMonthlyCandles(dailyCandles: Candle[]): Candle[] {
  if (!dailyCandles || dailyCandles.length === 0) return [];
  
  const monthsMap = new Map<string, Candle[]>();
  for (const c of dailyCandles) {
    const key = c.date.slice(0, 7); // yyyy-mm
    if (!monthsMap.has(key)) {
      monthsMap.set(key, []);
    }
    monthsMap.get(key)!.push(c);
  }
  
  const monthly: Candle[] = [];
  for (const [_, monthCandles] of monthsMap.entries()) {
    monthCandles.sort((a, b) => a.date.localeCompare(b.date));
    const open = monthCandles[0].open;
    const close = monthCandles[monthCandles.length - 1].close;
    const highs = monthCandles.map(w => w.high);
    const lows = monthCandles.map(w => w.low);
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const volume = monthCandles.reduce((s, w) => s + (w.volume || 0), 0);
    const amount = monthCandles.reduce((s, w) => s + (w.amount || 0), 0);
    monthly.push({
      date: monthCandles[monthCandles.length - 1].date,
      open,
      close,
      high,
      low,
      volume,
      amount,
      changePct: Number(((close - open) / (open || 1) * 100).toFixed(2)),
      turnoverPct: Number(monthCandles.reduce((s, w) => s + (w.turnoverPct || 0), 0).toFixed(2)),
    });
  }
  return monthly.sort((a, b) => a.date.localeCompare(b.date));
}

// 自动趋势通道结构体
interface HistChannel {
  startIndex: number;
  endIndex: number;
  slope: number;
  intercept: number;
  stdDev: number;
  type: "up" | "down" | "range";
}

// 自动趋势通道检测算法：寻找整个 K 线周期内所有的上升和下降历史通道
function detectHistoricalChannels(candles: Candle[]): HistChannel[] {
  const N = candles.length;
  const channels: HistChannel[] = [];
  if (N < 15) return [];

  let i = 0;
  while (i < N - 12) {
    let bestJ = i + 12; // 最小通道长度为 12 根 K 线
    let currentBestChannel: HistChannel | null = null;
    
    for (let j = i + 12; j <= Math.min(i + 60, N); j++) {
      const sub = candles.slice(i, j);
      const len = sub.length;
      
      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      for (let k = 0; k < len; k++) {
        sumX += k;
        sumY += sub[k].close;
        sumXX += k * k;
        sumXY += k * sub[k].close;
      }
      const denom = len * sumXX - sumX * sumX;
      if (denom === 0) continue;
      const slope = (len * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / len;
      
      let sqDiffSum = 0;
      for (let k = 0; k < len; k++) {
        const fitY = slope * k + intercept;
        const diff = sub[k].close - fitY;
        sqDiffSum += diff * diff;
      }
      const stdDev = Math.sqrt(sqDiffSum / len) || 0.1;
      
      // 容差判定：允许有少量的极值毛刺，所有点都在 1.95 倍标准差内代表属于稳定通道
      let allInside = true;
      for (let k = 0; k < len; k++) {
        const fitY = slope * k + intercept;
        const price = sub[k].close;
        if (price > fitY + 1.95 * stdDev || price < fitY - 1.95 * stdDev) {
          allInside = false;
          break;
        }
      }
      
      if (allInside) {
        const relativeSlope = slope / (sub[len - 1].close || 1);
        let type: "up" | "down" | "range" = "range";
        if (relativeSlope > 0.0008) type = "up";
        else if (relativeSlope < -0.0008) type = "down";
        
        currentBestChannel = {
          startIndex: i,
          endIndex: j - 1,
          slope,
          intercept,
          stdDev,
          type
        };
        bestJ = j;
      } else {
        break;
      }
    }
    
    if (currentBestChannel) {
      channels.push(currentBestChannel);
      i = bestJ - 2; // 从通道结尾减 2 开始重新计算，保证历史通道首尾相连但不会过度重合
    } else {
      i += 2; // 如果无法形成通道，向右移
    }
  }
  
  return channels;
}

// 均线计算（O(n) 滚动和：维护窗口累加，避免每根都 slice+reduce 重算，长历史下显著省 CPU）
const calculateMA = (data: Candle[], period: number): number[] => {
  const ma: number[] = new Array(data.length);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    const count = i < period - 1 ? i + 1 : period;
    ma[i] = Number((sum / count).toFixed(2));
  }
  return ma;
};

export default function QuantChart({ quantData, currentPrice, height: _height, externalPeriod }: QuantChartProps) {
  const { chips, technical, candles } = quantData;

  // 初始策略用「不读 localStorage」的确定性口径，避免 SSR/CSR 水合不一致：偏好 Cardwell > 后端默认 > 列表首个。
  const [activeStrategy, setActiveStrategy] = useState<string>(() => {
    const ids = (quantData.strategies ?? []).map((s) => s.meta.id);
    const has = (id?: string | null): id is string => !!id && ids.includes(id);
    if (has(PREFERRED_PRO_STRATEGY_ID)) return PREFERRED_PRO_STRATEGY_ID;
    if (has(quantData.defaultStrategyId)) return quantData.defaultStrategyId;
    return ids[0] ?? quantData.defaultStrategyId ?? "chokepoint";
  });
  // 挂载后按「最后一次选择」（localStorage）校正，与全站各页面一致；失效则保持上面的默认。
  useEffect(() => {
    const ids = (quantData.strategies ?? []).map((s) => s.meta.id);
    const saved = readSavedStrategyId();
    if (saved && ids.includes(saved)) setActiveStrategy(saved);
  }, [quantData.strategies]);
  const [hoveredTrade, setHoveredTrade] = useState<any | null>(null);

  const currentBacktest = useMemo(() => {
    if (quantData.strategies && quantData.strategies.length > 0) {
      const found = quantData.strategies.find((s) => s.meta.id === activeStrategy);
      return (found ?? quantData.strategies[0]).result;
    }
    if (quantData.backtests) {
      return activeStrategy === "traditional"
        ? quantData.backtests.traditional
        : quantData.backtests.chokepoint;
    }
    return quantData.backtest;
  }, [quantData.strategies, quantData.backtests, quantData.backtest, activeStrategy]);

  const activeStrategyMeta = useMemo(
    () => quantData.strategies?.find((s) => s.meta.id === activeStrategy)?.meta,
    [quantData.strategies, activeStrategy],
  );

  const { history, trades, winRate, strategyReturn, stockReturn } = currentBacktest;

  // 标准化绩效报表（随所选策略重算）。
  const perfReport = useMemo(() => computePerformanceReport(history, trades), [history, trades]);

  const [activeTab, setActiveTab] = useState<"report" | "backtest" | "trades">("report");
  const [periodMode, setPeriodMode] = useState<"1D" | "1W" | "1M">("1D");
  const [chartType, setChartType] = useState<"kline" | "worth">("kline");

  // 同步外部受控周期
  useEffect(() => {
    if (externalPeriod) {
      setPeriodMode(externalPeriod);
    }
  }, [externalPeriod]);
  const [showMA5, setShowMA5] = useState(true);
  const [showMA10, setShowMA10] = useState(true);
  const [showMA20, setShowMA20] = useState(true);
  const [showMA60, setShowMA60] = useState(true);
  const [showMA120, setShowMA120] = useState(true);
  const [showMA250, setShowMA250] = useState(true);
  const [showChannel, setShowChannel] = useState(true);
  // 纵轴标度：linear 线性 / log 对数（贴合后复权长周期，低位不贴底）/ pct 百分比（相对首根收盘看相对涨跌）。
  const [yScaleMode, setYScaleMode] = useState<"linear" | "log" | "pct">("linear");
  // 布林带叠加在主图；副图振荡指标单选（无/MACD/RSI/KDJ）。
  const [showBoll, setShowBoll] = useState(false);
  const [subInd, setSubInd] = useState<"none" | "macd" | "rsi" | "kdj">("none");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [hoveredChip, setHoveredChip] = useState<{ price: number; volume: number; ratio: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoomCount, setZoomCount] = useState<number | null>(null);

  // 原生绑定非 passive 的 wheel 事件，阻止页面在滚动图表时整体发生位移
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const preventDefaultWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    svgEl.addEventListener("wheel", preventDefaultWheel, { passive: false });
    return () => {
      svgEl.removeEventListener("wheel", preventDefaultWheel);
    };
  }, []);

  // 1. 回测图大小与间隔
  const mainChartWidth = 620;
  const padding = 20;
  // 副图振荡面板：启用时在成交量下方增一栏，SVG 总高动态加高。
  const subActive = chartType === "kline" && subInd !== "none";
  const oscDrawHeight = 60;
  const oscYStart = 300;
  const totalSvgHeight = subActive ? oscYStart + oscDrawHeight + 16 : 300;

  // 动态高度划分与成交量副图尺寸
  const showVolumeChart = chartType === "kline";
  const mainDrawHeight = showVolumeChart ? 200 : 265; // 主绘图区高度
  const volumeDrawHeight = 50; // 成交量副图高度
  const volumeYStart = 235; // 成交量副图Y轴起始点

  // 聚合当前周期的 K 线数据
  const currentCandles = useMemo(() => {
    const daily = candles || [];
    // 如果外部传入了受控周期，代表 candles 已经是对应的周期了，直接原样返回，拒绝前端重复聚合
    if (externalPeriod) {
      return daily;
    }
    if (periodMode === "1W") {
      return aggregateWeeklyCandles(daily);
    }
    if (periodMode === "1M") {
      return aggregateMonthlyCandles(daily);
    }
    return daily;
  }, [candles, periodMode, externalPeriod]);

  // 均线列表计算
  const ma5List = useMemo(() => calculateMA(currentCandles, 5), [currentCandles]);
  const ma10List = useMemo(() => calculateMA(currentCandles, 10), [currentCandles]);
  const ma20List = useMemo(() => calculateMA(currentCandles, 20), [currentCandles]);
  const ma60List = useMemo(() => calculateMA(currentCandles, 60), [currentCandles]);
  const ma120List = useMemo(() => calculateMA(currentCandles, 120), [currentCandles]);
  const ma250List = useMemo(() => calculateMA(currentCandles, 250), [currentCandles]);

  // 技术指标（副图/叠加），口径对齐通达信/同花顺默认。
  const macdData = useMemo(() => computeMACD(currentCandles), [currentCandles]);
  const rsiData = useMemo(() => computeRSI(currentCandles), [currentCandles]);
  const kdjData = useMemo(() => computeKDJ(currentCandles), [currentCandles]);
  const bollData = useMemo(() => computeBOLL(currentCandles), [currentCandles]);

  // 2. 回测折线图/K线图的坐标映射计算
  const chartParams = useMemo(() => {
    if (currentCandles.length === 0) return null;

    const len = currentCandles.length;
    const dataTotalLen = chartType === "worth" ? history.length : len;
    const visibleCount = zoomCount !== null ? Math.min(zoomCount, dataTotalLen) : Math.min(100, dataTotalLen);
    const sliceStart = Math.max(0, dataTotalLen - visibleCount);

    if (chartType === "kline") {
      const slicedCandles = currentCandles.slice(sliceStart);
      const slicedLen = slicedCandles.length;
      const hasProjections = chartType === "kline" && quantData.projections && quantData.projections.length > 0;
      const totalLen = hasProjections ? slicedLen + quantData.projections!.length : slicedLen;

      const getX = (idx: number) => {
        return padding + (idx / (totalLen - 1)) * (mainChartWidth - 2 * padding);
      };

      // 股价K线视图
      const priceList: number[] = [];
      const slicedMa5 = ma5List.slice(sliceStart);
      const slicedMa10 = ma10List.slice(sliceStart);
      const slicedMa20 = ma20List.slice(sliceStart);
      const slicedMa60 = ma60List.slice(sliceStart);
      const slicedMa120 = ma120List.slice(sliceStart);
      const slicedMa250 = ma250List.slice(sliceStart);
      const slicedBollMid = bollData.mid.slice(sliceStart);
      const slicedBollUp = bollData.upper.slice(sliceStart);
      const slicedBollLow = bollData.lower.slice(sliceStart);

      slicedCandles.forEach((c) => priceList.push(c.high, c.low));
      if (showMA5) priceList.push(...slicedMa5);
      if (showMA10) priceList.push(...slicedMa10);
      if (showMA20) priceList.push(...slicedMa20);
      if (showMA60) priceList.push(...slicedMa60);
      if (showMA120) priceList.push(...slicedMa120);
      if (showMA250) priceList.push(...slicedMa250);

      if (showBoll) {
        for (let bi = 0; bi < slicedBollUp.length; bi++) {
          if (Number.isFinite(slicedBollUp[bi])) priceList.push(slicedBollUp[bi]);
          if (Number.isFinite(slicedBollLow[bi])) priceList.push(slicedBollLow[bi]);
        }
      }

      if (technical?.trendChannel && showChannel) {
        priceList.push(technical.trendChannel.upperLine, technical.trendChannel.lowerLine);
      }

      if (hasProjections && quantData.projections) {
        quantData.projections.forEach((p) => {
          priceList.push(p.bull, p.bear);
        });
      }

      // 用循环取极值而非 Math.max(...arr) 展开：大窗口（如全量 8000 根）下 priceList 可达数万元素，
      // 展开成参数会触发「Maximum call stack size exceeded」，循环既安全又更快。
      let rawMax = 1;
      let rawMin = 9999;
      for (let pi = 0; pi < priceList.length; pi++) {
        const v = priceList[pi];
        if (v > rawMax) rawMax = v;
        if (v < rawMin) rawMin = v;
      }
      const maxVal = rawMax * 1.03;
      const minVal = rawMin * 0.97;
      const range = maxVal - minVal || 1;

      // 纵轴标度：对数仅在最小值为正时启用（否则自动回退线性，避免 log 负数）；百分比与线性同形（仅轴标签不同）。
      const logOk = yScaleMode === "log" && minVal > 0;
      const effYMode: "linear" | "log" | "pct" = logOk ? "log" : yScaleMode === "log" ? "linear" : yScaleMode;
      const lnMin = logOk ? Math.log(minVal) : 0;
      const lnRange = logOk ? (Math.log(maxVal) - lnMin) || 1 : 1;
      const yBase = slicedCandles[0]?.close || minVal || 1;

      const getY = (val: number) => {
        if (logOk) {
          const v = val > 0 ? val : minVal;
          return padding + (1 - (Math.log(v) - lnMin) / lnRange) * mainDrawHeight;
        }
        return padding + (1 - (val - minVal) / range) * mainDrawHeight;
      };
      // 给定纵向比例位置（0=顶部/最大值, 1=底部/最小值）反推该处价格，供网格轴标签使用（对数下取指数刻度）。
      const yValueAt = (frac: number) => {
        if (logOk) return Math.exp(Math.log(maxVal) - frac * lnRange);
        return maxVal - frac * (maxVal - minVal);
      };
      // 跳过 NaN 预热段的折线路径（用于 BOLL 等有预热期的叠加线）。
      const finiteLinePath = (arr: number[]) => {
        const pts: string[] = [];
        for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) continue;
          pts.push(`${getX(i).toFixed(1)},${getY(arr[i]).toFixed(1)}`);
        }
        return pts.length ? `M ${pts.join(" L ")}` : "";
      };
      const bollMidPath = showBoll ? finiteLinePath(slicedBollMid) : "";
      const bollUpperPath = showBoll ? finiteLinePath(slicedBollUp) : "";
      const bollLowerPath = showBoll ? finiteLinePath(slicedBollLow) : "";

      // 计算成交量最大值 (在可视蜡烛切片中取最值，使缩放后成交量柱子高低对比自适应展现)
      let maxVolume = 1;
      for (let ci = 0; ci < slicedCandles.length; ci++) {
        const v = slicedCandles[ci].volume || 0;
        if (v > maxVolume) maxVolume = v;
      }

      // 拟合通道曲线在 K线视图下的价格映射路径 (延伸至未来预测端点)
      let upperChannelPath = "";
      let lowerChannelPath = "";
      let midChannelPath = "";
      let channelAreaPath = "";

      if (technical && technical.trendChannel) {
        const { slope, upperLine, lowerLine, midLine } = technical.trendChannel;
        const channelLen = Math.min(len, (periodMode === "1W" || periodMode === "1M") ? 12 : 60);
        const startIndex = len - channelLen;
        
        const upperDiff = upperLine - midLine;
        const lowerDiff = midLine - lowerLine;
        
        const upperPoints: string[] = [];
        const lowerPoints: string[] = [];
        const midPoints: string[] = [];
        
        const polygonUpper: string[] = [];
        const polygonLower: string[] = [];
        
        const limit = hasProjections ? len + quantData.projections!.length : len;
        for (let i = startIndex; i < limit; i++) {
          if (i >= sliceStart) {
            const visibleIdx = i - sliceStart;
            const offset = len - 1 - i;
            const factor = periodMode === "1W" ? 5 : periodMode === "1M" ? 20 : 1;
            const midVal = midLine - slope * offset * factor;
            const upperVal = midVal + upperDiff;
            const lowerVal = midVal - lowerDiff;
            
            const x = getX(visibleIdx);
            const yMid = getY(midVal);
            const yUpper = getY(upperVal);
            const yLower = getY(lowerVal);
            
            midPoints.push(`${x.toFixed(1)},${yMid.toFixed(1)}`);
            upperPoints.push(`${x.toFixed(1)},${yUpper.toFixed(1)}`);
            lowerPoints.push(`${x.toFixed(1)},${yLower.toFixed(1)}`);
            
            polygonUpper.push(`${x.toFixed(1)},${yUpper.toFixed(1)}`);
            polygonLower.unshift(`${x.toFixed(1)},${yLower.toFixed(1)}`);
          }
        }
        
        upperChannelPath = `M ${upperPoints.join(" L ")}`;
        lowerChannelPath = `M ${lowerPoints.join(" L ")}`;
        midChannelPath = `M ${midPoints.join(" L ")}`;
        
        if (polygonUpper.length > 0) {
          channelAreaPath = `M ${polygonUpper.join(" L ")} L ${polygonLower.join(" L ")} Z`;
        }
      }

      // 拟合未来预测折线与面积路径
      let projBullPath = "";
      let projBasePath = "";
      let projBearPath = "";
      let projAreaPath = "";
      const lastPrice = slicedCandles[slicedLen - 1]?.close || currentPrice;

      if (hasProjections && quantData.projections) {
        const bullPoints = [`${getX(slicedLen - 1).toFixed(1)},${getY(lastPrice).toFixed(1)}`];
        const basePoints = [`${getX(slicedLen - 1).toFixed(1)},${getY(lastPrice).toFixed(1)}`];
        const bearPoints = [`${getX(slicedLen - 1).toFixed(1)},${getY(lastPrice).toFixed(1)}`];
        
        const polyUpper = [`${getX(slicedLen - 1).toFixed(1)},${getY(lastPrice).toFixed(1)}`];
        const polyLower = [`${getX(slicedLen - 1).toFixed(1)},${getY(lastPrice).toFixed(1)}`];

        quantData.projections.forEach((p, idx) => {
          const x = getX(slicedLen + idx);
          bullPoints.push(`${x.toFixed(1)},${getY(p.bull).toFixed(1)}`);
          basePoints.push(`${x.toFixed(1)},${getY(p.base).toFixed(1)}`);
          bearPoints.push(`${x.toFixed(1)},${getY(p.bear).toFixed(1)}`);

          polyUpper.push(`${x.toFixed(1)},${getY(p.bull).toFixed(1)}`);
          polyLower.unshift(`${x.toFixed(1)},${getY(p.bear).toFixed(1)}`);
        });

        projBullPath = `M ${bullPoints.join(" L ")}`;
        projBasePath = `M ${basePoints.join(" L ")}`;
        projBearPath = `M ${projBearPath = `M ${bearPoints.join(" L ")}`}`;
        projAreaPath = `M ${polyUpper.join(" L ")} L ${polyLower.join(" L ")} Z`;
      }

      // 多均线路径
      const ma5Points = slicedMa5.map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
      const ma10Points = slicedMa10.map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
      const ma20Points = slicedMa20.map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
      const ma60Points = slicedMa60.map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
      const ma120Points = slicedMa120.map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
      const ma250Points = slicedMa250.map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);

      // 交易标记点在 K线主图的映射 (找到相同日期的 K 线绘制在 high/low 上方)
      // 先建「日期/周/月 键 → 切片内首个索引」的 Map，O(n)；避免逐笔交易 findIndex 的 O(交易数×n)。
      const keyOf = (date: string) =>
        periodMode === "1W" ? getYearWeek(date) : periodMode === "1M" ? date.slice(0, 7) : date;
      const dateToIdx = new Map<string, number>();
      for (let idx = 0; idx < slicedCandles.length; idx++) {
        const k = keyOf(slicedCandles[idx].date);
        if (!dateToIdx.has(k)) dateToIdx.set(k, idx);
      }
      const tradePoints = trades
        .map((t) => {
          const idx = dateToIdx.get(keyOf(t.date));
          if (idx === undefined) return null;
          const isBuy = t.type === "buy";
          // 悬浮显示在K线高/低价两侧
          const price = isBuy ? slicedCandles[idx].low : slicedCandles[idx].high;
          return {
            ...t,
            x: getX(idx),
            y: getY(price) + (isBuy ? 8 : -8),
          };
        })
        .filter(Boolean) as (TradeAction & { x: number; y: number })[];

      // 3. 计算所有可见的历史趋势通道路径
      // 只在「可视切片」上做通道检测（原来对全量 currentCandles 跑，长历史下 O(N×60×len) 极昂贵）。
      // 返回索引即切片内相对索引，直接用作 visibleIdx，无需再按 sliceStart 裁剪。
      const histChannels = detectHistoricalChannels(slicedCandles);
      const histChannelPaths: Array<{
        type: "up" | "down" | "range";
        upperPath: string;
        lowerPath: string;
        midPath: string;
        areaPath: string;
      }> = [];

      histChannels.forEach((chan) => {
        {
          // chan.startIndex/endIndex 已是切片内相对索引
          const drawStart = chan.startIndex;
          const drawEnd = chan.endIndex;
          
          if (drawEnd >= drawStart) {
            const upperDiff = 1.8 * chan.stdDev;
            const lowerDiff = 1.8 * chan.stdDev;
            
            const upperPoints: string[] = [];
            const lowerPoints: string[] = [];
            const midPoints: string[] = [];
            
            const polygonUpper: string[] = [];
            const polygonLower: string[] = [];
            
            for (let i = drawStart; i <= drawEnd; i++) {
              const visibleIdx = i;
              const offset = i - chan.startIndex;
              const midVal = chan.intercept + chan.slope * offset;
              const upperVal = midVal + upperDiff;
              const lowerVal = midVal - lowerDiff;
              
              const x = getX(visibleIdx);
              const yMid = getY(midVal);
              const yUpper = getY(upperVal);
              const yLower = getY(lowerVal);
              
              midPoints.push(`${x.toFixed(1)},${yMid.toFixed(1)}`);
              upperPoints.push(`${x.toFixed(1)},${yUpper.toFixed(1)}`);
              lowerPoints.push(`${x.toFixed(1)},${yLower.toFixed(1)}`);
              
              polygonUpper.push(`${x.toFixed(1)},${yUpper.toFixed(1)}`);
              polygonLower.unshift(`${x.toFixed(1)},${yLower.toFixed(1)}`);
            }
            
            histChannelPaths.push({
              type: chan.type,
              upperPath: `M ${upperPoints.join(" L ")}`,
              lowerPath: `M ${lowerPoints.join(" L ")}`,
              midPath: `M ${midPoints.join(" L ")}`,
              areaPath: polygonUpper.length > 0 ? `M ${polygonUpper.join(" L ")} L ${polygonLower.join(" L ")} Z` : ""
            });
          }
        }
      });

      return {
        type: "kline" as const,
        sliceStart,
        minWorth: minVal,
        maxWorth: maxVal,
        getX,
        getY,
        yMode: effYMode,
        yBase,
        yValueAt,
        bollMidPath,
        bollUpperPath,
        bollLowerPath,
        ma5Path: `M ${ma5Points.join(" L ")}`,
        ma10Path: `M ${ma10Points.join(" L ")}`,
        ma20Path: `M ${ma20Points.join(" L ")}`,
        ma60Path: `M ${ma60Points.join(" L ")}`,
        ma120Path: `M ${ma120Points.join(" L ")}`,
        ma250Path: `M ${ma250Points.join(" L ")}`,
        upperChannelPath,
        lowerChannelPath,
        midChannelPath,
        channelAreaPath,
        tradePoints,
        maxVolume,
        // 未来预测
        projBullPath,
        projBasePath,
        projBearPath,
        projAreaPath,
        hasProjections,
        len: slicedLen,
        slicedCandles,
        slicedMa5,
        slicedMa10,
        slicedMa20,
        slicedMa60,
        slicedMa120,
        slicedMa250,
        histChannelPaths
      };
    } else {
      // 策略净值视图 (基于 history 数组，仅当日线有效)
      if (history.length === 0) return null;
      const historyLen = history.length;
      const slicedHistory = history.slice(sliceStart);
      const slicedHistoryLen = slicedHistory.length;
      
      const getXWorth = (idx: number) => {
        return padding + (idx / (slicedHistoryLen - 1)) * (mainChartWidth - 2 * padding);
      };

      const strategyWorths = slicedHistory.map((h) => h.strategyWorth);
      const stockWorths = slicedHistory.map((h) => h.stockWorth);
      const allWorths = [...strategyWorths, ...stockWorths];

      const maxWorth = Math.max(...allWorths, 100000) * 1.05;
      const minWorth = Math.min(...allWorths, 100000) * 0.95;
      const worthRange = maxWorth - minWorth || 1;

      const getY = (val: number) => {
        return padding + (1 - (val - minWorth) / worthRange) * mainDrawHeight;
      };

      const strategyPoints = slicedHistory.map((h, idx) => `${getXWorth(idx).toFixed(1)},${getY(h.strategyWorth).toFixed(1)}`);
      const stockPoints = slicedHistory.map((h, idx) => `${getXWorth(idx).toFixed(1)},${getY(h.stockWorth).toFixed(1)}`);

      // 净值下的回归通道映射
      let upperChannelPath = "";
      let lowerChannelPath = "";
      let midChannelPath = "";
      let channelAreaPath = "";

      if (technical && technical.trendChannel && showChannel) {
        const { slope, upperLine, lowerLine, midLine } = technical.trendChannel;
        const channelLen = Math.min(historyLen, 60);
        const startIndex = historyLen - channelLen;
        
        const lastWorth = history[historyLen - 1].stockWorth;
        const scaleFactor = lastWorth / (currentPrice || 1);
        
        const upperDiff = upperLine - midLine;
        const lowerDiff = midLine - lowerLine;
        
        const upperPoints: string[] = [];
        const lowerPoints: string[] = [];
        const midPoints: string[] = [];
        const polygonUpper: string[] = [];
        const polygonLower: string[] = [];
        
        for (let i = startIndex; i < historyLen; i++) {
          if (i >= sliceStart) {
            const visibleIdx = i - sliceStart;
            const offset = historyLen - 1 - i;
            const midVal = midLine - slope * offset;
            const upperVal = midVal + upperDiff;
            const lowerVal = midVal - lowerDiff;
            
            const x = getXWorth(visibleIdx);
            const yMid = getY(midVal * scaleFactor);
            const yUpper = getY(upperVal * scaleFactor);
            const yLower = getY(lowerVal * scaleFactor);
            
            midPoints.push(`${x.toFixed(1)},${yMid.toFixed(1)}`);
            upperPoints.push(`${x.toFixed(1)},${yUpper.toFixed(1)}`);
            lowerPoints.push(`${x.toFixed(1)},${yLower.toFixed(1)}`);
            
            polygonUpper.push(`${x.toFixed(1)},${yUpper.toFixed(1)}`);
            polygonLower.unshift(`${x.toFixed(1)},${yLower.toFixed(1)}`);
          }
        }
        
        upperChannelPath = `M ${upperPoints.join(" L ")}`;
        lowerChannelPath = `M ${lowerPoints.join(" L ")}`;
        midChannelPath = `M ${midPoints.join(" L ")}`;
        if (polygonUpper.length > 0) {
          channelAreaPath = `M ${polygonUpper.join(" L ")} L ${polygonLower.join(" L ")} Z`;
        }
      }

      // 日期 → 切片内索引 Map（O(n)），替代逐笔 findIndex 的 O(交易数×n)。
      const histDateToIdx = new Map<string, number>();
      for (let idx = 0; idx < slicedHistory.length; idx++) {
        if (!histDateToIdx.has(slicedHistory[idx].date)) histDateToIdx.set(slicedHistory[idx].date, idx);
      }
      const tradePoints = trades
        .map((t) => {
          const idx = histDateToIdx.get(t.date);
          if (idx === undefined) return null;
          return {
            ...t,
            x: getXWorth(idx),
            y: getY(slicedHistory[idx].strategyWorth),
          };
        })
        .filter(Boolean) as (TradeAction & { x: number; y: number })[];

      return {
        type: "worth" as const,
        sliceStart,
        minWorth,
        maxWorth,
        getX: getXWorth,
        getY,
        yMode: "linear" as const,
        yBase: 0,
        yValueAt: (frac: number) => maxWorth - frac * (maxWorth - minWorth),
        strategyPath: `M ${strategyPoints.join(" L ")}`,
        stockPath: `M ${stockPoints.join(" L ")}`,
        upperChannelPath,
        lowerChannelPath,
        midChannelPath,
        channelAreaPath,
        tradePoints,
        slicedHistory
      };
    }
  }, [currentCandles, chartType, showMA5, showMA10, showMA20, showMA60, showMA120, showMA250, showChannel, showBoll, yScaleMode, technical, history, trades, currentPrice, periodMode, mainDrawHeight, zoomCount, ma5List, ma10List, ma20List, ma60List, ma120List, ma250List, bollData, quantData]);

  // 3. 筹码分布直方图的渲染映射计算
  const chipChartWidth = 140;

  // 联动筹码数据源：当 hoveredIdx 不为空且在 K 线范围内，实时计算当前日期的筹码分布；否则使用最新筹码
  const activeChips = useMemo(() => {
    if (hoveredIdx === null || !chartParams) {
      return chips;
    }
    const sliceStart = (chartParams as any).sliceStart || 0;
    const absoluteIdx = sliceStart + hoveredIdx;
    if (absoluteIdx >= currentCandles.length) {
      return chips;
    }
    const subHistory = currentCandles.slice(0, absoluteIdx + 1);
    const dayClose = currentCandles[absoluteIdx].close;
    return calculateChipDistribution(subHistory, dayClose);
  }, [currentCandles, chips, hoveredIdx, chartParams]);

  // 联动指示价格：当 hoveredIdx 不为空且在 K 线范围内，使用该天的收盘价，否则使用最新现价
  const activePrice = useMemo(() => {
    if (hoveredIdx === null || !chartParams) {
      return currentPrice;
    }
    const sliceStart = (chartParams as any).sliceStart || 0;
    const absoluteIdx = sliceStart + hoveredIdx;
    if (absoluteIdx >= currentCandles.length) {
      return currentPrice;
    }
    return currentCandles[absoluteIdx].close;
  }, [currentCandles, currentPrice, hoveredIdx, chartParams]);

  // 计算 hovered 价格下的累计获利盘比例 (小于等于此价格的筹码量 / 总筹码量)
  const hoveredProfitRatio = useMemo(() => {
    if (!hoveredChip || !activeChips || !activeChips.bins) return 0;
    const total = activeChips.bins.reduce((sum, b) => sum + b.volume, 0) || 1;
    const profit = activeChips.bins
      .filter((b) => b.price <= hoveredChip.price)
      .reduce((sum, b) => sum + b.volume, 0);
    return (profit / total) * 100;
  }, [hoveredChip, activeChips]);

  const totalChipVolume = useMemo(() => {
    if (!activeChips || !activeChips.bins) return 1;
    return activeChips.bins.reduce((sum, b) => sum + b.volume, 0) || 1;
  }, [activeChips]);

  const chipParams = useMemo(() => {
    if (!activeChips || !activeChips.bins || activeChips.bins.length === 0 || !chartParams || chartParams.type !== "kline") return null;

    const maxVol = Math.max(...activeChips.bins.map((b) => b.volume), 1);
    
    // 统一复用主图的 getY 映射，计算两个相邻 bin 的 Y 轴高度像素差
    let binHeight = 5;
    if (activeChips.bins.length >= 2) {
      const y1 = chartParams.getY(activeChips.bins[0].price);
      const y2 = chartParams.getY(activeChips.bins[1].price);
      const yDiff = Math.abs(y1 - y2);
      binHeight = Math.max(1, yDiff - 0.5);
    }

    return {
      maxVol,
      binHeight,
    };
  }, [activeChips, chartParams]);

  // 键盘和鼠标事件交互
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartParams) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * 760; // 映射到合并后的 760px 总宽度

    if (svgX < 620) {
      setHoveredChip(null);

      const hasProjections = chartParams.type === "kline" && chartParams.hasProjections;
      const len = chartParams.type === "worth" 
        ? chartParams.slicedHistory.length 
        : chartParams.slicedCandles.length + (hasProjections ? quantData.projections!.length : 0);
      if (len <= 1) return;

      const graphWidth = 620 - 2 * padding; // K线主图绘图区宽度
      const relativeX = svgX - padding;
      const idx = Math.round((relativeX / graphWidth) * (len - 1));

      if (idx >= 0 && idx < len) {
        setHoveredIdx(idx);
      }
    } else {
      setHoveredIdx(null);

      if (chartParams.type !== "kline" || !activeChips || !activeChips.bins || activeChips.bins.length === 0) return;

      const clientY = e.clientY - rect.top;
      const svgY = (clientY / rect.height) * 300;

      let closestBin = null;
      let minDistance = Infinity;
      for (const b of activeChips.bins) {
        if (b.price < chartParams.minWorth || b.price > chartParams.maxWorth) continue;
        const y = chartParams.getY(b.price);
        const dist = Math.abs(y - svgY);
        if (dist < minDistance) {
          minDistance = dist;
          closestBin = b;
        }
      }

      if (closestBin) {
        const ratio = closestBin.volume / totalChipVolume;
        setHoveredChip({
          price: closestBin.price,
          volume: closestBin.volume,
          ratio,
        });
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!chartParams) return;
    const touch = e.touches[0];
    if (!touch) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = touch.clientX - rect.left;
    const svgX = (clientX / rect.width) * 760;

    if (svgX < 620) {
      setHoveredChip(null);

      const hasProjections = chartParams.type === "kline" && chartParams.hasProjections;
      const len = chartParams.type === "worth" 
        ? chartParams.slicedHistory.length 
        : chartParams.slicedCandles.length + (hasProjections ? quantData.projections!.length : 0);
      if (len <= 1) return;

      const graphWidth = 620 - 2 * padding;
      const relativeX = svgX - padding;
      const idx = Math.round((relativeX / graphWidth) * (len - 1));

      if (idx >= 0 && idx < len) {
        setHoveredIdx(idx);
      }
    } else {
      setHoveredIdx(null);

      if (chartParams.type !== "kline" || !activeChips || !activeChips.bins || activeChips.bins.length === 0) return;

      const clientY = touch.clientY - rect.top;
      const svgY = (clientY / rect.height) * 300;

      let closestBin = null;
      let minDistance = Infinity;
      for (const b of activeChips.bins) {
        if (b.price < chartParams.minWorth || b.price > chartParams.maxWorth) continue;
        const y = chartParams.getY(b.price);
        const dist = Math.abs(y - svgY);
        if (dist < minDistance) {
          minDistance = dist;
          closestBin = b;
        }
      }

      if (closestBin) {
        const ratio = closestBin.volume / totalChipVolume;
        setHoveredChip({
          price: closestBin.price,
          volume: closestBin.volume,
          ratio,
        });
      }
    }
  };

  const handleTouchEnd = () => {
    setHoveredIdx(null);
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const activeLen = chartType === "worth" ? history.length : currentCandles.length;
    if (activeLen <= 15) return;

    const currentVisible = zoomCount !== null ? zoomCount : Math.min(100, activeLen);
    const step = Math.max(1, Math.round(currentVisible * 0.08));
    let nextVisible = currentVisible;
    
    if (e.deltaY > 0) {
      // 缩小 (增加可视数量)
      nextVisible = Math.min(activeLen, currentVisible + step);
    } else if (e.deltaY < 0) {
      // 放大 (减少可视数量)
      nextVisible = Math.max(15, currentVisible - step);
    }
    
    setZoomCount(nextVisible);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!chartParams) return;
    const hasProjections = chartParams.type === "kline" && chartParams.hasProjections;
    const len = chartParams.type === "worth" 
      ? chartParams.slicedHistory.length 
      : chartParams.slicedCandles.length + (hasProjections ? quantData.projections!.length : 0);
    if (len <= 1) return;

    let nextIdx = hoveredIdx === null ? len - 1 : hoveredIdx;
    if (e.key === "ArrowLeft") {
      nextIdx = Math.max(0, nextIdx - 1);
      setHoveredIdx(nextIdx);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      nextIdx = Math.min(len - 1, nextIdx + 1);
      setHoveredIdx(nextIdx);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      const dataLen = chartType === "worth" ? history.length : currentCandles.length;
      const currentVisible = zoomCount !== null ? zoomCount : Math.min(100, dataLen);
      const step = Math.max(1, Math.round(currentVisible * 0.08));
      setZoomCount(Math.max(15, currentVisible - step));
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      const dataLen = chartType === "worth" ? history.length : currentCandles.length;
      const currentVisible = zoomCount !== null ? zoomCount : Math.min(100, dataLen);
      const step = Math.max(1, Math.round(currentVisible * 0.08));
      setZoomCount(Math.min(dataLen, currentVisible + step));
      e.preventDefault();
    }
  };

  const focusContainer = () => {
    containerRef.current?.focus();
  };

  // 辅助格式化函数
  const formatVolume = (volNum: number): string => {
    const hands = volNum / 100;
    if (hands >= 10000) {
      return (hands / 10000).toFixed(1) + " 万手";
    }
    return hands.toFixed(0) + " 手";
  };

  const formatAmount = (amtNum: number): string => {
    if (!amtNum) return "-";
    if (amtNum >= 100000000) {
      return (amtNum / 100000000).toFixed(1) + " 亿元";
    }
    if (amtNum >= 10000) {
      return (amtNum / 10000).toFixed(0) + " 万元";
    }
    return amtNum.toFixed(0) + " 元";
  };

  // 仅在 chartParams 完全缺失时才显示报错；chipParams 为 null 时（净值模式或筹码异常）只降级隐藏筹码图
  if (!chartParams) {
    return (
      <div className="py-8 text-center text-xs text-[var(--muted)] font-mono">
        QUANT DATA PROCESSING FAILED.
      </div>
    );
  }

  // 差额及比例计算
  const strategyPerf = strategyReturn >= 0 ? `+${strategyReturn.toFixed(1)}%` : `${strategyReturn.toFixed(1)}%`;
  const stockPerf = stockReturn >= 0 ? `+${stockReturn.toFixed(1)}%` : `${stockReturn.toFixed(1)}%`;
  const alphaReturn = strategyReturn - stockReturn;
  const alphaPerf = alphaReturn >= 0 ? `+${alphaReturn.toFixed(1)}%` : `${alphaReturn.toFixed(1)}%`;

  // 获取 Tooltip 浮框渲染数据
  const renderTooltip = () => {
    const hasProjections = chartParams.type === "kline" && chartParams.hasProjections;
    const len = chartParams.type === "worth" 
      ? chartParams.slicedHistory.length 
      : chartParams.slicedCandles.length + (hasProjections ? quantData.projections!.length : 0);
    const idx = hoveredIdx !== null ? hoveredIdx : len - 1;

    if (chartParams.type === "kline") {
      const histLen = chartParams.slicedCandles.length;
      if (idx >= histLen && quantData.projections) {
        // 渲染未来预测数据
        const p = quantData.projections[idx - histLen];
        if (!p) return null;
        return (
          <div className="text-[10px] font-mono text-[var(--text)] flex flex-wrap gap-x-4 gap-y-1 py-1 px-2.5 bg-[var(--inset)] border border-blue-500/30 rounded-[2px] select-none">
            <span className="text-blue-400 font-bold">[走势预测] {p.date}</span>
            <span>乐观目标: <b className="font-semibold text-emerald-400">{p.bull.toFixed(2)} 元</b></span>
            <span>基准期望: <b className="font-semibold text-blue-400">{p.base.toFixed(2)} 元</b></span>
            <span>悲观底线: <b className="font-semibold text-red-400">{p.bear.toFixed(2)} 元</b></span>
          </div>
        );
      }

      const c = chartParams.slicedCandles[idx];
      if (!c) return null;
      const currentProfitRatio = activeChips ? (activeChips.profitRatio * 100).toFixed(1) : "0.0";
      return (
        <div className="text-[10px] font-mono text-[var(--text)] flex flex-wrap gap-x-4 gap-y-1 py-1 px-2.5 bg-[var(--inset)] border border-[var(--border)] rounded-[2px] select-none">
          <span className="text-amber-500 font-bold">{c.date}</span>
          <span>开: <b className="font-semibold">{c.open.toFixed(2)}</b></span>
          <span>高: <b className="font-semibold">{c.high.toFixed(2)}</b></span>
          <span>低: <b className="font-semibold">{c.low.toFixed(2)}</b></span>
          <span>收: <b className="font-semibold text-emerald-400">{c.close.toFixed(2)}</b></span>
          <span>获利比例: <b className="font-semibold text-red-400">{currentProfitRatio}%</b></span>
          {showMA5 && chartParams.slicedMa5[idx] && <span>MA5: <span style={{ color: "#fef08a" }}>{chartParams.slicedMa5[idx].toFixed(2)}</span></span>}
          {showMA10 && chartParams.slicedMa10[idx] && <span>MA10: <span style={{ color: "#c084fc" }}>{chartParams.slicedMa10[idx].toFixed(2)}</span></span>}
          {showMA20 && chartParams.slicedMa20[idx] && <span>MA20: <span style={{ color: "#4ade80" }}>{chartParams.slicedMa20[idx].toFixed(2)}</span></span>}
          {showMA60 && chartParams.slicedMa60[idx] && <span>MA60: <span style={{ color: "#fb923c" }}>{chartParams.slicedMa60[idx].toFixed(2)}</span></span>}
          {showMA120 && chartParams.slicedMa120[idx] && <span>MA120: <span style={{ color: "#a855f7" }}>{chartParams.slicedMa120[idx].toFixed(2)}</span></span>}
          {showMA250 && chartParams.slicedMa250[idx] && <span>MA250: <span style={{ color: "#ef4444" }}>{chartParams.slicedMa250[idx].toFixed(2)}</span></span>}
          <span>量: <b className="text-sky-400">{formatVolume(c.volume)}</b></span>
          <span>额: <b className="text-sky-400">{formatAmount(c.amount)}</b></span>
          <span>换手: <b>{c.turnoverPct}%</b></span>
        </div>
      );
    } else {
      const h = chartParams.slicedHistory[idx];
      if (!h) return null;
      const excess = ((h.strategyWorth - h.stockWorth) / 1000).toFixed(1);
      return (
        <div className="text-[10px] font-mono text-[var(--text)] flex flex-wrap gap-x-4 gap-y-1 py-1 px-2.5 bg-[var(--inset)] border border-[var(--border)] rounded-[2px] select-none">
          <span className="text-amber-500 font-bold">{h.date}</span>
          <span>策略净值: <b className="text-emerald-400">{h.strategyWorth.toLocaleString()}</b> 元</span>
          <span>个股对照: <b className="text-stone-400">{h.stockWorth.toLocaleString()}</b> 元</span>
          <span>模拟超额: <b className={Number(excess) >= 0 ? "text-red-400" : "text-emerald-400"}>{Number(excess) >= 0 ? "+" : ""}{excess}%</b></span>
        </div>
      );
    }
  };

  const getCrosshairY = () => {
    const hasProjections = chartParams.type === "kline" && chartParams.hasProjections;
    const len = chartParams.type === "worth" 
      ? chartParams.slicedHistory.length 
      : chartParams.slicedCandles.length + (hasProjections ? quantData.projections!.length : 0);
    const idx = hoveredIdx !== null ? hoveredIdx : len - 1;

    if (chartParams.type === "kline") {
      const histLen = chartParams.slicedCandles.length;
      if (idx >= histLen && quantData.projections) {
        const p = quantData.projections[idx - histLen];
        return p ? chartParams.getY(p.base) : padding;
      }
      const c = chartParams.slicedCandles[idx];
      return c ? chartParams.getY(c.close) : padding;
    } else {
      const h = chartParams.slicedHistory[idx];
      return h ? chartParams.getY(h.strategyWorth) : padding;
    }
  };

  const hasProjections = chartType === "kline" && quantData.projections && quantData.projections.length > 0;
  const activeLen = chartType === "worth" 
    ? history.length 
    : currentCandles.length + (hasProjections ? quantData.projections!.length : 0);
  const activeIdx = hoveredIdx !== null ? hoveredIdx : activeLen - 1;
  const activeX = chartParams.getX(activeIdx);

  return (
    <div 
      ref={containerRef}
      tabIndex={0} 
      onKeyDown={handleKeyDown}
      onMouseEnter={focusContainer}
      className="border border-[var(--border)] bg-[var(--surface)] p-4 rounded-[2px] space-y-4 focus:ring-1 focus:ring-[var(--accent)]/30 outline-none"
    >
      {/* 1. 量化指标卡片组 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2.5 rounded-none text-center">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">策略收益率</span>
          <span className={`font-mono text-sm font-bold ${strategyReturn >= 0 ? "text-red-500" : "text-emerald-500"}`}>
            {strategyPerf}
          </span>
        </div>
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2.5 rounded-none text-center">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">个股同期幅</span>
          <span className={`font-mono text-sm font-semibold ${stockReturn >= 0 ? "text-red-500" : "text-emerald-500"}`}>
            {stockPerf}
          </span>
        </div>
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2.5 rounded-none text-center">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">策略超额收益 (α)</span>
          <span className={`font-mono text-sm font-black ${alphaReturn >= 0 ? "text-red-500" : "text-emerald-500"}`}>
            {alphaPerf}
          </span>
        </div>
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2.5 rounded-none text-center">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">回测平仓胜率</span>
          <span className="font-mono text-sm font-bold text-[var(--text)]">
            {winRate > 0 ? `${winRate}%` : "--"}
          </span>
        </div>
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2.5 rounded-none text-center">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">筹码获利比例</span>
          <span className={`font-mono text-sm font-bold ${chips.profitRatio >= 0.7 ? "text-red-500" : "text-[var(--accent)]"}`}>
            {(chips.profitRatio * 100).toFixed(1)}%
          </span>
        </div>
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2.5 rounded-none text-center">
          <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">平均持仓成本</span>
          <span className="font-mono text-sm font-semibold text-[var(--text)]">
            {chips.avgCost} 元
          </span>
        </div>
      </div>

      {/* 2. Toolbar 控制栏 (类似 TradingView 面板工具条) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* 策略切换 */}
          {quantData.strategies && quantData.strategies.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] select-none">策略</span>
              <select
                value={activeStrategy}
                onChange={(e) => { setActiveStrategy(e.target.value); saveStrategyId(e.target.value); }}
                title={activeStrategyMeta?.description}
                className="bg-[var(--inset)] border border-[var(--border)] text-[10px] font-bold tracking-wide text-[var(--text)] px-2 py-1 rounded-[1px] cursor-pointer focus:outline-none focus:border-[var(--accent)]"
              >
                {quantData.strategies.map((s) => (
                  <option key={s.meta.id} value={s.meta.id}>
                    {s.meta.name} v{s.meta.version}
                    {s.meta.id === quantData.defaultStrategyId ? " · 默认" : ""}
                  </option>
                ))}
              </select>
              {activeStrategyMeta && (
                <span className="text-[9px] font-mono text-[var(--accent)] border border-[var(--accent)]/40 rounded-full px-1.5 py-0.5 select-none">
                  v{activeStrategyMeta.version}
                </span>
              )}
            </div>
          ) : (
            <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
              <button
                onClick={() => setActiveStrategy("chokepoint")}
                className={`px-3 py-1 text-[10px] font-bold tracking-wide transition cursor-pointer rounded-[1px] ${
                  activeStrategy === "chokepoint" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                Serenity 瓶颈动量突破 (默认)
              </button>
              <button
                onClick={() => setActiveStrategy("traditional")}
                className={`px-3 py-1 text-[10px] font-bold tracking-wide transition cursor-pointer rounded-[1px] ${
                  activeStrategy === "traditional" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                传统均线突破
              </button>
            </div>
          )}

          {/* 视图切换 */}
          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px]">
            <button
              onClick={() => { setChartType("kline"); setPeriodMode("1D"); }}
              className={`px-3 py-1 text-[10px] font-bold tracking-wide transition cursor-pointer rounded-[1px] ${
                chartType === "kline" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              股价K线图 (MA)
            </button>
            <button
              onClick={() => { setChartType("worth"); setPeriodMode("1D"); }}
              className={`px-3 py-1 text-[10px] font-bold tracking-wide transition cursor-pointer rounded-[1px] ${
                chartType === "worth" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              策略净值对比
            </button>
          </div>

          {/* 均线和通道开关 */}
          {chartType === "kline" && (
            <div className="flex items-center gap-2.5 text-[9.5px] font-mono text-[var(--muted)] select-none">
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
                <input type="checkbox" checked={showMA5} onChange={(e) => setShowMA5(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                MA5
              </label>
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
                <input type="checkbox" checked={showMA10} onChange={(e) => setShowMA10(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                MA10
              </label>
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
                <input type="checkbox" checked={showMA20} onChange={(e) => setShowMA20(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                MA20
              </label>
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
                <input type="checkbox" checked={showMA60} onChange={(e) => setShowMA60(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                MA60
              </label>
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
                <input type="checkbox" checked={showMA120} onChange={(e) => setShowMA120(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                MA120
              </label>
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]">
                <input type="checkbox" checked={showMA250} onChange={(e) => setShowMA250(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                MA250
              </label>
              <label className="flex items-center gap-1 cursor-pointer hover:text-[var(--text)]" title="布林带 BOLL(20,2)：中轨=MA20，上下轨=±2倍标准差">
                <input type="checkbox" checked={showBoll} onChange={(e) => setShowBoll(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
                BOLL
              </label>
            </div>
          )}

          <label className="flex items-center gap-1 text-[9.5px] font-mono text-[var(--muted)] cursor-pointer hover:text-[var(--text)] select-none">
            <input type="checkbox" checked={showChannel} onChange={(e) => setShowChannel(e.target.checked)} className="rounded-[1px] accent-[var(--accent)]" />
            回归通道
          </label>

          {/* 纵轴标度切换（对标 TradingView 线性/对数/百分比）：对数贴合后复权长周期，百分比看相对涨跌 */}
          {chartType === "kline" && (
            <div className="flex items-center gap-1" title="纵轴标度：线性 / 对数（贴合后复权长周期，低位不贴底）/ 百分比（相对首根收盘看相对涨跌）">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] select-none">纵轴</span>
              <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px] font-mono">
                {([["linear", "线性"], ["log", "对数"], ["pct", "%"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setYScaleMode(m)}
                    className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer transition rounded-[1px] ${
                      yScaleMode === m ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 副图振荡指标切换（对标 TradingView 可插拔副图）：无 / MACD / RSI / KDJ */}
          {chartType === "kline" && (
            <div className="flex items-center gap-1" title="副图指标：MACD / RSI / KDJ（口径对齐通达信/同花顺）">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] select-none">副图</span>
              <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px] font-mono">
                {([["none", "无"], ["macd", "MACD"], ["rsi", "RSI"], ["kdj", "KDJ"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setSubInd(m)}
                    className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer transition rounded-[1px] ${
                      subInd === m ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 周期切换 */}
        {chartType === "kline" && !externalPeriod && (
          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[1px] font-mono">
            <button
              onClick={() => setPeriodMode("1D")}
              className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer transition rounded-[1px] ${
                periodMode === "1D" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"
              }`}
            >
              1D
            </button>
            <button
              onClick={() => setPeriodMode("1W")}
              className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer transition rounded-[1px] ${
                periodMode === "1W" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"
              }`}
            >
              1W (周K)
            </button>
            <button
              onClick={() => setPeriodMode("1M")}
              className={`px-2 py-0.5 text-[9.5px] font-semibold cursor-pointer transition rounded-[1px] ${
                periodMode === "1M" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text)]"
              }`}
            >
              1M (月K)
            </button>
          </div>
        )}
      </div>

      {/* 当前策略简介（名称 / 版本 / 介绍） */}
      {activeStrategyMeta && (
        <div className="flex items-start gap-2 text-[9.5px] font-mono text-[var(--faint)] leading-relaxed -mt-1">
          <span className="shrink-0 font-bold text-[var(--muted)]">
            {activeStrategyMeta.name} v{activeStrategyMeta.version}
          </span>
          <span className="text-[var(--faint)]">— {activeStrategyMeta.description}</span>
        </div>
      )}

      {/* 3. 动态数据详情条 Tooltip */}
      <div className="min-h-[24px] flex items-center">{renderTooltip()}</div>

      {/* 4. 主画板区域 */}
      <div className="relative">
        
        {/* 左侧走势图 */}
        <div className="w-full">
          <div className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider mb-2 flex justify-between items-center font-bold">
            <span>
              {chartType === "kline" 
                ? `[${periodMode === "1W" ? "周K线" : periodMode === "1M" ? "月K线" : "日K线"} 股价回归走势图]` 
                : "[120日 策略资产总净值模拟回测曲线]"}
            </span>
            {chartType === "kline" && (
              <div className="flex items-center gap-4 text-[9.5px] normal-case font-normal text-[var(--muted)]">
                <span className="hidden md:inline">
                  (提示：点击图表后可使用键盘 ← / → / ↑ / ↓ 缩放与切换)
                </span>
                <span className="border-l border-[var(--border)] pl-4 font-mono">
                  {hoveredChip ? (
                    <span className="text-[var(--accent)] font-semibold">
                      筹码定位: {hoveredChip.price.toFixed(2)}元 | 获利: {hoveredProfitRatio.toFixed(1)}% (占比: {(hoveredChip.ratio * 100).toFixed(1)}%)
                    </span>
                  ) : (
                    <span className="text-[var(--text)] font-semibold">
                      筹码集中度: {(activeChips.concentration * 100).toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="relative border border-[var(--border)] bg-[var(--inset)] overflow-hidden rounded-none p-1">
            {/* 纵轴单位标注 */}
            <div className="absolute left-2.5 top-1.5 z-10 text-[7.5px] font-mono text-[var(--faint)] uppercase tracking-wider scale-90 origin-top-left">
              Y轴: {chartType === "kline" ? (yScaleMode === "pct" ? "相对涨跌 (%)" : yScaleMode === "log" ? "个股股价 (元·对数)" : "个股股价 (元)") : "账户总资产净值 (元)"}
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 760 ${totalSvgHeight}`}
              className="w-full h-auto block select-none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onWheel={handleWheel}
            >
              {/* 背景网格线 */}
              {Array.from({ length: 5 }).map((_, i) => {
                const y = padding + (i / 4) * mainDrawHeight;
                const val = chartParams.yValueAt(i / 4);
                let axisLabel: string;
                if (chartType !== "kline") {
                  axisLabel = val.toLocaleString(undefined, { maximumFractionDigits: 0 });
                } else if (chartParams.yMode === "pct") {
                  const pct = (val / chartParams.yBase - 1) * 100;
                  axisLabel = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
                } else {
                  axisLabel = val.toFixed(2);
                }
                return (
                  <g key={i}>
                    <line
                      x1={padding}
                      y1={y}
                      x2={mainChartWidth - padding}
                      y2={y}
                      stroke="var(--border)"
                      strokeWidth="0.5"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={padding + 5}
                      y={y - 4}
                      fill="var(--faint)"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      {axisLabel}
                    </text>
                  </g>
                );
              })}

              {/* 回归通道阴影区与边界线 */}
              {showChannel && chartParams.channelAreaPath && (
                <path
                  d={chartParams.channelAreaPath}
                  fill={technical?.trendChannel.type === "up" ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)"}
                  stroke="none"
                />
              )}
              {showChannel && chartParams.upperChannelPath && (
                <path
                  d={chartParams.upperChannelPath}
                  fill="none"
                  stroke={technical?.trendChannel.type === "up" ? "rgba(239,68,68,0.22)" : "rgba(16,185,129,0.18)"}
                  strokeWidth="1.2"
                  strokeDasharray="2 3"
                />
              )}
              {showChannel && chartParams.lowerChannelPath && (
                <path
                  d={chartParams.lowerChannelPath}
                  fill="none"
                  stroke={technical?.trendChannel.type === "up" ? "rgba(239,68,68,0.18)" : "rgba(16,185,129,0.22)"}
                  strokeWidth="1.2"
                  strokeDasharray="2 3"
                />
              )}
              {showChannel && chartParams.midChannelPath && (
                <path
                  d={chartParams.midChannelPath}
                  fill="none"
                  stroke="var(--faint)"
                  strokeWidth="0.8"
                  strokeDasharray="1 4"
                  opacity="0.5"
                />
              )}

              {/* 历史趋势回归通道渲染 (自动拼接历史上所有的上升、下降和横盘通道) */}
              {showChannel && chartParams.type === "kline" && chartParams.histChannelPaths && (
                <g>
                  {chartParams.histChannelPaths.map((chan, cIdx) => {
                    const isUp = chan.type === "up";
                    const isDown = chan.type === "down";
                    const areaColor = isUp 
                      ? "rgba(239, 68, 68, 0.08)" 
                      : isDown 
                        ? "rgba(16, 185, 129, 0.08)" 
                        : "rgba(148, 163, 184, 0.04)";
                    const strokeColor = isUp 
                      ? "rgba(239, 68, 68, 0.18)" 
                      : isDown 
                        ? "rgba(16, 185, 129, 0.18)" 
                        : "rgba(148, 163, 184, 0.12)";
                    return (
                      <g key={`hist-chan-${cIdx}`}>
                        {chan.areaPath && <path d={chan.areaPath} fill={areaColor} stroke="none" />}
                        {chan.upperPath && <path d={chan.upperPath} fill="none" stroke={strokeColor} strokeWidth="1" strokeDasharray="1 3" />}
                        {chan.lowerPath && <path d={chan.lowerPath} fill="none" stroke={strokeColor} strokeWidth="1" strokeDasharray="1 3" />}
                        {chan.midPath && <path d={chan.midPath} fill="none" stroke="var(--faint)" strokeWidth="0.6" strokeDasharray="1 4" opacity="0.4" />}
                      </g>
                    );
                  })}
                </g>
              )}

              {/* === A. 股价 K 线渲染模式 === */}
              {chartParams.type === "kline" && (
                <g>
                  {/* 均线绘制 */}
                  {showMA5 && <path d={chartParams.ma5Path} fill="none" stroke="#fef08a" strokeWidth="1" opacity="0.8" />}
                  {showMA10 && <path d={chartParams.ma10Path} fill="none" stroke="#c084fc" strokeWidth="1" opacity="0.8" />}
                  {showMA20 && <path d={chartParams.ma20Path} fill="none" stroke="#4ade80" strokeWidth="1.2" opacity="0.85" />}
                  {showMA60 && <path d={chartParams.ma60Path} fill="none" stroke="#fb923c" strokeWidth="1.2" opacity="0.85" />}
                  {showMA120 && <path d={chartParams.ma120Path} fill="none" stroke="#c084fc" strokeWidth="1.2" opacity="0.8" style={{ stroke: "#a855f7" }} />}
                  {showMA250 && <path d={chartParams.ma250Path} fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.85" />}

                  {/* 布林带 BOLL(20,2) 叠加：中轨虚线 + 上下轨实线 */}
                  {showBoll && (
                    <g>
                      <path d={chartParams.bollUpperPath} fill="none" stroke="#38bdf8" strokeWidth="0.9" opacity="0.75" />
                      <path d={chartParams.bollMidPath} fill="none" stroke="#38bdf8" strokeWidth="0.9" opacity="0.6" strokeDasharray="3 2" />
                      <path d={chartParams.bollLowerPath} fill="none" stroke="#38bdf8" strokeWidth="0.9" opacity="0.75" />
                    </g>
                  )}

                  {/* K线蜡烛线绘制 */}
                  {chartParams.slicedCandles.map((c, idx) => {
                    const x = chartParams.getX(idx);
                    const yOpen = chartParams.getY(c.open);
                    const yClose = chartParams.getY(c.close);
                    const yHigh = chartParams.getY(c.high);
                    const yLow = chartParams.getY(c.low);

                    const isUp = c.close >= c.open;
                    const strokeColor = isUp ? "#ef4444" : "#10b981"; // 阳红阴绿
                    const fillColor = isUp ? "#ef4444" : "#10b981";
                    
                    const len = chartParams.slicedCandles.length;
                    const candleWidth = Math.max(1.5, ((mainChartWidth - 2 * padding) / len) * 0.65);

                    return (
                      <g key={`candle-${idx}`}>
                        {/* 影线 */}
                        <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={strokeColor} strokeWidth="1" />
                        {/* 实体 */}
                        <rect
                          x={x - candleWidth / 2}
                          y={Math.min(yOpen, yClose)}
                          width={candleWidth}
                          height={Math.max(1, Math.abs(yOpen - yClose))}
                          fill={fillColor}
                          stroke={strokeColor}
                          strokeWidth="0.5"
                        />
                      </g>
                    );
                  })}
                </g>
              )}

              {/* === B. 策略资产净值对比模式 === */}
              {chartParams.type === "worth" && (
                <g>
                  {/* 对照组(个股)净值线 */}
                  <path d={chartParams.stockPath} fill="none" stroke="var(--muted)" strokeWidth="1.2" opacity="0.65" />
                  {/* 策略资产净值线 */}
                  <path
                    d={chartParams.strategyPath}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="drop-shadow(0px 0px 4px rgba(16,185,129,0.15))"
                  />
                </g>
              )}

              {/* === C. 成交量副图 (Volume Chart) === */}
              {chartParams.type === "kline" && showVolumeChart && chartParams.maxVolume && (
                <g>
                  {/* 副图网格与标注 */}
                  <line
                    x1={padding}
                    y1={volumeYStart}
                    x2={mainChartWidth - padding}
                    y2={volumeYStart}
                    stroke="var(--border)"
                    strokeWidth="0.5"
                    strokeDasharray="2 3"
                  />
                  <line
                    x1={padding}
                    y1={volumeYStart + volumeDrawHeight}
                    x2={mainChartWidth - padding}
                    y2={volumeYStart + volumeDrawHeight}
                    stroke="var(--border)"
                    strokeWidth="0.5"
                  />
                  <text
                    x={padding + 5}
                    y={volumeYStart - 4}
                    fill="var(--faint)"
                    fontSize="7.5"
                    fontFamily="monospace"
                  >
                    成交量 (手)
                  </text>

                  {/* 成交量柱状图 */}
                  {chartParams.slicedCandles.map((c, idx) => {
                    const x = chartParams.getX(idx);
                    const isUp = c.close >= c.open;
                    const fillColor = isUp ? "#ef4444" : "#10b981"; // 阳红阴绿
                    
                    const h = ((c.volume || 0) / chartParams.maxVolume) * volumeDrawHeight;
                    const candleWidth = Math.max(1.5, ((mainChartWidth - 2 * padding) / chartParams.slicedCandles.length) * 0.65);
                    
                    return (
                      <rect
                        key={`vol-bar-${idx}`}
                        x={x - candleWidth / 2}
                        y={volumeYStart + volumeDrawHeight - h}
                        width={candleWidth}
                        height={Math.max(0.5, h)}
                        fill={fillColor}
                        opacity="0.65"
                      />
                    );
                  })}
                </g>
              )}

              {/* === C2. 副图振荡指标 (MACD / RSI / KDJ) === */}
              {chartParams.type === "kline" && subActive && (() => {
                const sliceStart = chartParams.sliceStart;
                const n = chartParams.slicedCandles.length;
                const top = oscYStart;
                const bot = oscYStart + oscDrawHeight;
                const candleWidth = Math.max(1.5, ((mainChartWidth - 2 * padding) / Math.max(1, n)) * 0.65);
                const visExtent = (arr: number[]): readonly [number, number] => {
                  let lo = Infinity;
                  let hi = -Infinity;
                  for (let i = 0; i < n; i++) {
                    const v = arr[sliceStart + i];
                    if (!Number.isFinite(v)) continue;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                  }
                  if (lo === Infinity) return [0, 1];
                  return [lo, hi];
                };
                const linePath = (arr: number[], lo: number, hi: number) => {
                  const span = (hi - lo) || 1;
                  const pts: string[] = [];
                  for (let i = 0; i < n; i++) {
                    const v = arr[sliceStart + i];
                    if (!Number.isFinite(v)) continue;
                    const y = bot - ((v - lo) / span) * oscDrawHeight;
                    pts.push(`${chartParams.getX(i).toFixed(1)},${y.toFixed(1)}`);
                  }
                  return pts.length ? `M ${pts.join(" L ")}` : "";
                };
                const frame = (label: string, guides: { v: number; lo: number; hi: number; text?: string }[]) => (
                  <>
                    <line x1={padding} y1={top} x2={mainChartWidth - padding} y2={top} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 3" />
                    <line x1={padding} y1={bot} x2={mainChartWidth - padding} y2={bot} stroke="var(--border)" strokeWidth="0.5" />
                    <text x={padding + 5} y={top - 4} fill="var(--faint)" fontSize="7.5" fontFamily="monospace">{label}</text>
                    {guides.map((g, gi) => {
                      const y = bot - ((g.v - g.lo) / ((g.hi - g.lo) || 1)) * oscDrawHeight;
                      return (
                        <g key={`og-${gi}`}>
                          <line x1={padding} y1={y} x2={mainChartWidth - padding} y2={y} stroke="var(--border)" strokeWidth="0.4" strokeDasharray="1 4" opacity="0.6" />
                          {g.text && <text x={mainChartWidth - padding - 2} y={y - 2} fill="var(--faint)" fontSize="6.5" fontFamily="monospace" textAnchor="end">{g.text}</text>}
                        </g>
                      );
                    })}
                  </>
                );

                if (subInd === "macd") {
                  let mx = 0;
                  for (let i = 0; i < n; i++) {
                    for (const arr of [macdData.dif, macdData.dea, macdData.macd]) {
                      const v = arr[sliceStart + i];
                      if (Number.isFinite(v) && Math.abs(v) > mx) mx = Math.abs(v);
                    }
                  }
                  mx = mx || 1;
                  const lo = -mx;
                  const hi = mx;
                  const zeroY = bot - ((0 - lo) / (hi - lo)) * oscDrawHeight;
                  return (
                    <g>
                      {frame("MACD(12,26,9)", [{ v: 0, lo, hi }])}
                      {chartParams.slicedCandles.map((_, i) => {
                        const v = macdData.macd[sliceStart + i];
                        if (!Number.isFinite(v)) return null;
                        const y = bot - ((v - lo) / (hi - lo)) * oscDrawHeight;
                        return <rect key={`macd-${i}`} x={chartParams.getX(i) - candleWidth / 2} y={Math.min(y, zeroY)} width={candleWidth} height={Math.max(0.4, Math.abs(y - zeroY))} fill={v >= 0 ? "#ef4444" : "#10b981"} opacity="0.6" />;
                      })}
                      <path d={linePath(macdData.dif, lo, hi)} fill="none" stroke="#eab308" strokeWidth="0.9" />
                      <path d={linePath(macdData.dea, lo, hi)} fill="none" stroke="#38bdf8" strokeWidth="0.9" />
                    </g>
                  );
                }
                if (subInd === "rsi") {
                  return (
                    <g>
                      {frame("RSI(14)", [{ v: 70, lo: 0, hi: 100, text: "70" }, { v: 50, lo: 0, hi: 100 }, { v: 30, lo: 0, hi: 100, text: "30" }])}
                      <path d={linePath(rsiData, 0, 100)} fill="none" stroke="#eab308" strokeWidth="0.9" />
                    </g>
                  );
                }
                const [jLo, jHi] = visExtent(kdjData.j);
                let lo = Math.min(jLo, 0);
                let hi = Math.max(jHi, 100);
                for (const arr of [kdjData.k, kdjData.d]) {
                  const [l, h] = visExtent(arr);
                  if (l < lo) lo = l;
                  if (h > hi) hi = h;
                }
                return (
                  <g>
                    {frame("KDJ(9,3,3)", [{ v: 80, lo, hi, text: "80" }, { v: 20, lo, hi, text: "20" }])}
                    <path d={linePath(kdjData.k, lo, hi)} fill="none" stroke="#eab308" strokeWidth="0.9" />
                    <path d={linePath(kdjData.d, lo, hi)} fill="none" stroke="#38bdf8" strokeWidth="0.9" />
                    <path d={linePath(kdjData.j, lo, hi)} fill="none" stroke="#ec4899" strokeWidth="0.9" />
                  </g>
                );
              })()}

              {/* === D. X轴日期时间刻度标注 === */}
              {(() => {
                const len = chartParams.type === "worth" ? chartParams.slicedHistory.length : chartParams.slicedCandles.length;
                if (len <= 5) return null;
                const indices = [0, Math.floor(len / 4), Math.floor(len / 2), Math.floor(3 * len / 4), len - 1];
                return (
                  <g>
                    {indices.map((idx) => {
                      const x = chartParams.getX(idx);
                      const date = chartParams.type === "worth" ? chartParams.slicedHistory[idx].date : chartParams.slicedCandles[idx].date;
                      return (
                        <text
                          key={`x-label-${idx}`}
                          x={x}
                          y={totalSvgHeight - 6}
                          fill="var(--faint)"
                          fontSize="7"
                          fontFamily="monospace"
                          textAnchor={idx === 0 ? "start" : idx === len - 1 ? "end" : "middle"}
                        >
                          {date}
                        </text>
                      );
                    })}
                  </g>
                );
              })()}

              {/* === K线股价未来投影与盈亏比遮罩 === */}
              {chartParams.type === "kline" && chartParams.hasProjections && quantData.projections && (() => {
                const len = chartParams.len;
                const totalLen = len + quantData.projections.length;
                const lastCandle = chartParams.slicedCandles[len - 1];
                const lastPrice = lastCandle.close;
                
                const stopLoss = technical?.actionAdvice.stopLoss || lastPrice * 0.94;
                const takeProfit = technical?.actionAdvice.takeProfit || lastPrice * 1.30;
                
                const xStart = chartParams.getX(len - 1);
                const xEnd = chartParams.getX(totalLen - 1);
                const width = xEnd - xStart;
                
                const yPrice = chartParams.getY(lastPrice);
                const ySL = chartParams.getY(stopLoss);
                const yTP = chartParams.getY(takeProfit);
                
                return (
                  <g>
                    {/* A. 盈亏比半透明遮罩背景 */}
                    <rect
                      x={xStart}
                      y={yTP}
                      width={width}
                      height={yPrice - yTP}
                      fill="rgba(16, 185, 129, 0.05)"
                      stroke="rgba(16, 185, 129, 0.12)"
                      strokeWidth="0.5"
                      strokeDasharray="2 2"
                    />
                    <rect
                      x={xStart}
                      y={yPrice}
                      width={width}
                      height={ySL - yPrice}
                      fill="rgba(239, 68, 68, 0.05)"
                      stroke="rgba(239, 68, 68, 0.12)"
                      strokeWidth="0.5"
                      strokeDasharray="2 2"
                    />
                    
                    {/* 盈亏区间水平标记线 */}
                    <line x1={xStart} y1={yTP} x2={xEnd} y2={yTP} stroke="rgba(16, 185, 129, 0.35)" strokeWidth="0.8" strokeDasharray="3 3" />
                    <line x1={xStart} y1={ySL} x2={xEnd} y2={ySL} stroke="rgba(239, 68, 68, 0.35)" strokeWidth="0.8" strokeDasharray="3 3" />
                    
                    <text x={xEnd - 5} y={yTP - 4} fill="var(--accent)" fontSize="7" textAnchor="end" fontFamily="monospace">
                      目标止盈价: {takeProfit.toFixed(2)}元
                    </text>
                    <text x={xEnd - 5} y={ySL + 8} fill="#f87171" fontSize="7" textAnchor="end" fontFamily="monospace">
                      安全止损位: {stopLoss.toFixed(2)}元
                    </text>
                    <text x={xStart + 5} y={yPrice - 4} fill="var(--faint)" fontSize="7" fontFamily="monospace">
                      基准价: {lastPrice.toFixed(2)}元
                    </text>
                    
                    {/* B. 发散漏斗色带 */}
                    {chartParams.projAreaPath && (
                      <path
                        d={chartParams.projAreaPath}
                        fill="rgba(59, 130, 246, 0.02)"
                        stroke="none"
                      />
                    )}
                    
                    {/* C. 乐观、基准、悲观折线路径 */}
                    {chartParams.projBullPath && (
                      <path
                        d={chartParams.projBullPath}
                        fill="none"
                        stroke="rgba(16, 185, 129, 0.65)"
                        strokeWidth="1.2"
                        strokeDasharray="2 2"
                      />
                    )}
                    {chartParams.projBasePath && (
                      <path
                        d={chartParams.projBasePath}
                        fill="none"
                        stroke="rgba(59, 130, 246, 0.6)"
                        strokeWidth="1.2"
                        strokeDasharray="2 2"
                      />
                    )}
                    {chartParams.projBearPath && (
                      <path
                        d={chartParams.projBearPath}
                        fill="none"
                        stroke="rgba(239, 68, 68, 0.6)"
                        strokeWidth="1.2"
                        strokeDasharray="2 2"
                      />
                    )}
                    
                    {/* D. 折线末梢终点标注与文字说明 */}
                    {(() => {
                      const lastIdx = quantData.projections!.length - 1;
                      const projLast = quantData.projections![lastIdx];
                      const xProjEnd = chartParams.getX(len + lastIdx);
                      const yBull = chartParams.getY(projLast.bull);
                      const yBase = chartParams.getY(projLast.base);
                      const yBear = chartParams.getY(projLast.bear);
                      
                      return (
                        <g>
                          <circle cx={xProjEnd} cy={yBull} r="2" fill="#10b981" />
                          <text x={xProjEnd + 4} y={yBull + 2.5} fill="#10b981" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                            乐观路径 (Bull)
                          </text>
                          
                          <circle cx={xProjEnd} cy={yBase} r="2" fill="#3b82f6" />
                          <text x={xProjEnd + 4} y={yBase + 2.5} fill="#3b82f6" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                            基准路径 (Base)
                          </text>
                          
                          <circle cx={xProjEnd} cy={yBear} r="2" fill="#ef4444" />
                          <text x={xProjEnd + 4} y={yBear + 2.5} fill="#ef4444" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                            悲观路径 (Bear)
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                );
              })()}

              {/* 共有：买卖标记点 */}
              {chartParams.tradePoints.map((t, idx) => {
                const isBuy = t.type === "buy";
                const isHovered = hoveredTrade && hoveredTrade.date === t.date && hoveredTrade.type === t.type;
                // 标记不透明度 = 本笔仓位比例（卖 1/2 → 50% 透明），角标显示分数。
                const frac = tradeFraction(t);
                const op = fractionOpacity(frac);
                const badge = fractionBadge(frac);
                return (
                  <g 
                    key={`trade-${idx}`}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredTrade(t)}
                    onMouseLeave={() => setHoveredTrade(null)}
                  >
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={isHovered ? 7 : 5}
                      fill={isBuy ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)"}
                      fillOpacity={op}
                      style={{ transition: "all 0.15s ease" }}
                    />
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r="3"
                      fill={isBuy ? "var(--accent)" : "#ef4444"}
                      fillOpacity={op}
                      stroke="var(--surface)"
                      strokeWidth="1"
                    />
                    <text
                      x={t.x}
                      y={isBuy ? t.y + 11 : t.y - 7}
                      fill={isBuy ? "var(--accent)" : "#f87171"}
                      fillOpacity={op}
                      fontSize={isHovered ? 8.5 : 7.5}
                      fontWeight="bold"
                      fontFamily="monospace"
                      textAnchor="middle"
                      style={{ transition: "all 0.15s ease" }}
                    >
                      {isBuy ? "B" : "S"}{badge}
                    </text>
                  </g>
                );
              })}

              {/* SVG 内部的毛玻璃交易提示卡片 */}
              {hoveredTrade && (() => {
                const isBuy = hoveredTrade.type === "buy";
                const width = 230;
                const height = 128;
                const x = Math.max(padding, Math.min(mainChartWidth - padding - width, hoveredTrade.x - width / 2));
                const y = Math.max(padding, hoveredTrade.y - height - 12);
                
                return (
                  <foreignObject
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    className="pointer-events-none"
                  >
                    <div 
                      className="p-2.5 rounded-[1px] text-[9px] font-mono text-white select-none border"
                      style={{
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        borderColor: isBuy ? "rgba(16, 185, 129, 0.6)" : "rgba(239, 68, 68, 0.6)",
                        boxShadow: isBuy ? "0 4px 15px rgba(16, 185, 129, 0.2)" : "0 4px 15px rgba(239, 68, 68, 0.2)",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between"
                      }}
                    >
                      <div>
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
                          <span className={`px-1 py-0.5 text-[7px] font-black rounded-[1px] uppercase tracking-wide ${
                            isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                          }`}>
                            {isBuy ? "BUY / 买入信号" : "SELL / 卖出信号"}
                          </span>
                          <span className="text-[7.5px] text-slate-500 font-semibold">{hoveredTrade.date}</span>
                        </div>
                        <div className="flex justify-between mb-1">
                          <span className="text-slate-400">成交价格：</span>
                          <span className="font-extrabold text-slate-200">{hoveredTrade.price.toFixed(2)} 元</span>
                        </div>
                        <div className="flex justify-between mb-1">
                          <span className="text-slate-400">操作仓位：</span>
                          <span className="font-extrabold text-slate-200">{positionActionLabel(hoveredTrade)}</span>
                        </div>
                        {hoveredTrade.profitPct != null && (
                          <div className="flex justify-between mb-1">
                            <span className="text-slate-400">本笔盈亏：</span>
                            <span className="font-extrabold" style={{ color: hoveredTrade.profitPct >= 0 ? "#34d399" : "#f87171" }}>
                              {hoveredTrade.profitPct >= 0 ? "+" : ""}{hoveredTrade.profitPct.toFixed(1)}%
                            </span>
                          </div>
                        )}
                        <p className="text-[8px] text-slate-300 leading-normal text-justify line-clamp-2">
                          {hoveredTrade.reason}
                        </p>
                      </div>
                    </div>
                  </foreignObject>
                );
              })()}

              {/* 共有：十字光标垂直/水平定位虚线 */}
              {hoveredIdx !== null && (
                <g>
                  {/* 垂直定位线 */}
                  <line
                    x1={activeX}
                    y1={padding}
                    x2={activeX}
                    y2={totalSvgHeight - padding}
                    stroke="var(--faint)"
                    strokeWidth="0.6"
                    strokeDasharray="2 3"
                  />
                  {/* 水平定位线 */}
                  <line
                    x1={padding}
                    y1={getCrosshairY()}
                    x2={740}
                    y2={getCrosshairY()}
                    stroke="var(--faint)"
                    strokeWidth="0.6"
                    strokeDasharray="2 3"
                  />
                  {/* 十字中心高亮圆点 */}
                  <circle cx={activeX} cy={getCrosshairY()} r="3" fill="var(--text)" />
                </g>
              )}

              {/* 联动：右侧筹码 hover 时左侧 K 线图上的水平高亮线与数值气泡 */}
              {hoveredChip !== null && chartType === "kline" && chartParams && (
                <g>
                  <line
                    x1={padding}
                    y1={chartParams.getY(hoveredChip.price)}
                    x2={740}
                    y2={chartParams.getY(hoveredChip.price)}
                    stroke="var(--accent)"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    opacity="0.85"
                  />
                  <rect
                    x={padding}
                    y={chartParams.getY(hoveredChip.price) - 7}
                    width="44"
                    height="14"
                    fill="var(--accent)"
                    rx="1"
                  />
                  <text
                    x={padding + 22}
                    y={chartParams.getY(hoveredChip.price) + 3}
                    fill="var(--accent-fg)"
                    fontSize="8"
                    fontFamily="monospace"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {hoveredChip.price.toFixed(2)}
                  </text>
                </g>
              )}

              {/* 垂直分割线，分割 K 线区与筹码分布区 */}
              {chartType === "kline" && (
                <line
                  x1={620}
                  y1={padding}
                  x2={620}
                  y2={totalSvgHeight - padding}
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
              )}

              {/* 筹码横向分布图，与主图合并对齐 */}
              {chartType === "kline" && chipParams && (
                <g transform="translate(620, 0)">
                  {/* 支撑阻力带半透明背景区 */}
                  {technical && (() => {
                    const minY = padding;
                    const maxY = padding + mainDrawHeight;
                    const yLowSupport = chartParams.getY(technical.vrvp.supportZone.low);
                    const yHighSupport = chartParams.getY(technical.vrvp.supportZone.high);
                    const yLowResistance = chartParams.getY(technical.vrvp.resistanceZone.low);
                    const yHighResistance = chartParams.getY(technical.vrvp.resistanceZone.high);

                    const supportTop = Math.max(minY, Math.min(maxY, Math.min(yLowSupport, yHighSupport)));
                    const supportBottom = Math.max(minY, Math.min(maxY, Math.max(yLowSupport, yHighSupport)));
                    const supportHeight = Math.max(0, supportBottom - supportTop);

                    const resistanceTop = Math.max(minY, Math.min(maxY, Math.min(yLowResistance, yHighResistance)));
                    const resistanceBottom = Math.max(minY, Math.min(maxY, Math.max(yLowResistance, yHighResistance)));
                    const resistanceHeight = Math.max(0, resistanceBottom - resistanceTop);
                    
                    return (
                      <g>
                        {supportHeight > 0.5 && (
                          <rect
                            x={0}
                            y={supportTop}
                            width={chipChartWidth}
                            height={supportHeight}
                            fill="rgba(16,185,129,0.06)"
                            stroke="rgba(16,185,129,0.15)"
                            strokeWidth="0.5"
                            strokeDasharray="2 2"
                          />
                        )}
                        {resistanceHeight > 0.5 && (
                          <rect
                            x={0}
                            y={resistanceTop}
                            width={chipChartWidth}
                            height={resistanceHeight}
                            fill="rgba(239,68,68,0.04)"
                            stroke="rgba(239,68,68,0.12)"
                            strokeWidth="0.5"
                            strokeDasharray="2 2"
                          />
                        )}
                      </g>
                    );
                  })()}

                  {/* 收盘价/现价指示线 (横跨 K 线与筹码图) */}
                  {(() => {
                    const y = chartParams.getY(activePrice);
                    const minY = padding;
                    const maxY = padding + mainDrawHeight;
                    if (y < minY || y > maxY) return null;

                    const isHoveredPast = hoveredIdx !== null && chartParams && chartParams.type === "kline" && hoveredIdx < chartParams.slicedCandles.length;
                    return (
                      <g>
                        <line
                          x1={-600} // 从左侧 K 线图的左边缘拉通
                          y1={y}
                          x2={chipChartWidth}
                          y2={y}
                          stroke="var(--accent)"
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                          opacity="0.8"
                        />
                        <rect
                          x={chipChartWidth - 48}
                          y={y - 6}
                          width="46"
                          height="12"
                          fill="var(--accent)"
                          rx="1"
                        />
                        <text
                          x={chipChartWidth - 25}
                          y={y + 3}
                          fill="var(--accent-fg)"
                          fontSize="7.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {isHoveredPast ? "收盘" : "现价"}:{activePrice.toFixed(2)}
                        </text>
                      </g>
                    );
                  })()}

                  {/* 筹码直方柱体 (随日期联动数据源) */}
                  {activeChips.bins.map((b, idx) => {
                    const y = chartParams.getY(b.price);
                    const minY = padding;
                    const maxY = padding + mainDrawHeight;
                    
                    if (b.price < chartParams.minWorth || b.price > chartParams.maxWorth) return null;
                    if (y < minY || y > maxY) return null;

                    const barWidth = (b.volume / chipParams.maxVol) * (chipChartWidth - 15);
                    const isProfit = b.price <= activePrice;

                    return (
                      <g
                        key={idx}
                        className="hover:opacity-85 transition-opacity cursor-crosshair"
                      >
                        <rect
                          x={0}
                          y={y - chipParams.binHeight / 2 - 1}
                          width={chipChartWidth}
                          height={chipParams.binHeight + 2}
                          fill="transparent"
                        />
                        <rect
                          x={0}
                          y={y - chipParams.binHeight / 2}
                          width={Math.max(1, barWidth)}
                          height={chipParams.binHeight}
                          fill={isProfit ? "var(--accent)" : "#3b82f6"}
                          opacity={isProfit ? "0.45" : "0.35"}
                        />
                        {idx % 8 === 0 && (
                          <text
                            x={chipChartWidth - 3}
                            y={y + 2.5}
                            fill="var(--faint)"
                            fontSize="6.5"
                            fontFamily="monospace"
                            textAnchor="end"
                          >
                            {b.price}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* POC 控制线 */}
                  {technical && (() => {
                    const y = chartParams.getY(technical.vrvp.poc);
                    const minY = padding;
                    const maxY = padding + mainDrawHeight;
                    if (y < minY || y > maxY) return null;

                    return (
                      <g>
                        <line
                          x1={0}
                          y1={y}
                          x2={chipChartWidth}
                          y2={y}
                          stroke="#f59e0b"
                          strokeWidth="1.2"
                          opacity="0.9"
                        />
                        <rect
                          x={2}
                          y={y - 5}
                          width="38"
                          height="10"
                          fill="#f59e0b"
                          opacity="0.9"
                          rx="1"
                        />
                        <text
                          x={21}
                          y={y + 2.5}
                          fill="#000"
                          fontSize="6.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          POC:{technical.vrvp.poc}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              )}
            </svg>
          </div>
          {chartType === "worth" && (
            <p className="mt-1.5 text-[8.5px] font-mono text-[var(--faint)] italic leading-relaxed select-none">
              【注】资产净值线（绿色曲线）中出现平直横盘段，代表系统策略处于空仓现金避险期（未持有仓位，不随股价涨跌而变化）；当出现 &quot;B&quot; (买入) 重新持股后，资产净值即恢复随股价波动。
            </p>
          )}
        </div>
      </div>

      {/* 5. 交易动作历史与规则展示 */}
      <div className="border-t border-[var(--border)] pt-3">
        <div className="flex gap-2 border-b border-[var(--border)] pb-2 mb-2">
          <button
            onClick={() => setActiveTab("report")}
            className={`px-3 py-1 text-xs font-semibold tracking-wider cursor-pointer ${
              activeTab === "report"
                ? "border-b-2 border-[var(--accent)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            绩效报表
          </button>
          <button
            onClick={() => setActiveTab("backtest")}
            className={`px-3 py-1 text-xs font-semibold tracking-wider cursor-pointer ${
              activeTab === "backtest"
                ? "border-b-2 border-[var(--accent)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            策略回测规则与优化建议
          </button>
          <button
            onClick={() => setActiveTab("trades")}
            className={`px-3 py-1 text-xs font-semibold tracking-wider cursor-pointer ${
              activeTab === "trades"
                ? "border-b-2 border-[var(--accent)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            模拟交易历史明细 ({trades.length} 笔)
          </button>
        </div>

        {activeTab === "report" ? (
          <BacktestReport report={perfReport} history={history} />
        ) : activeTab === "backtest" ? (
          <div className="text-[11px] leading-relaxed text-[var(--muted)] grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
            <div className="border border-[var(--border)] p-2.5 bg-[var(--inset)]">
              <span className="text-[9px] uppercase tracking-wider text-[var(--accent)] font-bold block mb-1">
                【当前策略 · {activeStrategyMeta ? `${activeStrategyMeta.name} v${activeStrategyMeta.version}` : "默认策略"}】
              </span>
              <p className="max-h-[120px] overflow-y-auto pr-1 text-justify">
                {activeStrategyMeta?.description ?? "该策略的买卖规则由所选策略定义；下拉切换策略可查看各自的进出场逻辑。"}
              </p>
            </div>
            <div className="border border-[var(--border)] p-2.5 bg-[var(--inset)]">
              <span className="text-[9px] uppercase tracking-wider text-red-500 font-bold block mb-1">【标记图例 · 怎么读 B/S】</span>
              <p>• <b className="text-[var(--accent)]">B</b> 绿点=买入，<b className="text-red-400">S</b> 红点=卖出。</p>
              <p>• <b>点的透明度 = 本笔仓位比例</b>：满仓动作=实心，卖 1/2≈半透明(½)，卖 1/3≈更淡(⅓)。</p>
              <p>• 一个 B 常对应多个 S：分批止盈（+8% 减⅓ → +25% 再减 → 跟踪/支撑清仓），故 S 比 B 多。</p>
              <p>• 悬浮任意标记或下方「交易明细」可见「操作仓位 + 本笔盈亏 + 触发理由」。</p>
            </div>
            <div className="border border-[var(--border)] p-2.5 bg-[var(--inset)] border-l-[3px] border-l-[var(--accent)]">
              <span className="text-[9px] uppercase tracking-wider text-[var(--accent)] font-bold block mb-1">【AI 交易优化建议】</span>
              <p>鉴于当前获利筹码比例为 {(chips.profitRatio * 100).toFixed(0)}%，若开启实盘，建议在筹码主峰支撑位（约 {chips.avgCost} 元）上方 3%-5% 设置买入安全垫；若主力筹码发生高位松动，应果断执行仓位核减。</p>
            </div>
          </div>
        ) : (
          <div className="max-h-[140px] overflow-y-auto text-[10px] font-mono divide-y divide-[var(--border)] border border-[var(--border)]">
            {trades.length === 0 ? (
              <div className="py-4 text-center text-[var(--faint)]">回测时间区间内未触发任何策略交易。</div>
            ) : (
              [...trades].reverse().map((t, idx) => {
                const isBuy = t.type === "buy";
                return (
                  <div key={idx} className="flex justify-between items-center gap-2 py-2 px-3 hover:bg-[var(--hover)]">
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-1 py-0.5 text-[8px] font-bold rounded-[1px] uppercase ${isBuy ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-red-500/10 text-red-400"}`}>
                        {isBuy ? "BUY" : "SELL"}
                      </span>
                      <span className="text-[var(--text)] font-semibold">{t.date}</span>
                      <span className="px-1 py-0.5 text-[8px] rounded-[1px] bg-[var(--inset)] text-[var(--muted)] whitespace-nowrap">
                        {positionActionLabel(t)}
                      </span>
                    </div>
                    <span className="text-[var(--muted)] flex-1 px-2 truncate text-left" title={t.reason}>
                      {t.reason}
                    </span>
                    {t.profitPct != null && (
                      <span className="font-bold text-right shrink-0 w-[52px]" style={{ color: t.profitPct >= 0 ? "#10b981" : "#ef4444" }}>
                        {t.profitPct >= 0 ? "+" : ""}{t.profitPct.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-[var(--text)] font-bold text-right pl-2 shrink-0">
                      {t.price.toFixed(2)} 元
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
