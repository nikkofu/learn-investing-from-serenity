"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readNdjson } from "@/lib/stream-client";
import { NFA } from "@/lib/disclaimers";
import { PageHeader } from "@/components/ui";
import { resolveInitialStrategyId, saveStrategyId } from "@/lib/strategyPref";
import type { StrategyMeta } from "@/lib/strategies";

type LogLevel = "info" | "success" | "warn" | "error" | "debug";
interface LogEntry {
  t: string;
  level: LogLevel;
  msg: string;
}

const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  info: "text-sky-500",
  success: "text-emerald-500",
  warn: "text-amber-500",
  error: "text-red-500 font-semibold",
  debug: "text-[var(--faint)]",
};

function nowTime(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

interface MiningResult {
  code: string;
  name: string;
  market?: string;
  price: number;
  changePct?: number;
  score: number;
  subScores: { bottom: number; uptrend: number; bSignal: number; volume: number; chips: number };
  matched: string[];
  hasBuySignal: boolean;
  buySignalDate?: string;
  buySignalAgeDays?: number;
  channelType: "up" | "down" | "range";
  channelSlopePct: number;
  channelStatus: "inside" | "breakout" | "breakdown";
  channelPosition: number;
  rangePosition: number;
  reboundOffLowPct: number;
  expectedReturnBase: number;
  expectedReturnBull: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  winRate: number;
  sharpe: number;
  profitRatio: number;
  avgCost: number;
  poc: number;
  sparkline: number[];
}

type Universe = "hot" | "broad" | "full" | "sector" | "custom" | "demo";
type SortField = "amount" | "changePct" | "turnover" | "volumeRatio";

const SORT_LABELS: Record<SortField, string> = {
  amount: "成交额",
  changePct: "涨跌幅",
  turnover: "换手率",
  volumeRatio: "量比",
};

const UNIVERSE_LABELS: Record<Universe, string> = {
  hot: "热门人气榜 (Top100)",
  broad: "全市场（沪深主板+创业+科创，可排序取前 N）",
  full: "全市场全量（沪深主板+创业板，剔除科创板/ST/北交所）",
  sector: "行业板块成分股（本地已同步）",
  custom: "自定义代码清单",
  demo: "演示数据（离线合成，不联网）",
};

interface DailyPoolMeta {
  date: string;
  generatedAt: string;
  summary: { total: number; scanned: number; failed: number; matched: number; elapsedMs: number };
}

const CHANNEL_LABEL: Record<MiningResult["channelType"], string> = {
  up: "上升通道",
  range: "震荡整理",
  down: "下降通道",
};

/** A 股惯例：红涨绿跌。正收益→红，负→绿。 */
function pctClass(v: number): string {
  if (v > 0.0001) return "text-rose-500";
  if (v < -0.0001) return "text-emerald-500";
  return "text-[var(--muted)]";
}

function scoreClass(score: number): string {
  if (score >= 75) return "bg-rose-500/15 text-rose-500";
  if (score >= 60) return "bg-amber-500/15 text-amber-500";
  if (score >= 45) return "bg-[var(--accent-soft)] text-[var(--accent)]";
  return "bg-[var(--surface)] text-[var(--muted)]";
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return <div className="h-8 w-24" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 96;
  const h = 32;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  const stroke = up ? "#f43f5e" : "#10b981";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function MiningPage() {
  const [universe, setUniverse] = useState<Universe>("hot");
  const [sector, setSector] = useState("");
  const [codes, setCodes] = useState("");
  const [size, setSize] = useState("300");
  const [sort, setSort] = useState<SortField>("amount");
  const [concurrency, setConcurrency] = useState("16");
  const [retries, setRetries] = useState("3");

  // 粗筛口径（两段漏斗第 1 段）：原为服务端隐藏默认值（≥1 亿成交额、取前 800 只），
  // 现提到前端可调并随 payload 传给 /api/mining；仅对 full/broad 全市场场景生效。
  const [minAmountYi, setMinAmountYi] = useState("1"); // 亿元
  const [maxCandidates, setMaxCandidates] = useState("800");

  const [minScore, setMinScore] = useState(60);
  const [minExpectedReturn, setMinExpectedReturn] = useState("0");
  const [requireUptrend, setRequireUptrend] = useState(true);
  const [requireLowerBandSupport, setRequireLowerBandSupport] = useState(false);
  const [lowerBandPct, setLowerBandPct] = useState<string>("35"); // 现价距下轨 ≤ 通道宽该百分比
  const [requireBSignal, setRequireBSignal] = useState(true);
  const [maxBSignalDays, setMaxBSignalDays] = useState<string>(""); // "" = 不限

  // 「B 买入信号」所用买卖策略：与全站（/chart、1/backtest/strategy）共用同一偏好，
  // 默认带出上次所选（缺省为 Cardwell RSI Trade Navigator 趋势延续版 V2）。
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [strategyId, setStrategyId] = useState<string>("");

  const [dailyMeta, setDailyMeta] = useState<DailyPoolMeta | null>(null);
  const [dailyStale, setDailyStale] = useState(false);
  const [dailyDates, setDailyDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, total: 0, matched: 0, failed: 0 });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [results, setResults] = useState<MiningResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => [...results].sort((a, b) => b.score - a.score || b.expectedReturnBase - a.expectedReturnBase),
    [results]
  );

  function pushLog(level: LogLevel, msg: string) {
    setLogs((prev) => {
      const next = [...prev, { t: nowTime(), level, msg }];
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
  }

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  /** 一键复制完整运行报告（含执行前条件、逐页进度、命中/异常、用时），便于把上下文+问题一起反馈。 */
  async function copyReport() {
    if (logs.length === 0) {
      pushLog("warn", "暂无日志可复制");
      return;
    }
    const text = logs.map((l) => `${l.t} ${l.msg}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      pushLog("success", `📋 已复制运行报告到剪贴板（${logs.length} 行）`);
    } catch {
      pushLog("error", "✗ 复制失败：浏览器拒绝剪贴板访问（请手动选择日志复制）");
    }
  }

  function buildFilters(): Record<string, unknown> {
    const f: Record<string, unknown> = {
      minScore,
      minExpectedReturn: Number(minExpectedReturn) || 0,
      requireUptrend,
      requireBSignal,
    };
    if (requireLowerBandSupport) {
      f.requireLowerBandSupport = true;
      const pct = Number(lowerBandPct);
      if (Number.isFinite(pct) && pct > 0) f.lowerBandPct = pct / 100;
    }
    if (maxBSignalDays !== "") f.maxBSignalAgeDays = Number(maxBSignalDays);
    return f;
  }

  function resetRun() {
    setError(null);
    setResults([]);
    setLogs([]);
    setProgress({ scanned: 0, total: 0, matched: 0, failed: 0 });
    setElapsedMs(0);
  }

  async function consumeStream(res: Response, label: string) {
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    await readNdjson(res, (ev: Record<string, unknown>) => {
      const type = ev.type as string;
      if (type === "accepted") {
        pushLog("info", `· ${String(ev.message ?? "已受理")}`);
      } else if (type === "plan") {
        // 执行前回显本次任务的全部生效条件（板块范围 / 粗筛口径 / 筛选 / 策略 / 并发·重试 / 翻页上限）。
        pushLog("info", "◆ 执行计划（本次任务全部生效条件，执行前回显）");
        const boards = (ev.boards as string[]) ?? [];
        const excluded = (ev.excluded as string[]) ?? [];
        pushLog(
          "info",
          `  板块范围：${boards.join("+") || "—"}${excluded.length ? `（剔除 ${excluded.join("/")}）` : ""}`,
        );
        const pf = (ev.prefilter ?? null) as Record<string, unknown> | null;
        if (pf) {
          const pp: string[] = [];
          if (pf.minAmount != null) pp.push(`最低成交额≥${(Number(pf.minAmount) / 1e8).toFixed(2)}亿`);
          if (pf.minTurnover != null) pp.push(`最低换手≥${pf.minTurnover}%`);
          if (pf.minVolumeRatio != null) pp.push(`最低量比≥${pf.minVolumeRatio}`);
          if (pf.maxCandidates != null) pp.push(`取前 ${pf.maxCandidates} 只（按成交额倒序）`);
          pushLog("info", `  粗筛口径（第一段漏斗）：${pp.length ? pp.join("，") : "无"}`);
        } else {
          pushLog("info", "  粗筛口径（第一段漏斗）：无（逐只评估全部候选）");
        }
        const f = (ev.filters ?? {}) as Record<string, unknown>;
        const fp: string[] = [];
        if (f.minScore != null) fp.push(`最低复合分≥${f.minScore}`);
        if (f.minExpectedReturn != null) fp.push(`最低预期收益≥${f.minExpectedReturn}%`);
        if (f.requireUptrend) fp.push("必须上升通道");
        if (f.requireLowerBandSupport)
          fp.push(`必须下轨支撑（上升通道+贴近下轨≤${Math.round((Number(f.lowerBandPct) || 0.35) * 100)}%通道宽且未跌破）`);
        if (f.requireBSignal) fp.push("必须有 B 买入信号");
        if (f.maxBSignalAgeDays != null) fp.push(`B 新鲜度≤${f.maxBSignalAgeDays} 交易日`);
        pushLog("info", `  筛选条件（第二段漏斗）：${fp.length ? fp.join("，") : "无（全部返回）"}`);
        if (ev.strategyName) pushLog("info", `  买卖策略（B 信号源）：${String(ev.strategyName)}`);
        pushLog(
          "info",
          `  并发 ${ev.concurrency ?? ""} · 失败重试 ${ev.retries ?? ""} 次${ev.maxPages != null ? ` · 候选池翻页上限 ${ev.maxPages} 页` : ""}`,
        );
      } else if (type === "earlyStop") {
        const qualified = Number(ev.qualified) || 0;
        const pages = Number(ev.pages) || 0;
        const cap = ev.cap != null ? Number(ev.cap) : undefined;
        const maxPages = Number(ev.maxPages) || 0;
        const skipped = Math.max(0, maxPages - pages);
        if (ev.reason === "capReached") {
          pushLog(
            "success",
            `✓ 已集齐 top-${cap ?? qualified} 只（第 ${pages} 页），提前终止翻页：跳过后续约 ${skipped} 页低成交额票，零遗漏（clist 按成交额倒序，后续页不可能再进入结果）`,
          );
        } else {
          pushLog(
            "success",
            `✓ 第 ${pages} 页末行成交额已跌破最低阈值，提前终止翻页：跳过后续约 ${skipped} 页，零遗漏`,
          );
        }
      } else if (type === "universe") {
        const loaded = Number(ev.loaded) || 0;
        const pages = Number(ev.pages) || 0;
        if (ev.cached) {
          const ageMin = (Number(ev.ageMs) || 0) / 60000;
          const ttlMin = (Number(ev.ttlMs) || 0) / 60000;
          pushLog(
            "success",
            `⚡ 复用候选池快照：${loaded} 只（免去逐页重拉）· 缓存龄 ${ageMin.toFixed(1)} 分钟 · 时段 ${String(ev.phase ?? "")}（TTL ${ttlMin.toFixed(0)} 分钟）`,
          );
        } else {
          pushLog("debug", `· 拉取候选池中：已 ${loaded} 只（第 ${pages} 页）`);
        }
      } else if (type === "meta") {
        const total = Number(ev.total) || 0;
        const rawTotal = Number(ev.rawTotal) || 0;
        setProgress((p) => ({ ...p, total }));
        pushLog("info", `▶ 开始扫描 ${total} 只${rawTotal > total ? `（粗筛前 ${rawTotal} 只）` : ""} · 池 ${label} · 并发 ${ev.concurrency ?? ""}`);
        if (ev.strategyName) pushLog("info", `  买卖策略（B 信号源）：${String(ev.strategyName)}`);
        const f = (ev.filters ?? {}) as Record<string, unknown>;
        const pf = (ev.prefilter ?? null) as Record<string, unknown> | null;
        const fp: string[] = [];
        if (f.minScore != null) fp.push(`最低复合分≥${f.minScore}`);
        if (f.minExpectedReturn != null) fp.push(`最低预期收益≥${f.minExpectedReturn}%`);
        if (f.requireUptrend) fp.push(`必须上升通道`);
        if (f.requireLowerBandSupport)
          fp.push(`必须下轨支撑（上升通道+贴近下轨≤${Math.round((Number(f.lowerBandPct) || 0.35) * 100)}%通道宽且未跌破）`);
        if (f.requireBSignal) fp.push(`必须有 B 买入信号`);
        if (f.maxBSignalAgeDays != null) fp.push(`B 新鲜度≤${f.maxBSignalAgeDays} 交易日`);
        pushLog("info", `  筛选条件：${fp.length ? fp.join("，") : "无（全部返回）"}`);
        if (pf) {
          const pp: string[] = [];
          if (pf.minAmount != null) pp.push(`最低成交额≥${(Number(pf.minAmount) / 1e8).toFixed(1)}亿`);
          if (pf.minTurnover != null) pp.push(`最低换手≥${pf.minTurnover}%`);
          if (pf.minVolumeRatio != null) pp.push(`最低量比≥${pf.minVolumeRatio}`);
          if (pf.maxCandidates != null) pp.push(`取前 ${pf.maxCandidates} 只（按成交额）`);
          if (pp.length) pushLog("info", `  粗筛（第一段漏斗）：${pp.join("，")}`);
        }
      } else if (type === "progress") {
        setProgress({
          scanned: Number(ev.scanned) || 0,
          total: Number(ev.total) || 0,
          matched: Number(ev.matched) || 0,
          failed: Number(ev.failed) || 0,
        });
        const code = String(ev.code ?? "");
        const name = String(ev.name ?? "");
        const outcome = String(ev.outcome ?? "");
        const source = String(ev.source ?? "");
        const src = source && source !== "none" ? ` [源:${source}]` : "";
        if (outcome === "matched") {
          const ret = Number(ev.ret);
          pushLog(
            "success",
            `✓ 命中 ${code} ${name} · 复合分 ${ev.score} · 预期 ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%${src}`
          );
        } else if (outcome === "failed") {
          pushLog("warn", `⚠ ${code} ${name} 无足够 K 线（已尝试全部数据源${source ? `，末次:${source}` : ""}），已跳过`);
        } else if (outcome === "filtered") {
          pushLog("debug", `· ${code} ${name} 复合分 ${ev.score} 未达条件${src}`);
        }
      } else if (type === "result") {
        setResults((prev) => [...prev, ev.item as MiningResult]);
      } else if (type === "done") {
        const elapsed = Number(ev.elapsedMs) || 0;
        setElapsedMs(elapsed);
        pushLog(
          "info",
          `■ 完成：扫描 ${ev.scanned}，命中 ${ev.matched}，失败 ${ev.failed}，用时 ${(elapsed / 1000).toFixed(1)}s`
        );
        const reasons = (ev.reasons ?? {}) as Record<string, number>;
        const LABELS: Record<string, string> = {
          minScore: "复合分不足",
          minExpectedReturn: "预期收益不足",
          requireUptrend: "非上升通道",
          requireLowerBandSupport: "未贴近下轨支撑",
          requireBSignal: "无 B 买入信号",
          bSignalMissing: "无 B 买入信号",
          bSignalStale: "B 信号过期",
          fetchFailed: "取数失败",
        };
        const parts = Object.entries(reasons)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${LABELS[k] ?? k}卡掉 ${n} 只`);
        if (parts.length) {
          pushLog(
            Number(ev.matched) > 0 ? "info" : "warn",
            `  未命中原因分布：[${parts.join(" | ")}]`,
          );
        }
      } else if (type === "saved") {
        pushLog("success", `💾 已存盘今日股票池 ${ev.date}：共 ${ev.count} 只`);
      } else if (type === "error") {
        setError(String(ev.message));
        pushLog("error", `✗ ${String(ev.message)}`);
      }
    });
  }

  async function startScan() {
    if (running) return;
    setRunning(true);
    resetRun();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pushLog(
      "info",
      universe === "full"
        ? `▶ 开始挖掘：正拉取「${UNIVERSE_LABELS[universe]}」候选池…全量需逐页串行限流拉取（约数分钟），下方会持续显示拉取进度，请耐心等待`
        : `▶ 开始挖掘：正拉取「${UNIVERSE_LABELS[universe]}」候选池…`,
    );

    const payload = {
      universe,
      sector: sector.trim() || undefined,
      codes: universe === "custom" ? codes.split(/[\s,，、]+/).map((c) => c.trim()).filter(Boolean) : undefined,
      size: Number(size) || (universe === "hot" ? 100 : 300),
      sort,
      concurrency: Number(concurrency) || 16,
      retries: Number(retries) || 3,
      filters: buildFilters(),
      strategyId: strategyId || undefined,
      // 粗筛口径仅对 full/broad 生效；其余股票池无粗筛默认，不传。
      prefilter:
        universe === "full" || universe === "broad"
          ? {
              minAmount: Math.max(0, Number(minAmountYi) || 0) * 1e8,
              maxCandidates: Number(maxCandidates) > 0 ? Number(maxCandidates) : undefined,
            }
          : undefined,
    };

    try {
      const res = await fetch("/api/mining", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      await consumeStream(res, UNIVERSE_LABELS[universe]);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        pushLog("error", `✗ ${msg}`);
      } else {
        pushLog("warn", "■ 已手动停止扫描");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /** 生成今日股票池：全市场全量「刚发出 B 信号」扫描并落盘。 */
  async function generateDaily() {
    if (running) return;
    setRunning(true);
    resetRun();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pushLog("info", "▶ 生成今日股票池：全市场全量扫描「刚发出 B 信号」（剔除科创板/ST）…较耗时，请耐心等待");
    try {
      const res = await fetch("/api/mining/daily", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
        signal: ctrl.signal,
      });
      await consumeStream(res, "全市场全量（每日池）");
      await fetchDailyStatus();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        pushLog("error", `✗ ${msg}`);
      } else {
        pushLog("warn", "■ 已手动停止生成");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /** 读取已存盘的当日/指定日期股票池状态（不重扫）。 */
  async function fetchDailyStatus() {
    try {
      const res = await fetch("/api/mining/daily");
      const j = await res.json();
      setDailyMeta((j.pool?.meta as DailyPoolMeta) ?? null);
      setDailyStale(!!j.stale);
      setDailyDates((j.dates as string[]) ?? []);
    } catch {
      /* 静默：状态获取失败不阻断页面 */
    }
  }

  useEffect(() => {
    fetchDailyStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉取已登记策略列表，并与全站一致地选出初始策略（上次保存 > 偏好 Cardwell V2 > 后端默认 > 首个）。
  useEffect(() => {
    let alive = true;
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((j: { defaultStrategyId?: string; strategies?: StrategyMeta[] }) => {
        if (!alive) return;
        const list = j.strategies ?? [];
        setStrategies(list);
        setStrategyId(
          resolveInitialStrategyId({
            ids: list.map((s) => s.id),
            urlId: null,
            backendDefaultId: j.defaultStrategyId ?? null,
          }),
        );
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

  /** 载入某日已存股票池到结果表。 */
  async function loadDaily(date?: string) {
    if (running) return;
    try {
      setError(null);
      const res = await fetch(`/api/mining/daily${date ? `?date=${date}` : ""}`);
      const j = await res.json();
      const pool = j.pool as { meta: DailyPoolMeta; results: MiningResult[] } | null;
      if (pool?.results) {
        setResults(pool.results);
        setDailyMeta(pool.meta);
        setDailyStale(!!j.stale);
        setDailyDates((j.dates as string[]) ?? []);
        const s = pool.meta.summary;
        setProgress({ scanned: s.scanned, total: s.total, matched: s.matched, failed: s.failed });
        setElapsedMs(s.elapsedMs);
        pushLog("info", `■ 已载入 ${pool.meta.date} 股票池：命中 ${pool.results.length} 只`);
      } else {
        pushLog("warn", "该日期暂无已存股票池，请先生成");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }

  function stopScan() {
    abortRef.current?.abort();
  }

  const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;

  return (
    <main className="w-full">
      <PageHeader
        title="智能挖掘 · 形态扫描"
        subtitle="高并发扫描股票池，复用个股图表同源算法筛出「底部企稳 + 上升通道 + B 买入信号」形态，并给出预期收益率 / 目标止盈 / 安全止损。"
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
      {/* 每日股票池 */}
      <div className="mb-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">今日股票池 · 全市场「刚发出 B 信号」</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {dailyMeta ? (
                <>
                  {dailyStale ? "当日尚未生成，最近一次：" : "已生成："}
                  <span className="font-medium text-[var(--text)]">{dailyMeta.date}</span>
                  {" · 命中 "}
                  <span className="font-semibold text-[var(--accent)]">{dailyMeta.summary.matched}</span>
                  {" 只 · 扫描 "}
                  {dailyMeta.summary.scanned}
                  {" · 用时 "}
                  {(dailyMeta.summary.elapsedMs / 1000).toFixed(0)}s
                </>
              ) : (
                "尚无已存股票池。点击「生成今日股票池」做一次全市场全量扫描并落盘（约 4000+ 只，较耗时）。"
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dailyDates.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs"
                >
                  <option value="">选择历史日期…</option>
                  {dailyDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => loadDaily(selectedDate || undefined)}
                  disabled={running}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--hover)] disabled:opacity-50"
                >
                  载入
                </button>
              </div>
            )}
            <button
              onClick={generateDaily}
              disabled={running}
              className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              生成今日股票池
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
          每天扫描一次形成当日清单，结果缓存到本地 <code>data/mining_pool/&lt;日期&gt;.json</code>，页面再次打开秒读。可用定时任务每天收盘后 <code>POST /api/mining/daily</code> 自动生成。
        </p>
      </div>

      {/* 筛选条件 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">股票池</span>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value as Universe)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            >
              {(Object.keys(UNIVERSE_LABELS) as Universe[]).map((u) => (
                <option key={u} value={u}>
                  {UNIVERSE_LABELS[u]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">买卖策略（B 信号源，与 /chart 全局一致）</span>
            <select
              value={strategyId}
              onChange={(e) => {
                setStrategyId(e.target.value);
                saveStrategyId(e.target.value);
              }}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              title={selectedStrategy?.description}
            >
              {strategies.length === 0 && <option value="">加载中…</option>}
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} v{s.version}
                </option>
              ))}
            </select>
          </label>

          {universe === "broad" && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">排序字段（取前 N）</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortField)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                {(Object.keys(SORT_LABELS) as SortField[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(universe === "broad" || universe === "hot") && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">
                {universe === "hot" ? "目标数量（>100 自动用全市场按成交额补足，最大 5000）" : "候选池规模（前 N，20–5000）"}
              </span>
              <input
                type="number"
                min={universe === "hot" ? 1 : 20}
                max={5000}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
          )}

          {universe === "sector" && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--muted)]">板块代码（如 BK1288；留空=全部已同步板块）</span>
              <input
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="BK1288"
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
          )}

          {universe === "custom" && (
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-[var(--muted)]">自定义代码（逗号/空格分隔，6 位）</span>
              <input
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                placeholder="600519, 000858, 300750"
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">最低复合分：{minScore}</span>
            <input type="range" min={0} max={90} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">最低预期收益 %（基准情景）</span>
            <input
              type="number"
              value={minExpectedReturn}
              onChange={(e) => setMinExpectedReturn(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">并发度（4–32）</span>
            <input
              type="number"
              min={4}
              max={32}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">失败重试次数（0–10，限流时自动重试）</span>
            <input
              type="number"
              min={0}
              max={10}
              value={retries}
              onChange={(e) => setRetries(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            />
          </label>

          {(universe === "full" || universe === "broad") && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">粗筛·最低成交额（亿元，第一段漏斗）</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={minAmountYi}
                  onChange={(e) => setMinAmountYi(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--muted)]">粗筛·取前 N 只（按成交额倒序，1–8000）</span>
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={maxCandidates}
                  onChange={(e) => setMaxCandidates(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                />
              </label>
            </>
          )}
        </div>
        {(universe === "full" || universe === "broad") && (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
            粗筛口径（第一段漏斗）：候选池按成交额倒序，先用上述「最低成交额 + 取前 N 只」快速截断，再对幸存者逐只取 K 线评估信号，避免对几千只低流动性票做无谓回测。设最低成交额为 0 即不按成交额过滤。执行前会在右侧日志「执行计划」一并回显。
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={requireUptrend} onChange={(e) => setRequireUptrend(e.target.checked)} />
            <span>必须上升通道</span>
          </label>
          <label className="flex items-center gap-2 text-xs" title="上升通道 + 现价贴近回归通道下轨（≤通道宽该百分比）且未跌破下轨，用于高抛低吸切入点">
            <input
              type="checkbox"
              checked={requireLowerBandSupport}
              onChange={(e) => setRequireLowerBandSupport(e.target.checked)}
            />
            <span>必须下轨支撑</span>
          </label>
          {requireLowerBandSupport && (
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--muted)]">贴近下轨阈值</span>
              <input
                type="number"
                min={1}
                max={100}
                value={lowerBandPct}
                onChange={(e) => setLowerBandPct(e.target.value)}
                className="w-16 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
              />
              <span className="text-[var(--faint)]">% 通道宽</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={requireBSignal} onChange={(e) => setRequireBSignal(e.target.checked)} />
            <span>必须有 B 买入信号</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted)]">B 信号新鲜度</span>
            <select
              value={maxBSignalDays}
              onChange={(e) => setMaxBSignalDays(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            >
              <option value="">不限</option>
              <option value="0">仅当日</option>
              <option value="1">当日 / 隔日</option>
              <option value="3">3 个交易日内</option>
              <option value="5">5 个交易日内</option>
            </select>
          </label>
          <div className="flex-1" />
          {running ? (
            <button
              onClick={stopScan}
              className="rounded-md border border-[var(--border)] px-4 py-1.5 text-sm font-medium text-[var(--muted)] hover:bg-[var(--hover)]"
            >
              停止扫描
            </button>
          ) : (
            <button
              onClick={startScan}
              className="rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              开始挖掘
            </button>
          )}
        </div>
      </div>

      {/* 进度 */}
      {(running || progress.scanned > 0) && (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
            <span>
              已扫描 {progress.scanned}/{progress.total}（命中 <span className="font-semibold text-[var(--accent)]">{progress.matched}</span>，失败 {progress.failed}）
            </span>
            <span>{running ? "扫描中…" : `完成，用时 ${(elapsedMs / 1000).toFixed(1)}s`}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {error && <div className="msg-error mt-4 rounded-lg border px-4 py-3 text-sm">{error}</div>}

      {/* 结果 */}
      {sorted.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">股票</th>
                <th className="px-3 py-2 font-medium">复合分</th>
                <th className="px-3 py-2 font-medium">信号</th>
                <th className="px-3 py-2 text-right font-medium">现价</th>
                <th className="px-3 py-2 text-right font-medium">预期收益</th>
                <th className="px-3 py-2 text-right font-medium">目标 / 止损</th>
                <th className="px-3 py-2 text-right font-medium">盈亏比</th>
                <th className="px-3 py-2 text-right font-medium">胜率/获利盘</th>
                <th className="px-3 py-2 text-center font-medium">走势</th>
                <th className="px-3 py-2 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.code} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--hover)]">
                  <td className="px-3 py-2 text-[var(--faint)]">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-[var(--faint)]">{r.code}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-sm font-bold ${scoreClass(r.score)}`}>{r.score}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-[180px] flex-wrap gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.channelType === "up"
                            ? "bg-rose-500/12 text-rose-500"
                            : r.channelType === "down"
                              ? "bg-emerald-500/12 text-emerald-500"
                              : "bg-[var(--surface)] text-[var(--muted)]"
                        }`}
                      >
                        {CHANNEL_LABEL[r.channelType]}
                      </span>
                      {r.matched
                        .filter((m) => m !== "上升通道")
                        .map((m) => (
                          <span key={m} className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                            {m}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <div>{r.price.toFixed(2)}</div>
                    {r.changePct != null && (
                      <div className={`text-xs ${pctClass(r.changePct)}`}>
                        {r.changePct > 0 ? "+" : ""}
                        {r.changePct.toFixed(2)}%
                      </div>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${pctClass(r.expectedReturnBase)}`}>
                    <div>
                      {r.expectedReturnBase > 0 ? "+" : ""}
                      {r.expectedReturnBase.toFixed(1)}%
                    </div>
                    <div className="text-[10px] font-normal text-[var(--faint)]">
                      乐观 {r.expectedReturnBull > 0 ? "+" : ""}
                      {r.expectedReturnBull.toFixed(1)}%
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <div className="text-rose-500">{r.target.toFixed(2)}</div>
                    <div className="text-emerald-500">{r.stopLoss.toFixed(2)}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.riskReward.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <div>{r.winRate.toFixed(0)}%</div>
                    <div className="text-[var(--faint)]">{(r.profitRatio * 100).toFixed(0)}%</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-center">
                      <Sparkline data={r.sparkline} up={r.channelType === "up"} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-center gap-1">
                      <a href={`/chart?code=${r.code}`} target="_blank" className="text-xs font-medium text-[var(--accent)] hover:underline">
                        看图
                      </a>
                      <a href={`/analyze?code=${r.code}`} target="_blank" className="text-xs text-[var(--muted)] hover:underline">
                        深度分析
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!running && sorted.length === 0 && progress.scanned > 0 && !error && (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          本次扫描未发现满足条件的标的。可降低「最低复合分」或取消「必须 B 买入信号」后重试。
        </div>
      )}
        </div>

        <aside className="w-full lg:w-[360px] lg:shrink-0">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] lg:sticky lg:top-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="text-xs font-medium">
                实时日志 <span className="text-[var(--faint)]">({logs.length})</span>
              </span>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-emerald-500">命中</span>
                <span className="text-amber-500">跳过</span>
                <span className="text-[var(--faint)]">未达</span>
                <button onClick={copyReport} className="text-[var(--muted)] hover:text-[var(--text)]">
                  复制报告
                </button>
                <button onClick={() => setLogs([])} className="text-[var(--muted)] hover:text-[var(--text)]">
                  清空
                </button>
              </div>
            </div>
            <div
              ref={logRef}
              className="h-[50vh] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed lg:h-[calc(100vh-7rem)]"
            >
              {logs.length === 0 ? (
                <div className="text-[var(--faint)]">暂无日志，点击「开始挖掘」后这里会按等级实时滚动输出。</div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-words ${LOG_LEVEL_CLASS[l.level]}`}>
                    <span className="text-[var(--faint)]">{l.t} </span>
                    {l.msg}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--faint)]">
        风险提示：预期收益率基于几何布朗运动(GBM)概率区间与历史回测推导，非未来收益承诺；目标/止损为参考价位。{NFA}市场有风险，决策需自负。
      </p>
    </main>
  );
}
