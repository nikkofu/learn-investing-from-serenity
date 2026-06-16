"use client";

import { useMemo } from "react";
import type { TechnicalAssessment } from "@/lib/quant";

interface TechnicalAnalysisPanelProps {
  technical: TechnicalAssessment;
  currentPrice: number;
}

export default function TechnicalAnalysisPanel({ technical, currentPrice }: TechnicalAnalysisPanelProps) {
  const { trendChannel, patterns, candlesticks, vrvp, actionAdvice } = technical;

  // 5日未来走势投影与策略应对推演
  const projection = useMemo(() => {
    if (!trendChannel) return null;
    const { slope, midLine, upperLine, lowerLine } = trendChannel;
    
    // 未来 5 天后回归通道中心位置
    const midProj = Number((midLine + slope * 5).toFixed(2));
    const upperDiff = upperLine - midLine;
    const lowerDiff = midLine - lowerLine;
    
    const maxProj = Number((midProj + upperDiff).toFixed(2));
    const minProj = Number((midProj - lowerDiff).toFixed(2));
    
    let text = "";
    if (trendChannel.status === "breakout") {
      text = `个股当前成功向上突破回归通道上轨（斜率: ${(slope * 100).toFixed(2)}%），打开了强势上升空间。预计未来 5 日股价将在突破点之上蓄势震荡，上行阻力指向上轨投影约 ${maxProj} 元，中轴支撑移至 ${midProj} 元附近。操作策略上建议继续持股守候，短线止损保护可置于 ${minProj} 元处以防假突破。`;
    } else if (trendChannel.status === "breakdown") {
      text = `个股日前向下跌破回归通道下轨支撑，下行趋势加速。未来 5 日内股价预计将在下轨投影 [${minProj} 元, ${maxProj} 元] 区间内低位寻底，若跌破 ${minProj} 元则会加速向下方筹码支撑位倾泻。在价格重新收复中轴轨道 ${midProj} 元前，建议保持克制，逢反弹逢高减仓防守。`;
    } else if (trendChannel.type === "up") {
      text = `当前处于稳健的上升通道中，价格沿中轴向上延伸。未来 5 日价格预计在通道偏置区间 [${minProj} 元, ${maxProj} 元] 保持震荡上行。操作上建议维持中线持股，若股价回踩至中轨 ${midProj} 元附近获得筹码支撑是理想的增仓机会；切忌在逼近上轨阻力 ${maxProj} 元时盲目追涨。`;
    } else if (trendChannel.type === "down") {
      text = `当前价格受到典型的下降通道上轨压制。未来 5 日股价预计在下轨投影 [${minProj} 元, ${maxProj} 元] 弱势探底。由于下行趋势未改，短线极易受阻，建议分批在通道上轨阻力位 ${maxProj} 元上方逢高减仓；在日K线放量站上中轨生命线 ${midProj} 元前，不宜过度重仓。`;
    } else {
      text = `股价当前在 [${minProj} 元, ${maxProj} 元] 区间内无明显方向性震荡。目前筹码密集区 POC 为 ${vrvp.poc} 元，若无量能或重大利好配合，预计未来 5 日继续在此区间拉锯。适合在下方支撑位 ${minProj} 元上方吸纳，阻力位 ${maxProj} 元附近落袋，轻仓参与。`;
    }
    
    return { minProj, maxProj, midProj, text };
  }, [trendChannel, vrvp.poc]);

  // 辅助样式和文字判定
  const channelTypeLabels = {
    up: { text: "上升通道 (Upward Channel)", color: "text-red-500 border-red-500/20 bg-red-500/5" },
    down: { text: "下降通道 (Downward Channel)", color: "text-emerald-500 border-emerald-500/20 bg-emerald-500/5" },
    range: { text: "区间横盘 (Horizontal Range)", color: "text-[var(--muted)] border-[var(--border)] bg-[var(--hover)]" },
  };

  const channelStatusLabels = {
    inside: { text: "通道内运行 (Inside Channel)", color: "text-[var(--text)]" },
    breakout: { text: "突破上轨 (Bullish Breakout) ⚡", color: "text-amber-400 font-bold border-amber-500/40 bg-amber-500/10 animate-pulse" },
    breakdown: { text: "破位下轨 (Bearish Breakdown) ⚠️", color: "text-red-400 font-bold border-red-500/40 bg-red-500/10 animate-pulse" },
  };

  const channelLabel = channelTypeLabels[trendChannel.type] || channelTypeLabels.range;
  const statusLabel = channelStatusLabels[trendChannel.status] || channelStatusLabels.inside;

  // 核心操作行动色
  let actionColor = "text-[var(--text)] border-[var(--border)]";
  if (actionAdvice.action.includes("突破") || actionAdvice.action.includes("吸纳") || actionAdvice.action.includes("买入")) {
    actionColor = "text-amber-400 border-amber-500/30 bg-amber-500/5";
  } else if (actionAdvice.action.includes("防守") || actionAdvice.action.includes("减仓") || actionAdvice.action.includes("卖出")) {
    actionColor = "text-red-400 border-red-500/30 bg-red-500/5";
  } else if (actionAdvice.action.includes("止盈") || actionAdvice.action.includes("遇阻")) {
    actionColor = "text-emerald-400 border-emerald-500/30 bg-emerald-500/5";
  }

  return (
    <div className="rounded-[2px] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-5">
      {/* 标题 */}
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
        <h3 className="font-bold tracking-wider flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-ping shrink-0" />
          Serenity 技术形态与阻力支撑诊断
        </h3>
        <span className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider">
          [TECHNICAL PATTERN & VRVP ANALYSIS ENGINE]
        </span>
      </div>

      {/* 三栏布局 */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* 1. 趋势与通道拟合 */}
        <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-none space-y-3 flex flex-col justify-between">
          <div>
            <h4 className="text-[10px] font-mono font-bold text-[var(--faint)] uppercase tracking-wider mb-2 border-b border-[var(--border)] pb-1">
              ① 趋势通道拟合 (60D Regression)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--muted)]">通道走向:</span>
                <span className={`px-2 py-0.5 rounded-[1px] border text-[10px] font-semibold ${channelLabel.color}`}>
                  {channelLabel.text}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--muted)]">突破状态:</span>
                <span className={`px-2 py-0.5 rounded-[1px] border text-[10px] ${statusLabel.color}`}>
                  {statusLabel.text}
                </span>
              </div>
            </div>
          </div>
          
          <div className="border-t border-[var(--border)] pt-2 mt-2 space-y-1 text-[11px] font-mono">
            <div className="flex justify-between text-[var(--faint)]">
              <span>上轨阻力:</span>
              <span className="font-semibold text-[var(--text)]">{trendChannel.upperLine} 元</span>
            </div>
            <div className="flex justify-between text-[var(--faint)]">
              <span>中轴轨道:</span>
              <span className="font-semibold text-[var(--text)]">{trendChannel.midLine} 元</span>
            </div>
            <div className="flex justify-between text-[var(--faint)]">
              <span>下轨支撑:</span>
              <span className="font-semibold text-[var(--text)]">{trendChannel.lowerLine} 元</span>
            </div>
          </div>
        </div>

        {/* 2. 筹码支撑与阻力带 (VRVP) */}
        <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-none space-y-3 flex flex-col justify-between">
          <div>
            <h4 className="text-[10px] font-mono font-bold text-[var(--faint)] uppercase tracking-wider mb-2 border-b border-[var(--border)] pb-1">
              ② 筹码密集支撑阻力 (VRVP Nodes)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-start text-xs">
                <span className="text-[var(--muted)] shrink-0">上方核心阻力:</span>
                <div className="text-right">
                  <span className="font-semibold text-[var(--text)] font-mono">{vrvp.resistanceZone.price} 元</span>
                  <span className="text-[9px] text-[var(--faint)] block">区: {vrvp.resistanceZone.low}-{vrvp.resistanceZone.high}</span>
                </div>
              </div>
              <div className="flex justify-between items-start text-xs border-t border-[var(--border)] pt-1.5">
                <span className="text-[var(--muted)] shrink-0">下方核心支撑:</span>
                <div className="text-right">
                  <span className="font-semibold text-emerald-400 font-mono">{vrvp.supportZone.price} 元</span>
                  <span className="text-[9px] text-[var(--faint)] block">区: {vrvp.supportZone.low}-{vrvp.supportZone.high}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-2 mt-2 space-y-1 text-[11px] font-mono">
            <div className="flex justify-between text-[var(--faint)]">
              <span>筹码控制线(POC):</span>
              <span className="font-bold text-amber-500">{vrvp.poc} 元</span>
            </div>
            {vrvp.lvnPrice && (
              <div className="flex justify-between text-[var(--faint)] mt-1 animate-pulse">
                <span>筹码真空带(LVN):</span>
                <span className="text-sky-400 font-semibold" title="筹码极度稀少价格带，一旦穿透价格极易加速">约 {vrvp.lvnPrice} 元 ⚡</span>
              </div>
            )}
          </div>
        </div>

        {/* 3. 形态模式匹配 */}
        <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-none space-y-2 flex flex-col justify-between">
          <div>
            <h4 className="text-[10px] font-mono font-bold text-[var(--faint)] uppercase tracking-wider mb-2 border-b border-[var(--border)] pb-1">
              ③ 技术形态匹配 (Patterns)
            </h4>
            
            {/* 标签列表 */}
            <div className="flex flex-wrap gap-1.5 min-h-[50px] content-start">
              {patterns.map((p, idx) => (
                <span key={`pat-${idx}`} className="rounded-[1px] border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10px] text-amber-400 font-semibold">
                  {p}
                </span>
              ))}
              {candlesticks.map((c, idx) => (
                <span
                  key={`cand-${idx}`}
                  className={`rounded-[1px] border px-2 py-0.5 text-[10px] font-semibold ${
                    c.type === "bullish" 
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" 
                      : "border-red-500/20 bg-red-500/5 text-red-400"
                  }`}
                  title={`${c.date} 出现`}
                >
                  {c.pattern}
                </span>
              ))}
              {patterns.length === 0 && candlesticks.length === 0 && (
                <span className="text-xs text-[var(--faint)] italic">未检测到极端反转或筑底形态</span>
              )}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)] leading-relaxed text-justify">
            形态与K线来自近 5 日数据，W底与老鸭头基于更长周期趋势演变，仅作形态指示。
          </div>
        </div>
      </div>

      {/* 底部交易决策区 */}
      <div className={`border border-[var(--border)] bg-[var(--inset)] p-4 rounded-[2px] grid gap-4 md:grid-cols-4 items-center ${actionColor}`}>
        <div className="md:col-span-2 space-y-1">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] block">
            【当前核心操作行动建议】
          </span>
          <div className="text-base font-bold flex items-center gap-2">
            <span>{actionAdvice.action}</span>
            <span className="text-xs font-normal border border-current/20 px-2 py-0.5 rounded-[1px] scale-95">
              {actionAdvice.positionAdvice}
            </span>
          </div>
        </div>
        
        <div className="border-t border-[var(--border)] pt-3 md:pt-0 md:border-t-0 md:border-l border-[var(--border)] md:pl-4 space-y-0.5">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] block">
            建议止损防守位
          </span>
          <span className="font-mono text-base font-bold text-red-400 block">
            {actionAdvice.stopLoss} 元
          </span>
          <span className="text-[9px] text-[var(--faint)] block">
            跌破该价位建议主动防守
          </span>
        </div>

        <div className="border-t border-[var(--border)] pt-3 md:pt-0 md:border-t-0 md:border-l border-[var(--border)] md:pl-4 space-y-0.5">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)] block">
            建议止盈目标位
          </span>
          <span className="font-mono text-base font-bold text-emerald-400 block">
            {actionAdvice.takeProfit} 元
          </span>
          <span className="text-[9px] text-[var(--faint)] block">
            到达此阻力密集区注意分仓落袋
          </span>
        </div>
      </div>

      {/* 未来 5 日走势投影与操作推演卡片 */}
      {projection && (
        <div className="border border-[var(--border)] bg-[var(--inset)] p-4 rounded-[2px] space-y-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-amber-500 font-bold block">
            【Serenity 未来 5 日价格走向投影与操作推演 (5-Day Projection)】
          </span>
          <div className="grid gap-4 md:grid-cols-4 items-center">
            <div className="md:col-span-3 text-xs leading-relaxed text-[var(--muted)] text-justify font-sans">
              {projection.text}
            </div>
            <div className="border-t border-[var(--border)] pt-3 md:pt-0 md:border-t-0 md:border-l border-[var(--border)] md:pl-4 space-y-1 font-mono text-right">
              <div className="text-[9px] text-[var(--faint)]">5日通道上轨(预期上限):</div>
              <div className="text-sm font-bold text-[var(--text)]">{projection.maxProj} 元</div>
              <div className="text-[9px] text-[var(--faint)] border-t border-[var(--border)] pt-1 mt-1">5日通道下轨(预期下限):</div>
              <div className="text-sm font-bold text-[var(--text)]">{projection.minProj} 元</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
