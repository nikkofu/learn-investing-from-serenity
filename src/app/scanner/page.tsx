"use client";

import { useEffect, useState, useRef, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { ChokepointAssessment, StockQuote } from "@/lib/types";
import { readNdjson } from "@/lib/stream-client";
import RadarChart from "@/components/RadarChart";
import QuantChart from "@/components/QuantChart";
import FavoriteButton from "@/components/FavoriteButton";

interface HotStockItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  turnoverPct: number;
  market: "SH" | "SZ" | "BJ";
}

interface ScanData {
  quote: StockQuote;
  stats: {
    windowDays: number;
    periodReturnPct: number;
    rangePosition: number;
    avgTurnoverPct: number;
    windowHigh: number;
    windowLow: number;
  } | null;
  assessment: ChokepointAssessment;
  quant?: {
    chips: any;
    backtest: any;
    technical?: any;
    candles?: any[];
  };
}

interface AssessmentState {
  status: "idle" | "loading" | "done" | "error";
  errorMsg?: string;
  retryCount?: number;
  stageMsg?: string;
  data?: ScanData;
}

const FACTOR_LABELS: Record<string, string> = {
  demand: "确定需求",
  supply: "受限供给",
  attention: "低关注度",
  valueCapture: "价值捕获",
  catalyst: "催化剂",
};

