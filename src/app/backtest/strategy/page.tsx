"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface StrategyMeta {
  id: string;
  name: string;
  version: string;
  description: string;
}

interface ClosedTrade {
  code: string;
  name: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  returnPct: number;
  holdDays: number;
  exitReason: string;
  atrPctAtEntry: number;
}
interface SymbolTradeStats {
  code: string;
  name: string;
  trades: number;
  wins: number;
  winRatePct: number;
  avgReturnPct: number;
  buyHoldPct: number;
}
interface CI {
  point: number;
  lo: number;
  hi: number;
}
interface RiskMetrics {
  sharpe: number;
  sharpeAnnualized: number;
  sortino: number;
  calmarRatio: number;
  maxDrawdownPct: number;
  cagrPct: number;
}
interface VolTargeted {
  targetVolPct: number;
  avgLeverage: number;
  avgReturnPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
}
interface CVFold {
  index: number;
  startDate: string;
  endDate: string;
  trades: number;
  winRatePct: number;
  avgReturnPct: number;
}
interface CrossValidation {
  folds: number;
  usedFolds: number;
  embargoDays: number;
  purgedTrades: number;
  foldStats: CVFold[];
  meanWinRatePct: number;
  stdWinRatePct: number;
  worstFoldWinRatePct: number;
  worstFoldAvgReturnPct: number;
  positiveFolds: number;
  holdsOutOfSample: boolean;
}
interface Stats {
  symbols: number;
  totalTrades: number;
  wins: number;
  winRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  profitFactor: number;
  avgHoldDays: number;
  matchedHorizon: number;
  matchedBaselineWinRatePct: number;
  matchedBaselineAvgReturnPct: number;
  buyHoldAvgReturnPct: number;
  edgePct: number;
  zVsCoin: number;
  pVsCoin: number;
  risk: RiskMetrics;
  tradesPerYear: number;
  avgReturnCI: CI;
  winRateCI: CI;
  psr: number;
  dsr: number;
  dsrExpectedMaxSharpe: number;
  numTrials: number;
  bonferroniAlpha: number;
  significantAfterCorrection: boolean;
  avgAtrPctAtEntry: number;
  volTargeted: VolTargeted;
  crossValidation: CrossValidation;
  verdict: string;
}
interface Result {
  config: { feeBps: number; takeProfitPct: number; warmupBars: number; matchedHorizon: number; strategyId: string; poolChokepointScore: number };
  strategy?: { id: string; name: string; version: string };
  perSymbol: SymbolTradeStats[];
  trades: ClosedTrade[];
  stats: Stats;
}

/** 内置「均线放量」简化口径的伪 id（不传 strategyId）。 */
const BUILTIN_SIMPLE = "__builtin_simple__";

const PRESET =
  "600519,000858,300750,600036,000333,002594,601318,600276,000651,002415,300059,600887,000001,002475,600009";

function signClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}
function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function StatCard({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${cls ?? "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

/** 结论横幅：依显著性着色（绿=有据/琥珀=高胜率但无超额/红=不显著或样本不足）。 */
function VerdictBanner({ s }: { s: Stats }) {
  // 绿色仅当：经多重检验校正后仍显著、且择时超额为正——避免被"撞出"的假显著误导。
  const robustSignificant = s.totalTrades >= 30 && s.significantAfterCorrection;
  const rawSignificant = s.totalTrades >= 30 && s.zVsCoin > 1.96;
  const tone =
    s.totalTrades < 30
      ? "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]"
      : robustSignificant && s.edgePct > 0
        ? "border-emerald-500/40 bg-emerald-500/10 text-[var(--text)]"
        : rawSignificant
          ? "border-amber-500/40 bg-amber-500/10 text-[var(--text)]"
          : "border-red-500/40 bg-red-500/10 text-[var(--text)]";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        结论 · 是否能证明「照建议买卖有较大胜率」
      </div>
      <p className="text-sm leading-6">{s.verdict}</p>
    </div>
  );
}

export default function StrategyBacktestPage() {
  const [codesText, setCodesText] = useState(PRESET);
  const [feeBps, setFeeBps] = useState(30);
  const [takeProfitPct, setTakeProfitPct] = useState(35);
  const [warmupBars, setWarmupBars] = useState(30);
  const [limit, setLimit] = useState(500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [strategyId, setStrategyId] = useState<string>("");

  // 拉取已登记策略列表，默认选中默认策略（当前为 v6）。
  useEffect(() => {
    let alive = true;
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((j: { defaultStrategyId?: string; strategies?: StrategyMeta[] }) => {
        if (!alive) return;
        setStrategies(j.strategies ?? []);
        if (j.defaultStrategyId) setStrategyId(j.defaultStrategyId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.id === strategyId),
    [strategies, strategyId],
  );

  const codes = useMemo(
    () =>
      Array.from(
        new Set(
          codesText
            .split(/[\s,，、]+/)
            .map((c) => c.trim())
            .filter((c) => /^\d{6}$/.test(c)),
        ),
      ),
    [codesText],
  );

  async function run() {
    if (codes.length === 0) {
      setError("请输入至少 1 个 6 位股票代码");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/backtest/recommendation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          codes,
          feeBps,
          takeProfitPct: takeProfitPct / 100,
          warmupBars,
          limit,
          strategyId: strategyId === BUILTIN_SIMPLE ? "" : strategyId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setResult(json as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="mb-2 flex gap-2 text-xs">
          <Link href="/backtest" className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-[var(--text)]">
            组合回测
          </Link>
          <span className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent)]">
            建议忠实回测
          </span>
        </div>
        <h1 className="text-xl font-semibold text-[var(--text)]">建议忠实回测 · 胜率证明</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          选定一个策略，在股票池上逐只独立重放它与个股看盘页**完全同一套**的买卖规则，信号**只用当日之前数据**（无未来函数），含 A 股涨跌停撮合（涨停买不进、跌停卖不出顺延）与双边手续费。把所有完成交易**汇总**，对比「同持有期买入持有」基线并做 z 检验，诚实回答「照该策略买卖到底有没有较大胜率」。池内不带逐股基本面分（给中性瓶颈点分），故不触发依赖高基本面分的「强势起爆」信号。仅供研究，不构成投资建议。
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">股票池（6 位代码，逗号/空格/换行分隔）· 已识别 {codes.length} 只（样本越大越有统计意义）</span>
          <textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            rows={3}
            className={`${inputCls} font-mono`}
            placeholder="600519,000858,300750 ..."
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">回测策略（与个股看盘页同一套买卖规则，忠实重放 + 涨跌停撮合 + 手续费）</span>
          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className={inputCls}
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} v{s.version}
              </option>
            ))}
            <option value={BUILTIN_SIMPLE}>内置·均线放量突破（简化对照口径）</option>
          </select>
          {selectedStrategy && (
            <span className="mt-0.5 text-[var(--faint)] leading-4">{selectedStrategy.description}</span>
          )}
          {strategyId === BUILTIN_SIMPLE && (
            <span className="mt-0.5 text-[var(--faint)] leading-4">均线金叉/VCP 平台突破入场，跌破筹码支撑 / +N% 止盈 / 高位天量离场（固定止盈受下方「止盈目标」控制）。</span>
          )}
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单边手续费（bps）</span>
            <input type="number" min={0} max={200} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">止盈目标（%）</span>
            <input type="number" min={5} max={200} value={takeProfitPct} onChange={(e) => setTakeProfitPct(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">预热根数（不计交易）</span>
            <input type="number" min={20} max={120} value={warmupBars} onChange={(e) => setWarmupBars(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">单只取 K 根数</span>
            <input type="number" min={120} max={800} step={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "回测中…" : "运行回测"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <VerdictBanner s={result.stats} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="完成交易" value={`${result.stats.totalTrades} 笔`} />
            <StatCard label="胜率" value={`${result.stats.winRatePct.toFixed(1)}%`} cls={result.stats.winRatePct >= 50 ? "text-rose-500" : "text-emerald-500"} />
            <StatCard label="每笔均值(净)" value={fmtPct(result.stats.avgReturnPct)} cls={signClass(result.stats.avgReturnPct)} />
            <StatCard label="中位收益" value={fmtPct(result.stats.medianReturnPct)} cls={signClass(result.stats.medianReturnPct)} />
            <StatCard label="盈亏比" value={Number.isFinite(result.stats.profitFactor) ? result.stats.profitFactor.toFixed(2) : "∞"} />
            <StatCard label="平均持有" value={`${result.stats.avgHoldDays.toFixed(0)} 日`} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">对比基准与显著性</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label={`基线胜率(持有${result.stats.matchedHorizon}日)`} value={`${result.stats.matchedBaselineWinRatePct.toFixed(1)}%`} />
              <StatCard label="基线每笔均值" value={fmtPct(result.stats.matchedBaselineAvgReturnPct)} cls={signClass(result.stats.matchedBaselineAvgReturnPct)} />
              <StatCard label="全程买入持有(均)" value={fmtPct(result.stats.buyHoldAvgReturnPct)} cls={signClass(result.stats.buyHoldAvgReturnPct)} />
              <StatCard label="择时超额(edge)" value={`${result.stats.edgePct > 0 ? "+" : ""}${result.stats.edgePct.toFixed(2)}pp`} cls={signClass(result.stats.edgePct)} />
              <StatCard label="z / p (vs 50%)" value={`${result.stats.zVsCoin.toFixed(2)} / ${result.stats.pVsCoin}`} />
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--faint)]">
              「基线」= 在同一批票、warmup 后的每个交易日入场并持有 {result.stats.matchedHorizon} 日的随机入场基准；策略每笔均值减去基线均值即「择时超额」。胜率 z 检验对照掷硬币 50%。样本（完成交易）≥30 且 z&gt;1.96 才有统计意义。
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">风险调整与稳健性（借鉴顶级量化机构口径）</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Sharpe(逐笔)" value={result.stats.risk.sharpe.toFixed(2)} cls={result.stats.risk.sharpe > 0 ? "text-rose-500" : "text-emerald-500"} />
              <StatCard label="Sharpe(年化)" value={result.stats.risk.sharpeAnnualized.toFixed(2)} />
              <StatCard label="Sortino" value={result.stats.risk.sortino.toFixed(2)} />
              <StatCard label="Calmar" value={result.stats.risk.calmarRatio.toFixed(2)} />
              <StatCard label="最大回撤" value={`-${result.stats.risk.maxDrawdownPct.toFixed(1)}%`} cls="text-emerald-500" />
              <StatCard label="CAGR(近似)" value={fmtPct(result.stats.risk.cagrPct)} cls={signClass(result.stats.risk.cagrPct)} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard label="胜率 95% CI" value={`${result.stats.winRateCI.lo.toFixed(0)}–${result.stats.winRateCI.hi.toFixed(0)}%`} />
              <StatCard label="每笔均值 95% CI" value={`${result.stats.avgReturnCI.lo.toFixed(1)}–${result.stats.avgReturnCI.hi.toFixed(1)}%`} />
              <StatCard label="PSR (真Sharpe>0)" value={`${(result.stats.psr * 100).toFixed(0)}%`} cls={result.stats.psr >= 0.95 ? "text-rose-500" : "text-[var(--text)]"} />
              <StatCard label={`Deflated Sharpe (N=${result.stats.numTrials})`} value={`${(result.stats.dsr * 100).toFixed(0)}%`} cls={result.stats.dsr >= 0.95 ? "text-rose-500" : "text-[var(--text)]"} />
            </div>
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mb-2 text-xs font-medium text-[var(--muted)]">
                波动率目标仓位（ATR 风险平价 · 目标 {result.stats.volTargeted.targetVolPct}% · 不改买卖点，仅按 1/ATR 调仓）
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="入场平均 ATR%" value={`${result.stats.avgAtrPctAtEntry.toFixed(2)}%`} />
                <StatCard label="平均杠杆" value={`${result.stats.volTargeted.avgLeverage.toFixed(2)}×`} />
                <StatCard
                  label="目标化后 Sharpe"
                  value={result.stats.volTargeted.sharpe.toFixed(2)}
                  cls={result.stats.volTargeted.sharpe > result.stats.risk.sharpe ? "text-rose-500" : "text-[var(--text)]"}
                />
                <StatCard label="目标化后 Sortino" value={result.stats.volTargeted.sortino.toFixed(2)} />
                <StatCard label="目标化后最大回撤" value={`-${result.stats.volTargeted.maxDrawdownPct.toFixed(1)}%`} cls="text-emerald-500" />
              </div>
            </div>
            {result.stats.crossValidation.usedFolds >= 2 && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--muted)]">
                  <span>
                    Purged + Embargo {result.stats.crossValidation.usedFolds} 折时间分折交叉验证（净化{" "}
                    {result.stats.crossValidation.purgedTrades} 笔跨界交易 · 隔离{" "}
                    {result.stats.crossValidation.embargoDays.toFixed(0)} 天）
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      result.stats.crossValidation.holdsOutOfSample
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-red-500/15 text-red-500"
                    }`}
                  >
                    {result.stats.crossValidation.holdsOutOfSample ? "跨时间稳健" : "跨时间不稳健"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <StatCard
                    label="各折胜率 mean±std"
                    value={`${result.stats.crossValidation.meanWinRatePct.toFixed(0)}±${result.stats.crossValidation.stdWinRatePct.toFixed(0)}%`}
                  />
                  <StatCard
                    label="最差折胜率"
                    value={`${result.stats.crossValidation.worstFoldWinRatePct.toFixed(0)}%`}
                    cls={result.stats.crossValidation.worstFoldWinRatePct >= 45 ? "text-rose-500" : "text-emerald-500"}
                  />
                  <StatCard
                    label="正期望折"
                    value={`${result.stats.crossValidation.positiveFolds}/${result.stats.crossValidation.usedFolds}`}
                  />
                  <StatCard
                    label="最差折每笔均值"
                    value={fmtPct(result.stats.crossValidation.worstFoldAvgReturnPct)}
                    cls={signClass(result.stats.crossValidation.worstFoldAvgReturnPct)}
                  />
                </div>
                <div className="mt-2 max-h-44 overflow-auto">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="text-[var(--muted)]">
                      <tr className="border-b border-[var(--border)]">
                        <th className="py-1 pr-2 font-medium">折</th>
                        <th className="py-1 pr-2 font-medium">区间</th>
                        <th className="py-1 pr-2 font-medium">交易</th>
                        <th className="py-1 pr-2 font-medium">胜率</th>
                        <th className="py-1 pr-2 font-medium">每笔均值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.stats.crossValidation.foldStats.map((f) => (
                        <tr key={f.index} className="border-b border-[var(--border)]/50">
                          <td className="py-1 pr-2">#{f.index}</td>
                          <td className="py-1 pr-2 text-[var(--muted)]">{f.startDate}~{f.endDate}</td>
                          <td className="py-1 pr-2">{f.trades}</td>
                          <td className="py-1 pr-2">{f.winRatePct.toFixed(0)}%</td>
                          <td className={`py-1 pr-2 ${signClass(f.avgReturnPct)}`}>{fmtPct(f.avgReturnPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs leading-5 text-[var(--faint)]">
              Sharpe/Sortino/Calmar/最大回撤来自「逐笔等权串行复利」的近似净值曲线（忽略并发持仓），仅作风险量级参考。
              波动率目标仓位按入场 ATR(14)% 反比调仓（低波动多下、高波动少下），目标化后 Sharpe 高于等权即说明该法在本样本上改善了风险调整后收益。
              95% CI 为 bootstrap 重采样区间——区间跨越 50%（胜率）或 0（均值）说明结论受样本运气影响大。
              PSR = 真实 Sharpe&gt;0 的概率；Deflated Sharpe 在「试过 {result.stats.numTrials} 个策略」的多重检验下抬高门槛（运气门槛 SR≈{result.stats.dsrExpectedMaxSharpe.toFixed(2)}），
              二者 ≥95% 才算稳健。胜率显著性经 Bonferroni 校正后阈值为 p&lt;{result.stats.bonferroniAlpha.toFixed(4)}，
              当前{result.stats.significantAfterCorrection ? "仍显著" : "不显著"}。
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">分股票表现（{result.perSymbol.length} 只）</h2>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">代码</th>
                    <th className="px-3 py-2 text-right font-medium">交易</th>
                    <th className="px-3 py-2 text-right font-medium">胜率</th>
                    <th className="px-3 py-2 text-right font-medium">每笔均值</th>
                    <th className="px-3 py-2 text-right font-medium">全程买入持有</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perSymbol.map((s, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-3 py-1.5 font-mono">{s.code}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.trades}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.trades ? `${s.winRatePct.toFixed(0)}%` : "—"}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${signClass(s.avgReturnPct)}`}>{s.trades ? fmtPct(s.avgReturnPct) : "—"}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${signClass(s.buyHoldPct)}`}>{fmtPct(s.buyHoldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)]">交易流水</h2>
              <span className="text-xs text-[var(--muted)]">共 {result.trades.length} 笔（最新在前，最多 200）</span>
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">代码</th>
                    <th className="px-3 py-2 font-medium">买入</th>
                    <th className="px-3 py-2 font-medium">卖出</th>
                    <th className="px-3 py-2 text-right font-medium">收益</th>
                    <th className="px-3 py-2 text-right font-medium">持有</th>
                    <th className="px-3 py-2 font-medium">离场原因</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(0, 200).map((t, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-3 py-1.5 font-mono">{t.code}</td>
                      <td className="px-3 py-1.5 tabular-nums text-[var(--faint)]">{t.buyDate}@{t.buyPrice.toFixed(2)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-[var(--faint)]">{t.sellDate}@{t.sellPrice.toFixed(2)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${signClass(t.returnPct)}`}>{fmtPct(t.returnPct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{t.holdDays}日</td>
                      <td className="px-3 py-1.5 text-xs text-[var(--muted)]">{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
