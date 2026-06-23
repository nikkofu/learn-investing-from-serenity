"use client";

import { useMemo } from "react";
import type { PerformanceReport } from "@/lib/performance";
import { DEFAULT_COST_MODEL, roundTripCostPct } from "@/lib/costs";

interface BacktestReportProps {
  report: PerformanceReport;
  history: { date: string; strategyWorth: number; stockWorth: number }[];
}

const RED = "#ef4444"; // 涨/正（A股口径）
const GREEN = "#10b981"; // 跌/负

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtNum(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : "∞";
}

/** 单个指标卡。 */
function Metric({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--inset)] p-2 rounded-none" title={hint}>
      <span className="text-[8.5px] uppercase tracking-wider text-[var(--faint)] block mb-0.5">{label}</span>
      <span className="font-mono text-[13px] font-bold" style={{ color: color ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

export default function BacktestReport({ report, history }: BacktestReportProps) {
  const W = 600;
  const padL = 30;
  const padR = 8;
  const eqTop = 8;
  const eqH = 120;
  const ddTop = 8;
  const ddH = 64;

  const curves = useMemo(() => {
    const n = history.length;
    if (n < 2) return null;
    const first = history[0].strategyWorth || 1;
    const stockFirst = history[0].stockWorth || 1;
    const stratNorm = history.map((h) => h.strategyWorth / first);
    const stockNorm = history.map((h) => h.stockWorth / stockFirst);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of [...stratNorm, ...stockNorm]) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const xAt = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
    const eqYAt = (v: number) => eqTop + (1 - (v - lo) / span) * eqH;
    const line = (arr: number[], yAt: (v: number) => number) =>
      `M ${arr.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" L ")}`;

    const dd = report.drawdownSeries.length === n ? report.drawdownSeries : history.map(() => 0);
    let ddMin = 0;
    for (const d of dd) if (d < ddMin) ddMin = d;
    const ddSpan = -ddMin || 1;
    const ddYAt = (d: number) => ddTop + ((0 - d) / ddSpan) * ddH;
    const ddArea =
      `M ${xAt(0).toFixed(1)},${ddYAt(0).toFixed(1)} ` +
      dd.map((d, i) => `L ${xAt(i).toFixed(1)},${ddYAt(d).toFixed(1)}`).join(" ") +
      ` L ${xAt(n - 1).toFixed(1)},${ddYAt(0).toFixed(1)} Z`;

    // 起点为 1.0 的水平基准线（看策略相对盈亏）
    const baseY = eqYAt(1);
    return {
      stratPath: line(stratNorm, eqYAt),
      stockPath: line(stockNorm, eqYAt),
      ddArea,
      baseY,
      lo,
      hi,
      ddMin,
      firstDate: history[0].date,
      lastDate: history[n - 1].date,
    };
  }, [history, report.drawdownSeries]);

  return (
    <div className="space-y-3">
      {/* 标准化绩效指标 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Metric label="策略累计" value={fmtPct(report.totalReturn)} color={report.totalReturn >= 0 ? RED : GREEN} hint="区间内策略净值累计收益" />
        <Metric label="同期个股" value={fmtPct(report.stockTotalReturn)} color={report.stockTotalReturn >= 0 ? RED : GREEN} hint="同期买入持有个股收益" />
        <Metric label="年化收益" value={fmtPct(report.annReturn)} color={report.annReturn >= 0 ? RED : GREEN} hint="按 252 交易日复合年化" />
        <Metric label="年化波动" value={fmtPct(report.annVol)} hint="日收益标准差年化" />
        <Metric label="Sharpe" value={fmtNum(report.sharpe)} color={report.sharpe >= 1 ? RED : "var(--text)"} hint="年化夏普（无风险利率取 0）" />
        <Metric label="Sortino" value={fmtNum(report.sortino)} color={report.sortino >= 1 ? RED : "var(--text)"} hint="年化索提诺（仅下行波动）" />
        <Metric label="Calmar" value={fmtNum(report.calmar)} hint="年化收益 / |最大回撤|" />
        <Metric label="最大回撤" value={fmtPct(report.maxDrawdown)} color={GREEN} hint={report.maxDdPeakDate ? `${report.maxDdPeakDate} → ${report.maxDdTroughDate}` : "净值峰值到谷底的最大跌幅"} />
        <Metric label="盈亏比 PF" value={fmtNum(report.profitFactor)} color={report.profitFactor >= 1 ? RED : GREEN} hint="毛盈 / 毛亏（Profit Factor）" />
        <Metric label="平仓胜率" value={`${report.winRate.toFixed(1)}%`} hint={`平仓 ${report.roundTrips} 笔`} />
        <Metric label="盈亏比(均)" value={fmtNum(report.payoff)} hint={`平均盈利 ${fmtPct(report.avgWin)} / 平均亏损 ${fmtPct(report.avgLoss)}`} />
        <Metric label="最大连亏" value={`${report.maxConsecLoss} 笔`} color={report.maxConsecLoss >= 4 ? GREEN : "var(--text)"} hint="最长连续亏损平仓笔数" />
        <Metric label="平均持仓" value={`${report.avgHoldingDays.toFixed(1)} 天`} hint="FIFO 配对买卖的平均持仓天数（近似）" />
        <Metric label="持仓占比" value={`${report.exposure.toFixed(1)}%`} hint="净值发生变化的交易日占比（空仓现金期不计，近似）" />
        <Metric label="交易日" value={`${report.tradingDays}`} hint={`约 ${report.years} 年`} />
        <Metric label="平仓笔数" value={`${report.roundTrips}`} hint="有盈亏记录的卖出次数" />
      </div>

      {/* 权益曲线 + 回撤曲线 */}
      {curves && (
        <div className="border border-[var(--border)] bg-[var(--inset)] p-2 rounded-none">
          <div className="flex items-center gap-3 text-[9px] font-mono text-[var(--faint)] mb-1">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: "var(--accent)" }} />策略权益</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: "var(--muted)" }} />买入持有</span>
            <span className="ml-auto">{curves.firstDate} → {curves.lastDate}（起点归一为 1.0）</span>
          </div>
          <svg viewBox={`0 0 ${W} ${eqTop + eqH + 14}`} className="w-full" preserveAspectRatio="none">
            <line x1={padL} y1={curves.baseY} x2={W - padR} y2={curves.baseY} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
            <text x={2} y={eqTop + 6} fill="var(--faint)" fontSize="7" fontFamily="monospace">{curves.hi.toFixed(2)}</text>
            <text x={2} y={eqTop + eqH} fill="var(--faint)" fontSize="7" fontFamily="monospace">{curves.lo.toFixed(2)}</text>
            <path d={curves.stockPath} fill="none" stroke="var(--muted)" strokeWidth="1" opacity="0.7" />
            <path d={curves.stratPath} fill="none" stroke="var(--accent)" strokeWidth="1.3" />
          </svg>

          <div className="text-[9px] font-mono text-[var(--faint)] mt-1.5 mb-0.5" title="佣金万2.5、1笔最低5元；印花税0.05%(卖)；过户费0.001%(双边)；滑点0.05%(单边)。">⚡ 回测已计入交易成本（佣金+印花税+过户费+滑点，往返约 {roundTripCostPct(DEFAULT_COST_MODEL).toFixed(2)}%）。</div>
          <div className="text-[9px] font-mono text-[var(--faint)] mt-1 mb-0.5">回撤曲线（水下图，最大 {fmtPct(report.maxDrawdown)}）</div>
          <svg viewBox={`0 0 ${W} ${ddTop + ddH + 4}`} className="w-full" preserveAspectRatio="none">
            <path d={curves.ddArea} fill={GREEN} fillOpacity="0.18" stroke={GREEN} strokeWidth="0.8" />
            <text x={2} y={ddTop + 6} fill="var(--faint)" fontSize="7" fontFamily="monospace">0%</text>
            <text x={2} y={ddTop + ddH} fill="var(--faint)" fontSize="7" fontFamily="monospace">{curves.ddMin.toFixed(0)}%</text>
          </svg>
        </div>
      )}
    </div>
  );
}