function ScannerContent() {
  const searchParams = useSearchParams();
  const codesParam = searchParams.get("codes") || "";
  const customTitle = searchParams.get("title") || "";
  const isCustomMode = !!codesParam;

  const [list, setList] = useState<HotStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hotRankRetryCount, setHotRankRetryCount] = useState(0); // 记录热榜请求重试次数
  const [syncingRank, setSyncingRank] = useState(false); // 落盘版本化同步状态
  const [concurrency, setConcurrency] = useState(5); // 并行诊断数量 (默认 5，可配置)
  const [assessments, setAssessments] = useState<Record<string, AssessmentState>>({});
  
  // 扫描控制状态
  const [filterType, setFilterType] = useState<"all" | "up" | "down" | "active">("all");
  const [scanning, setScanning] = useState(false);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  // 终止扫描的信号控制器
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeTasksCount = useRef(0);
  const taskQueue = useRef<string[]>([]);

  // 1. 获取股票列表 (包含错误捕捉、最多 10 次重试机制，支持自定数据源)
  async function fetchList(attempt = 1) {
    setLoading(true);
    setError("");
    setHotRankRetryCount(attempt);
    try {
      const targetUrl = isCustomMode 
        ? `/api/market/batch?codes=${encodeURIComponent(codesParam)}`
        : "/api/market/hot-rank";
      const res = await fetch(targetUrl);
      if (!res.ok) {
        throw new Error(`请求股票数据错误: ${res.status}`);
      }
      const json = await res.json();
      // 按证券代码去重，避免接口返回重复股票导致 React 重复 key 警告
      const incoming: HotStockItem[] = json.list ?? [];
      const seen = new Set<string>();
      const uniqueList: HotStockItem[] = [];
      for (const it of incoming) {
        if (seen.has(it.code)) continue;
        seen.add(it.code);
        uniqueList.push(it);
      }
      setList(uniqueList);
      setHotRankRetryCount(0); // 成功后重置
      setLoading(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "股票数据获取失败";
      if (attempt < 10) {
        console.warn(`[Scanner] 获取股票数据第 ${attempt}/10 次尝试失败，准备重试: ${msg}`);
        // 延迟 1.5 秒后重试
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await fetchList(attempt + 1);
      } else {
        setError(msg);
        setHotRankRetryCount(0);
        setLoading(false);
      }
    }
  }

  // 同步热门榜单到本地（落盘版本化，供运营/LLM 使用），完成后刷新展示
  async function handleSyncRank() {
    if (syncingRank) return;
    setSyncingRank(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "hotRank" }),
      });
      const data = await res.json();
      const result = data.result;
      if (!res.ok || !result || !result.ok) {
        throw new Error(result?.error || data.error || `同步失败（${res.status}）`);
      }
      alert(`🔥 榜单同步成功！共 ${result.count} 只（v${result.version}${result.changed === false ? "·无变化" : ""}）。`);
      await fetchList(1);
    } catch (err) {
      alert(`❌ 榜单同步失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSyncingRank(false);
    }
  }

  // 把当前列表（自定池或热榜）保存为命名股票池，落盘到 .data/（v0.32）
  const [savingPool, setSavingPool] = useState(false);
  async function handleSavePool() {
    const poolCodes = list.map((it) => it.code);
    if (poolCodes.length === 0) {
      alert("当前没有可保存的股票");
      return;
    }
    const name = window.prompt("新股票池名称", customTitle || "");
    if (name === null) return;
    setSavingPool(true);
    try {
      const res = await fetch("/api/watchlist/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, codes: poolCodes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "保存失败");
      alert(`已保存股票池（${json.pool?.codes?.length ?? poolCodes.length} 只），可在「自选 / 收藏」中管理。`);
    } catch (e) {
      alert(`保存失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSavingPool(false);
    }
  }

  useEffect(() => {
    fetchList();
  }, []);

  // 2. 单股分析核心拉取器 (附带 ndjson 流读取，可抽取最终 result)
  async function performSingleScan(code: string, onUpdate: (state: Partial<AssessmentState>) => void): Promise<ScanData> {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!(res.headers.get("content-type") || "").includes("ndjson")) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || "分析接口异常");
    }

    onUpdate({ retryCount: 1, stageMsg: "建立连接..." });

    let scanData: ScanData | null = null;
    let streamError = "";
    let tokenCount = 0;
    let lastUpdateTime = 0;
    const THROTTLE_MS = 300; // 每 300ms 最多更新一次字数状态，防止渲染卡顿

    await readNdjson(res, (ev: any) => {
      if (ev.type === "stage") {
        let stageMsg = "";
        if (ev.key === "quote" && ev.status === "start") {
          stageMsg = "获取行情中...";
        } else if (ev.key === "reason" && ev.status === "start") {
          stageMsg = "AI深度推理中...";
        } else if (ev.key === "summary" && ev.status === "start") {
          stageMsg = "整理评估中...";
        }
        if (stageMsg) {
          onUpdate({ stageMsg });
        }
      } else if (ev.type === "token") {
        tokenCount += (ev.text || "").length;
        const now = Date.now();
        if (now - lastUpdateTime > THROTTLE_MS) {
          lastUpdateTime = now;
          onUpdate({ stageMsg: `AI推理中(${tokenCount}字)` });
        }
      } else if (ev.type === "result") {
        scanData = {
          quote: ev.quote as StockQuote,
          stats: ev.stats as any,
          assessment: ev.assessment as ChokepointAssessment,
          quant: ev.quant as any,
        };
      } else if (ev.type === "error") {
        streamError = ev.message as string;
      }
    });

    if (streamError) {
      throw new Error(streamError);
    }
    if (!scanData) {
      throw new Error("模型未返回打分结果");
    }
    return scanData;
  }

  // 3. 递归重试诊断调度
  async function scanWithRetry(code: string, attempt = 1, signal?: AbortSignal): Promise<ScanData> {
    if (signal?.aborted) {
      throw new Error("扫描已中止");
    }
    
    // 更新重试状态
    setAssessments((prev) => ({
      ...prev,
      [code]: { 
        status: "loading", 
        retryCount: attempt,
        stageMsg: attempt > 1 ? `重试(第${attempt}/10次)...` : "启动诊断..."
      },
    }));

    try {
      return await performSingleScan(code, (partialState) => {
        if (!signal?.aborted) {
          setAssessments((prev) => {
            const current = prev[code] || {};
            return {
              ...prev,
              [code]: {
                ...current,
                status: "loading",
                retryCount: attempt,
                ...partialState,
              },
            };
          });
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "分析失败";
      if (attempt < 10 && !signal?.aborted) {
        console.warn(`[Scanner] 股票 ${code} 第 ${attempt}/10 次尝试失败，准备重试: ${msg}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return scanWithRetry(code, attempt + 1, signal);
      } else {
        throw new Error(msg);
      }
    }
  }

  // 4. 单股手动诊断
  async function triggerSingleScan(code: string) {
    if (assessments[code]?.status === "loading") return;
    
    setAssessments((prev) => ({
      ...prev,
      [code]: { status: "loading", retryCount: 1, stageMsg: "启动诊断..." },
    }));

    try {
      const data = await scanWithRetry(code, 1);
      setAssessments((prev) => ({
        ...prev,
        [code]: { status: "done", data },
      }));
    } catch (err) {
      setAssessments((prev) => ({
        ...prev,
        [code]: {
          status: "error",
          errorMsg: err instanceof Error ? err.message : "诊断失败",
        },
      }));
    }
  }

  // 5. 过滤出当前显示的热门股
  const filteredList = list.filter((item) => {
    if (filterType === "up") return item.changePct >= 4.0;
    if (filterType === "down") return item.changePct < 0;
    if (filterType === "active") return item.turnoverPct >= 5.0;
    return true;
  });

  // 6. 批量并发执行器

  function stopScanning() {
    setScanning(false);
    taskQueue.current = [];
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }

  async function startScanning() {
    if (scanning) return;
    setScanning(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 找出所有需要扫描的股票代码
    const toScan = filteredList
      .filter((s) => {
        const state = assessments[s.code];
        return !state || state.status !== "done";
      })
      .map((s) => s.code);

    taskQueue.current = toScan;
    activeTasksCount.current = 0;

    const runNext = async () => {
      if (abortController.signal.aborted) return;
      if (taskQueue.current.length === 0) {
        if (activeTasksCount.current === 0) {
          setScanning(false);
        }
        return;
      }

      const code = taskQueue.current.shift()!;
      activeTasksCount.current++;

      try {
        const data = await scanWithRetry(code, 1, abortController.signal);
        if (!abortController.signal.aborted) {
          setAssessments((prev) => ({
            ...prev,
            [code]: { status: "done", data },
          }));
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setAssessments((prev) => ({
            ...prev,
            [code]: {
              status: "error",
              errorMsg: err instanceof Error ? err.message : "扫描重试超限",
            },
          }));
        }
      } finally {
        activeTasksCount.current--;
        runNext();
      }
    };

    // 启动初始并发
    const initRunCount = Math.min(concurrency, toScan.length);
    if (initRunCount === 0) {
      setScanning(false);
      return;
    }
    for (let i = 0; i < initRunCount; i++) {
      runNext();
    }
  }

  // 辅助函数：格式化市值
  const formatCap = (n: number | undefined) => {
    if (!n) return "-";
    return (n / 1e8).toFixed(1) + " 亿";
  };

  return (
    <div className="space-y-6">
      
      {/* 头部标题区域 */}
      <div className="border-b border-[var(--border)] pb-3">
        <h1 className="text-xl font-bold tracking-wider font-mono">
          {isCustomMode 
            ? `[自定股票池 · ${customTitle || "未命名"}] 策略扫描器`
            : "SERENITY MARKET SCANNER / 热门股策略扫描器"}
        </h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {isCustomMode 
            ? `当前导入自定股票池（共 ${list.length} 只股票），支持一键开启 AI 多因子并发打分与突破股识别诊断。`
            : "实时监控东方财富股吧人气前 100 个股，多因子并行打分与突破股识别，快速挑选进入跟踪股票池。"}
        </p>
      </div>

      {/* 控制台与筛选选项卡 (直角扁平底板) */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border)] bg-[var(--surface)] p-4 rounded-[2px]">
        
        {/* 筛选按钮组 */}
        <div className="flex flex-wrap gap-2">
          {isCustomMode ? (
            <div className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] px-3 py-1.5 text-xs text-[var(--muted)] font-mono">
              股票池成员数: <span className="text-[var(--text)] font-bold">{list.length}</span>
            </div>
          ) : (
            <>
              <button
                onClick={() => setFilterType("all")}
                disabled={scanning}
                className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                  filterType === "all"
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "bg-[var(--hover)] text-[var(--text)] hover:opacity-85 disabled:opacity-50"
                }`}
              >
                全部人气股 ({list.length})
              </button>
              <button
                onClick={() => setFilterType("up")}
                disabled={scanning}
                className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                  filterType === "up"
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "bg-[var(--hover)] text-[var(--text)] hover:opacity-85 disabled:opacity-50"
                }`}
              >
                今日领涨 (涨幅 ≥ 4%)
              </button>
              <button
                onClick={() => setFilterType("active")}
                disabled={scanning}
                className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                  filterType === "active"
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "bg-[var(--hover)] text-[var(--text)] hover:opacity-85 disabled:opacity-50"
                }`}
              >
                交投活跃 (换手 ≥ 5%)
              </button>
              <button
                onClick={() => setFilterType("down")}
                disabled={scanning}
                className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                  filterType === "down"
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "bg-[var(--hover)] text-[var(--text)] hover:opacity-85 disabled:opacity-50"
                }`}
              >
                逆势下跌
              </button>
            </>
          )}
        </div>

        {/* 批量操作控制 */}
        <div className="flex items-center gap-2.5">
          {/* 并发数选择 */}
          <div className="flex items-center gap-1.5 border border-[var(--border)] px-2 py-1 bg-[var(--hover)] rounded-[2px] text-xs">
            <span className="text-[var(--muted)] font-mono uppercase tracking-wider text-[10px]">并发数:</span>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={scanning}
              className="bg-transparent border-none text-[var(--text)] font-semibold font-mono focus:outline-none cursor-pointer text-xs"
            >
              <option value={1} className="bg-[var(--surface)] text-[var(--text)]">1</option>
              <option value={3} className="bg-[var(--surface)] text-[var(--text)]">3</option>
              <option value={5} className="bg-[var(--surface)] text-[var(--text)]">5</option>
              <option value={8} className="bg-[var(--surface)] text-[var(--text)]">8 (可能排队)</option>
              <option value={10} className="bg-[var(--surface)] text-[var(--text)]">10 (可能排队)</option>
            </select>
          </div>

          <button
            onClick={() => fetchList(1)}
            disabled={scanning || loading}
            className="rounded-[2px] border border-[var(--border)] px-4 py-1.5 text-xs font-semibold tracking-wider text-[var(--text)] hover:bg-[var(--hover)] transition cursor-pointer disabled:opacity-50"
          >
            {isCustomMode ? "刷新行情" : "刷新榜单"}
          </button>
          <button
            onClick={handleSavePool}
            disabled={loading || savingPool || list.length === 0}
            title="把当前列表保存为命名股票池（落盘 .data/，可在「自选 / 收藏」管理）"
            className="rounded-[2px] border border-[var(--border)] px-4 py-1.5 text-xs font-semibold tracking-wider text-[var(--text)] hover:bg-[var(--hover)] transition cursor-pointer disabled:opacity-50"
          >
            {savingPool ? "保存中…" : "存为股票池"}
          </button>
          {!isCustomMode && (
            <button
              onClick={handleSyncRank}
              disabled={scanning || loading || syncingRank}
              title="同步人气榜并落盘版本化（供运营/LLM 使用）"
              className="rounded-[2px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-1.5 text-xs font-semibold tracking-wider text-[var(--accent)] hover:bg-[var(--hover)] transition cursor-pointer disabled:opacity-50"
            >
              {syncingRank ? "同步中…" : "同步榜单 🔥"}
            </button>
          )}
          {scanning ? (
            <button
              onClick={stopScanning}
              className="rounded-[2px] bg-red-600 px-4 py-1.5 text-xs font-semibold tracking-wider text-white hover:bg-red-700 transition cursor-pointer animate-pulse"
            >
              停止扫描 (分批中)
            </button>
          ) : (
            <button
              onClick={startScanning}
              disabled={loading || filteredList.length === 0}
              className="rounded-[2px] bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold tracking-wider text-[var(--accent-fg)] hover:opacity-90 transition cursor-pointer disabled:opacity-50"
            >
              一键扫描符合标的 (并发x{concurrency})
            </button>
          )}
        </div>

      </div>

      {/* 热门股表格渲染 */}
      {loading ? (
        <div className="py-12 text-center text-xs text-[var(--muted)] font-mono flex flex-col items-center justify-center gap-2">
          <span>LOADING REALTIME RANKING FROM EASTMONEY...</span>
          {hotRankRetryCount > 1 && (
            <span className="text-amber-500 animate-pulse">
              [正在重试: 第 {hotRankRetryCount}/10 次尝试...]
            </span>
          )}
        </div>
      ) : error ? (
        <div className="border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300 rounded-[2px] font-mono flex items-center justify-between">
          <span>ERROR: {error}</span>
          <button
            onClick={() => fetchList(1)}
            className="rounded-[2px] bg-red-950/40 hover:bg-red-950/60 border border-red-500/30 px-3 py-1 text-[10px] font-semibold text-red-200 transition cursor-pointer"
          >
            手动重试
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto border border-[var(--border)] rounded-[2px] bg-[var(--surface)]">
          <table className="w-full border-collapse text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--inset)] text-[var(--faint)] font-mono uppercase tracking-wider">
                <th className="px-4 py-3 font-semibold text-center w-12">热度</th>
                <th className="px-4 py-3 font-semibold">股票名称</th>
                <th className="px-4 py-3 font-semibold">证券代码</th>
                <th className="px-4 py-3 font-semibold text-right w-24">最新价</th>
                <th className="px-4 py-3 font-semibold text-right w-24">今日涨跌</th>
                <th className="px-4 py-3 font-semibold text-right w-24">换手率</th>
                <th className="px-4 py-3 font-semibold text-center w-24">Serenity 评分</th>
                <th className="px-4 py-3 font-semibold text-center w-28">买入决策</th>
                <th className="px-4 py-3 font-semibold text-center w-40">买卖区间建议</th>
                <th className="px-4 py-3 font-semibold text-center w-28">策略诊断</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-[var(--muted)] font-mono">
                    NO STOCKS MATCHING CURRENT FILTERS
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const state = assessments[item.code] || { status: "idle" };
                  const isExpanded = expandedCode === item.code;
                  const quoteUp = item.changePct >= 0;

                  return (
                    <Fragment key={item.code}>
                      {/* 股票主信息行 */}
                      <tr
                        className={`border-b border-[var(--border)] hover:bg-[var(--hover)] transition-colors ${
                          isExpanded ? "bg-[var(--inset)]" : ""
                        }`}
                      >
                        {/* 排名 */}
                        <td className="px-4 py-3 font-mono font-bold text-center text-[var(--faint)]">
                          {item.rank}
                        </td>
                        {/* 股票名 */}
                        <td className="px-4 py-3 font-bold text-[var(--text)]">
                          <span className="flex items-center gap-1.5">
                          <FavoriteButton code={item.code} name={item.name} />
                          <a
                            href={`/analyze?code=${item.code}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[var(--accent)] hover:underline flex items-center gap-1 group"
                          >
                            <span>{item.name}</span>
                            <svg
                              className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--accent)] inline-block shrink-0"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                          </span>
                        </td>
                        {/* 代码 */}
                        <td className="px-4 py-3 font-mono text-[var(--muted)]">
                          <a
                            href={`/chart?code=${item.code}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="看 K 线图"
                            className="hover:text-[var(--accent)] hover:underline"
                          >
                            {item.code}.{item.market}
                          </a>
                        </td>
                        {/* 最新价 */}
                        <td className="px-4 py-3 font-mono text-right font-semibold">
                          {item.price > 0 ? item.price.toFixed(2) : "-"}
                        </td>
                        {/* 涨跌幅 */}
                        <td
                          className={`px-4 py-3 font-mono text-right font-bold ${
                            quoteUp ? "text-red-500" : "text-emerald-500"
                          }`}
                        >
                          {quoteUp ? "+" : ""}
                          {item.changePct.toFixed(2)}%
                        </td>
                        {/* 换手率 */}
                        <td className="px-4 py-3 font-mono text-right text-[var(--muted)]">
                          {item.turnoverPct.toFixed(2)}%
                        </td>
                        {/* Serenity 得分 */}
                        <td className="px-4 py-3 text-center font-mono font-black">
                          {state.status === "done" && state.data ? (
                            <span className="text-[var(--accent)] text-sm">
                              {state.data.assessment.totalScore} 分
                            </span>
                          ) : (
                            <span className="text-[var(--faint)]">--</span>
                          )}
                        </td>
                        {/* 买入决策 */}
                        <td className="px-4 py-3 text-center">
                          {state.status === "done" && state.data ? (
                            state.data.assessment.recommendedBuy ? (
                              <span className="border border-[var(--accent)] text-[var(--accent)] bg-transparent px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider rounded-none">
                                推荐买入
                              </span>
                            ) : (
                              <span className="border border-[var(--border)] text-[var(--muted)] bg-transparent px-1.5 py-0.5 text-[8.5px] font-semibold tracking-wider rounded-none">
                                观望中
                              </span>
                            )
                          ) : (
                            <span className="text-[var(--faint)] font-mono">--</span>
                          )}
                        </td>
                        {/* 买卖区间建议 */}
                        <td className="px-4 py-3 text-center font-mono text-[10px] text-[var(--muted)]">
                          {state.status === "done" && state.data ? (
                            state.data.assessment.recommendedBuy ? (
                              <span>
                                {state.data.assessment.buyPriceRange || "-"} / {state.data.assessment.sellPriceRange || "-"}
                              </span>
                            ) : (
                              <span className="text-amber-500/80 font-medium cursor-help" title={state.data.assessment.thesis || "未达到 Serenity 策略的推荐买入标准，不提供具体买卖区间建议。"}>
                                {state.data.assessment.verdict || "未达买入条件(观望)"}
                              </span>
                            )
                          ) : (
                            <span className="text-[var(--faint)]">--</span>
                          )}
                        </td>
                        {/* 操作诊断按钮 */}
                        <td className="px-4 py-3 text-center">
                          {state.status === "loading" ? (
                            <span className="text-amber-500 font-mono text-[9px] tracking-wide animate-pulse block truncate max-w-[120px] mx-auto" title={state.stageMsg || "诊断中..."}>
                              {state.stageMsg || "诊断中..."}
                            </span>
                          ) : state.status === "error" ? (
                            <button
                              onClick={() => triggerSingleScan(item.code)}
                              className="text-red-400 font-semibold underline cursor-pointer"
                              title={state.errorMsg}
                            >
                              重试
                            </button>
                          ) : state.status === "done" ? (
                            <button
                              onClick={() => setExpandedCode(isExpanded ? null : item.code)}
                              className="text-[var(--accent)] font-semibold underline cursor-pointer"
                            >
                              {isExpanded ? "收起报告" : "展开评估"}
                            </button>
                          ) : (
                            <button
                              onClick={() => triggerSingleScan(item.code)}
                              disabled={scanning}
                              className="bg-[var(--hover)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)] rounded-[2px] px-2 py-1 text-[10px] font-semibold cursor-pointer transition disabled:opacity-50"
                            >
                              AI 诊断
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* 展开的 Bloomberg 投行报告卡片行 */}
                      {isExpanded && state.status === "done" && state.data && (
                        <tr className="bg-[var(--inset)]">
                          <td colSpan={10} className="px-6 py-5 border-b border-[var(--border)]">
                            <div className="grid grid-cols-[140px_1fr] gap-6 items-stretch">
                              
                              {/* 左侧：微小雷达图 */}
                              <div className="border border-[var(--border)] bg-[var(--surface)] p-2.5 flex items-center justify-center rounded-none w-[140px] h-[140px] shrink-0">
                                <RadarChart
                                  factors={state.data.assessment.factors.map((f) => ({
                                    label: FACTOR_LABELS[f.key] || f.key,
                                    score: f.score,
                                  }))}
                                  size={120}
                                />
                              </div>

                              {/* 右侧：完整打分内容 */}
                              <div className="flex flex-col justify-between space-y-4 min-w-0">
                                
                                {/* 决策印章与价格范围说明 */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-2.5">
                                  <div>
                                    {state.data.assessment.recommendedBuy ? (
                                      <span className="border-[1.5px] border-[var(--accent)] bg-transparent px-2 py-1 text-[10px] text-[var(--accent)] font-bold uppercase tracking-widest rounded-none">
                                        [RECOMMENDED BUY / 策略推荐买入]
                                      </span>
                                    ) : (
                                      <span className="border-[1.5px] border-[var(--border)] bg-transparent px-2 py-1 text-[10px] text-[var(--faint)] font-bold uppercase tracking-widest rounded-none">
                                        [HOLD & WATCH / 观望策略]
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex gap-4 font-mono text-[10px]">
                                    <div className="flex gap-1.5 items-center">
                                      <span className="text-[var(--faint)] uppercase">buy target:</span>
                                      <span className="text-[var(--text)] font-bold">{state.data.assessment.buyPriceRange || "暂无建议"}</span>
                                    </div>
                                    <div className="flex gap-1.5 items-center border-l border-[var(--border)] pl-4">
                                      <span className="text-[var(--faint)] uppercase">exit target:</span>
                                      <span className="text-[var(--text)] font-bold">{state.data.assessment.sellPriceRange || "暂无建议"}</span>
                                    </div>
                                    <div className="flex gap-1.5 items-center border-l border-[var(--border)] pl-4">
                                      <span className="text-[var(--faint)] uppercase">market cap:</span>
                                      <span className="text-[var(--text)] font-bold">{formatCap(state.data.quote.totalMarketCap)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* 因子打分依据细节 */}
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
                                  {state.data.assessment.factors.map((f) => (
                                    <div key={f.key} className="border border-[var(--border)] bg-[var(--surface)] p-2 rounded-none">
                                      <div className="flex justify-between items-center text-[9px] font-mono border-b border-[var(--border)] pb-1 mb-1">
                                        <span className="text-[var(--faint)] font-semibold">{FACTOR_LABELS[f.key]}</span>
                                        <span className="text-[var(--accent)] font-bold">{f.score} / 5</span>
                                      </div>
                                      <p className="text-[8.5px] text-[var(--muted)] leading-3.5 text-justify truncate-3-lines" title={f.rationale}>
                                        {f.rationale}
                                      </p>
                                    </div>
                                  ))}
                                </div>

                                {/* 核心金句、催化剂与风险双列排版 */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {/* 论述 */}
                                  <div className="border-l-[3px] border-l-[var(--accent)] bg-[var(--surface)] border border-[var(--border)] p-3 flex flex-col justify-center rounded-none">
                                    <span className="text-[7.5px] font-mono font-bold text-[var(--accent)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                                      INVESTMENT THESIS / 瓶颈核心论述
                                    </span>
                                    <p className="text-[9.5px] leading-4 text-[var(--text)] text-justify italic">
                                      {state.data.assessment.thesis}
                                    </p>
                                  </div>
                                  {/* 催化剂与风险 */}
                                  <div className="grid grid-cols-2 gap-3 min-w-0">
                                    <div className="border border-[var(--border)] bg-[var(--surface)] p-2.5 border-l-2 border-l-[var(--accent-line)] min-w-0">
                                      <span className="text-[7.5px] font-mono font-bold text-[var(--accent)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                                        CATALYSTS / 催化剂
                                      </span>
                                      <div className="space-y-0.5">
                                        {state.data.assessment.catalysts.slice(0, 2).map((item, idx) => (
                                          <div key={idx} className="flex gap-1 items-start text-[8px] leading-3 text-[var(--muted)]">
                                            <span className="font-mono text-[var(--accent)] font-semibold shrink-0">[0{idx + 1}]</span>
                                            <span className="truncate flex-1 min-w-0">{item}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="border border-[var(--border)] bg-[var(--surface)] p-2.5 border-l-2 border-l-[var(--warn-line)] min-w-0">
                                      <span className="text-[7.5px] font-mono font-bold text-[var(--warn)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                                        KEY RISKS / 风险点
                                      </span>
                                      <div className="space-y-0.5">
                                        {state.data.assessment.risks.slice(0, 2).map((item, idx) => (
                                          <div key={idx} className="flex gap-1 items-start text-[8px] leading-3 text-[var(--muted)]">
                                            <span className="font-mono text-[var(--warn)] font-semibold shrink-0">[0{idx + 1}]</span>
                                            <span className="truncate flex-1 min-w-0">{item}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Serenity 突破策略与筹码直方可视化图谱 */}
                                {state.data.quant && (
                                  <div className="border-t border-[var(--border)] pt-4 mt-2">
                                    <div className="flex justify-between items-center pb-2 mb-3">
                                      <div className="text-[9.5px] font-mono text-[var(--accent)] font-extrabold uppercase tracking-widest flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                                        [Serenity Quant Engine / 均线量化与筹码图谱诊断]
                                      </div>
                                      <a
                                        href={`/chart?code=${state.data.quote.code}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded-[2px] border border-[var(--border)] bg-[var(--inset)] hover:bg-[var(--hover)] px-2 py-0.5 text-[9px] font-semibold text-[var(--text)] transition flex items-center gap-1 font-mono cursor-pointer"
                                      >
                                        <svg className="w-3 h-3 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0l-6-6" />
                                        </svg>
                                        <span>Full chart</span>
                                      </a>
                                    </div>
                                    <QuantChart
                                      quantData={state.data.quant}
                                      currentPrice={state.data.quote.price}
                                    />
                                  </div>
                                )}

                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 免责申明 */}
      <div className="text-[10px] text-[var(--faint)] leading-4 font-mono uppercase tracking-wide">
        NOTICE: DATA IS EXTRACTED FROM EASTMONEY REALTIME FORUM AND STOCK GRAPHS. LLM ASSESSMENT AND SUGGESTED PRICE RANGES ARE GENERATED AUTOMATICALLY BY AI AND IN NO WAY CONSTITUTE FORMAL FINANCIAL ADVICE (NFA).
      </div>

    </div>
  );
}

export default function HotScannerPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-xs text-[var(--muted)] font-mono">LOADING PAGE CONTEXT...</div>}>
      <ScannerContent />
    </Suspense>
  );
}
