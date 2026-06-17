"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import RadarChart from "@/components/RadarChart";
import { readNdjson } from "@/lib/stream-client";

interface SectorItem {
  code: string;
  name: string;
  changePct: number;
  price: number;
  netInflow: number;
  riseCount: number;
  fallCount: number;
  leadStockName: string;
  leadStockCode: string;
  leadStockChangePct: number;
}

interface SectorStockItem {
  code: string;
  name: string;
  price: number;
  changePct: number;
  turnoverPct: number;
  market: "SH" | "SZ" | "BJ";
}

interface SectorAssessment {
  factors: Array<{ key: string; score: number; rationale: string }>;
  totalScore: number;
  verdict: string;
  thesis: string;
  chokepoints: string[];
  leaders: Array<{ code: string; name: string; role: string }>;
  risks: string[];
  catalysts: string[];
}

interface AIState {
  status: "idle" | "loading" | "done" | "error";
  stageMsg: string;
  logText: string;
  assessment: SectorAssessment | null;
  errorMsg: string;
}

const FACTOR_LABELS: Record<string, string> = {
  demand: "确定需求",
  supply: "受限供给",
  attention: "低关注度",
  valueCapture: "价值捕获",
  catalyst: "催化剂",
};

export default function SectorsPage() {
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  
  // 筛选与排序状态
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"changePct" | "netInflow" | "riseRatio">("changePct");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // 选中的板块
  const [selectedCode, setSelectedCode] = useState<string>("");
  const selectedSector = useMemo(() => {
    return sectors.find((s) => s.code === selectedCode) || null;
  }, [sectors, selectedCode]);

  // 板块右侧明细及选项卡
  const [activeTab, setActiveTab] = useState<"stocks" | "ai">("stocks");
  const [stocks, setStocks] = useState<SectorStockItem[]>([]);
  const [stocksLoading, setStocksLoading] = useState(false);

  // AI 诊断状态 (每个板块 code 独立缓存)
  const [aiCache, setAiCache] = useState<Record<string, AIState>>({});

  // 一键同步板块与成分股配置到本地
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/market/sync-sectors", { method: "POST" });
      if (!res.ok) {
        throw new Error(`同步请求失败，状态码: ${res.status}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert(`🎉 同步成功！共拉取 ${data.sectorsCount} 个板块及其成分股静态配置。`);
      await fetchSectors();
    } catch (err) {
      alert(`❌ 同步发生错误: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSyncing(false);
    }
  }

  // 1. 获取行业板块列表
  async function fetchSectors() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/market/sectors");
      if (!res.ok) {
        throw new Error(`获取数据异常: ${res.status}`);
      }
      const data = await res.json();
      const list = data.list ?? [];
      setSectors(list);
      // 默认选中第一个板块
      if (list.length > 0 && !selectedCode) {
        setSelectedCode(list[0].code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取板块列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSectors();
  }, []);

  // 2. 切换板块时，自动加载其成分股
  useEffect(() => {
    if (!selectedCode) return;
    
    // 切换板块时重置成分股
    setStocks([]);
    setStocksLoading(true);

    let isCurrent = true;
    fetch(`/api/market/sector-stocks?code=${selectedCode}`)
      .then((res) => {
        if (!res.ok) throw new Error("获取成分股失败");
        return res.json();
      })
      .then((data) => {
        if (isCurrent) {
          setStocks(data.list ?? []);
          setStocksLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (isCurrent) {
          setStocksLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedCode]);

  // 3. 执行 AI 板块研判
  async function runAISectorAnalyze(code: string, name: string) {
    if (aiCache[code]?.status === "loading") return;

    // 初始化状态
    setAiCache((prev) => ({
      ...prev,
      [code]: {
        status: "loading",
        stageMsg: "获取板块行情...",
        logText: "",
        assessment: null,
        errorMsg: "",
      },
    }));

    try {
      const res = await fetch("/api/analyze/sector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name }),
      });

      if (!res.ok) {
        throw new Error(`分析请求错误: ${res.status}`);
      }

      if (!(res.headers.get("content-type") || "").includes("ndjson")) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "研判服务返回异常");
      }

      let assessment: SectorAssessment | null = null;
      let logBuffer = "";
      let lastUpdateTime = 0;

      await readNdjson(res, (ev: any) => {
        const now = Date.now();
        
        if (ev.type === "stage") {
          let msg = "";
          if (ev.key === "quote" && ev.status === "start") msg = "整合行情与代表股中...";
          else if (ev.key === "reason" && ev.status === "start") msg = "AI 板块瓶颈产业链分析中...";
          else if (ev.key === "summary" && ev.status === "start") msg = "正在解析生成 Serenity 核心诊断指标...";
          
          if (msg) {
            setAiCache((prev) => ({
              ...prev,
              [code]: {
                ...prev[code],
                stageMsg: msg,
              },
            }));
          }
        } else if (ev.type === "token") {
          if (ev.kind === "content" || ev.kind === "reasoning") {
            logBuffer += ev.text || "";
            // 限流更新日志文本，避免频繁渲染导致页面假死
            if (now - lastUpdateTime > 200) {
              lastUpdateTime = now;
              setAiCache((prev) => ({
                ...prev,
                [code]: {
                  ...prev[code],
                  logText: logBuffer,
                },
              }));
            }
          }
        } else if (ev.type === "result") {
          assessment = ev.assessment as SectorAssessment;
        } else if (ev.type === "error") {
          throw new Error(ev.message || "流解析错误");
        }
      });

      setAiCache((prev) => ({
        ...prev,
        [code]: {
          ...prev[code],
          status: "done",
          stageMsg: "评估完成",
          logText: logBuffer,
          assessment,
        },
      }));

    } catch (err) {
      const msg = err instanceof Error ? err.message : "研判失败";
      setAiCache((prev) => ({
        ...prev,
        [code]: {
          ...prev[code],
          status: "error",
          stageMsg: "诊断出错",
          errorMsg: msg,
        },
      }));
    }
  }

  // 4. 排序与筛选计算
  const processedSectors = useMemo(() => {
    // 搜索过滤
    const list = sectors.filter((s) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      return s.name.toLowerCase().includes(query) || s.code.toLowerCase().includes(query);
    });

    // 排序
    list.sort((a, b) => {
      let valA = 0;
      let valB = 0;

      if (sortBy === "changePct") {
        valA = a.changePct;
        valB = b.changePct;
      } else if (sortBy === "netInflow") {
        valA = a.netInflow;
        valB = b.netInflow;
      } else if (sortBy === "riseRatio") {
        const totalA = a.riseCount + a.fallCount || 1;
        const totalB = b.riseCount + b.fallCount || 1;
        valA = a.riseCount / totalA;
        valB = b.riseCount / totalB;
      }

      if (sortOrder === "desc") {
        return valB - valA;
      } else {
        return valA - valB;
      }
    });

    return list;
  }, [sectors, searchQuery, sortBy, sortOrder]);

  // 格式化大数值为中文单位
  const formatNetInflow = (n: number) => {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e8) {
      return `${sign}${(abs / 1e8).toFixed(2)} 亿`;
    }
    if (abs >= 1e4) {
      return `${sign}${(abs / 1e4).toFixed(2)} 万`;
    }
    return `${sign}${abs}`;
  };

  // 5. 根据涨跌幅获取热力图块颜色
  const getHeatColorClass = (pct: number) => {
    if (pct >= 4.0) return "bg-red-950/80 border-red-500/70 text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.2)]";
    if (pct >= 2.0) return "bg-red-900/40 border-red-500/40 text-red-300";
    if (pct > 0.0) return "bg-red-950/20 border-red-500/20 text-red-400";
    if (pct === 0) return "bg-[var(--surface)] border-[var(--border)] text-[var(--muted)]";
    if (pct > -2.0) return "bg-emerald-950/20 border-emerald-500/20 text-emerald-400";
    if (pct > -4.0) return "bg-emerald-900/40 border-emerald-500/40 text-emerald-300";
    return "bg-emerald-950/80 border-emerald-500/70 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.2)]";
  };

  // 6. 一键跳转个股并发诊断
  const handleBulkScan = () => {
    if (!selectedSector || stocks.length === 0) return;
    const codes = stocks.map((s) => s.code).join(",");
    const url = `/scanner?codes=${codes}&title=${encodeURIComponent(selectedSector.name)}`;
    window.open(url, "_blank");
  };

  const currentAI = aiCache[selectedCode] || {
    status: "idle",
    stageMsg: "",
    logText: "",
    assessment: null,
    errorMsg: "",
  };

  return (
    <div className="space-y-6">
      {/* 头部标题区 */}
      <div className="border-b border-[var(--border)] pb-3">
        <h1 className="text-xl font-bold tracking-wider font-mono">
          SERENITY SECTOR HEATMAP / 行业板块热力评估系统
        </h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          自底向上穿透：以红绿冷暖色标绘 A 股 100 个核心行业，结合 Serenity 瓶颈点多因子理论，透视成分股，实现板块级 AI 研判。
        </p>
      </div>

      {/* 核心控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border)] bg-[var(--surface)] p-3 rounded-[2px]">
        {/* 搜索与过滤 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <svg className="w-3.5 h-3.5 text-[var(--faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="搜索板块代码/名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 text-xs rounded-[2px] bg-[var(--inset)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono w-52"
            />
          </div>

          {/* 排序属性 */}
          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[2px] text-[11px] font-semibold">
            <button
              onClick={() => setSortBy("changePct")}
              className={`px-3 py-1 cursor-pointer transition rounded-[1px] ${
                sortBy === "changePct" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              涨跌幅
            </button>
            <button
              onClick={() => setSortBy("netInflow")}
              className={`px-3 py-1 cursor-pointer transition rounded-[1px] ${
                sortBy === "netInflow" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              主力净流入
            </button>
            <button
              onClick={() => setSortBy("riseRatio")}
              className={`px-3 py-1 cursor-pointer transition rounded-[1px] ${
                sortBy === "riseRatio" ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              上涨率
            </button>
          </div>

          {/* 排序方向 */}
          <button
            onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
            className="p-1 cursor-pointer border border-[var(--border)] bg-[var(--inset)] rounded-[2px] text-[var(--text)] hover:bg-[var(--hover)]"
            title={sortOrder === "desc" ? "当前降序" : "当前升序"}
          >
            {sortOrder === "desc" ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v10.5" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m1.5-4.5L18 12.75m0 0L21.75 9M18 12.75V2.25" />
              </svg>
            )}
          </button>
        </div>

        {/* 数据同步与布局切换 */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-3 py-1 cursor-pointer rounded-[2px] text-xs font-semibold font-mono tracking-wider transition ${
              syncing
                ? "bg-[var(--hover)] text-[var(--faint)] border border-[var(--border)] animate-pulse cursor-not-allowed"
                : "bg-[var(--accent-soft)] hover:bg-[var(--hover)] text-[var(--accent)] border border-[var(--accent-line)]"
            }`}
          >
            {syncing ? "同步中..." : "数据同步 🔄"}
          </button>

          <div className="flex bg-[var(--inset)] border border-[var(--border)] p-0.5 rounded-[2px]">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1 cursor-pointer rounded-[1px] ${
                viewMode === "grid" ? "bg-[var(--hover)] text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
              title="网格热力图"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1 cursor-pointer rounded-[1px] ${
                viewMode === "list" ? "bg-[var(--hover)] text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
              title="列表明细"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12M8.25 17.25h12M3 6.75h.008v.008H3V6.75zm0 5.25h.008v.008H3V12zm0 5.25h.008v.008H3v-.008z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 双栏主工作区 */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* 左侧热力面板 */}
        <div className="lg:col-span-7 space-y-4">
          {loading ? (
            <div className="border border-[var(--border)] rounded-[2px] bg-[var(--surface)] p-8 text-center text-[var(--muted)]">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-[var(--accent)] border-t-transparent mb-2" />
              <div className="text-xs font-mono">载入行业行情数据中...</div>
            </div>
          ) : error ? (
            <div className="border border-red-500/20 bg-red-950/20 text-red-400 p-4 rounded-[2px] text-xs font-mono text-center">
              {error}
              <button onClick={fetchSectors} className="ml-3 underline cursor-pointer text-red-300">重新加载</button>
            </div>
          ) : (
            <>
              {viewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {processedSectors.map((item) => {
                    const isSelected = item.code === selectedCode;
                    const riseRatio = item.riseCount / (item.riseCount + item.fallCount || 1);
                    return (
                      <div
                        key={item.code}
                        onClick={() => setSelectedCode(item.code)}
                        className={`border cursor-pointer p-2 rounded-[1px] transition-all hover:scale-[1.02] flex flex-col justify-between h-20 ${getHeatColorClass(
                          item.changePct
                        )} ${isSelected ? "ring-1 ring-[var(--accent)] border-[var(--accent)] scale-[1.02]" : ""}`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-[11.5px] truncate max-w-[75%]" title={item.name}>
                            {item.name}
                          </span>
                          <span className="font-mono font-bold text-[10px] shrink-0">
                            {item.changePct >= 0 ? "+" : ""}
                            {item.changePct.toFixed(2)}%
                          </span>
                        </div>

                        <div className="flex justify-between items-end text-[9px] text-white/50 font-mono mt-1">
                          <div className="truncate max-w-[55%]">
                            领涨: <span className="font-semibold">{item.leadStockName}</span>
                          </div>
                          <div>
                            比: <span className="font-semibold text-white/70">{Math.round(riseRatio * 100)}%涨</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {processedSectors.length === 0 && (
                    <div className="col-span-full border border-[var(--border)] rounded-[2px] bg-[var(--surface)] p-8 text-center text-xs text-[var(--muted)] font-mono">
                      未找到匹配的行业板块
                    </div>
                  )}
                </div>
              ) : (
                <div className="border border-[var(--border)] bg-[var(--surface)] rounded-[2px] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[var(--inset)] text-[var(--muted)] border-b border-[var(--border)]">
                        <tr>
                          <th className="px-3 py-2 text-center w-12">排名</th>
                          <th className="px-3 py-2">板块名称</th>
                          <th className="px-3 py-2 text-right">指数最新价</th>
                          <th className="px-3 py-2 text-right">涨跌幅</th>
                          <th className="px-3 py-2 text-right">主力净流入</th>
                          <th className="px-3 py-2 text-right">领涨股</th>
                          <th className="px-3 py-2 text-center">上涨/下跌</th>
                        </tr>
                      </thead>
                      <tbody>
                        {processedSectors.map((item, idx) => {
                          const isSelected = item.code === selectedCode;
                          const up = item.changePct >= 0;
                          return (
                            <tr
                              key={item.code}
                              onClick={() => setSelectedCode(item.code)}
                              className={`border-b border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer ${
                                isSelected ? "bg-[var(--inset)] text-[var(--accent)] font-semibold" : "text-[var(--text)]"
                              }`}
                            >
                              <td className="px-3 py-2.5 text-center text-[var(--faint)]">{idx + 1}</td>
                              <td className="px-3 py-2.5 font-bold">{item.name}</td>
                              <td className="px-3 py-2.5 text-right">{item.price.toFixed(1)}</td>
                              <td className={`px-3 py-2.5 text-right font-bold ${up ? "text-red-500" : "text-emerald-500"}`}>
                                {up ? "+" : ""}
                                {item.changePct.toFixed(2)}%
                              </td>
                              <td className={`px-3 py-2.5 text-right ${item.netInflow >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                                {formatNetInflow(item.netInflow)}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                {item.leadStockName}{" "}
                                <span className={item.leadStockChangePct >= 0 ? "text-red-500" : "text-emerald-500"}>
                                  ({item.leadStockChangePct >= 0 ? "+" : ""}
                                  {item.leadStockChangePct.toFixed(1)}%)
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center text-[var(--muted)]">
                                <span className="text-red-500">{item.riseCount}</span>/
                                <span className="text-emerald-500">{item.fallCount}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 右侧明细面板 */}
        <div className="lg:col-span-5 space-y-4">
          {selectedSector ? (
            <div className="border border-[var(--border)] bg-[var(--surface)] p-4 rounded-[2px] space-y-4">
              {/* 板块快照 */}
              <div className="flex justify-between items-start border-b border-[var(--border)] pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-md font-bold text-[var(--text)]">{selectedSector.name}</h2>
                    <span className="text-[10px] font-mono text-[var(--faint)] bg-[var(--inset)] px-1.5 py-0.5 rounded-[1px]">
                      {selectedSector.code}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)] font-mono">
                    上涨家数: <span className="text-red-500 font-bold">{selectedSector.riseCount}</span> | 下跌家数:{" "}
                    <span className="text-emerald-500 font-bold">{selectedSector.fallCount}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-md font-mono font-black ${selectedSector.changePct >= 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {selectedSector.changePct >= 0 ? "+" : ""}
                    {selectedSector.changePct.toFixed(2)}%
                  </div>
                  <div className={`text-[10.5px] font-mono mt-0.5 ${selectedSector.netInflow >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                    主力: {formatNetInflow(selectedSector.netInflow)}
                  </div>
                </div>
              </div>

              {/* 标签页导航 */}
              <div className="flex border-b border-[var(--border)] text-xs">
                <button
                  onClick={() => setActiveTab("stocks")}
                  className={`flex-1 pb-2 font-bold transition-all border-b-2 cursor-pointer ${
                    activeTab === "stocks"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  板块成分股 ({stocks.length})
                </button>
                <button
                  onClick={() => setActiveTab("ai")}
                  className={`flex-1 pb-2 font-bold transition-all border-b-2 cursor-pointer ${
                    activeTab === "ai"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  Serenity AI 瓶颈评估 ⚡
                </button>
              </div>

              {/* 标签页内容 */}
              {activeTab === "stocks" ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-[var(--faint)] font-mono">展示成分股前 50 只（按涨幅排序）</span>
                    <button
                      onClick={handleBulkScan}
                      disabled={stocks.length === 0 || stocksLoading}
                      className="px-2.5 py-1 text-[11px] font-bold bg-[var(--accent)] text-[var(--accent-fg)] rounded-[1px] hover:opacity-90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      ⚡ 一键并发诊断成份股
                    </button>
                  </div>

                  {stocksLoading ? (
                    <div className="py-8 text-center text-xs text-[var(--muted)] font-mono">
                      <div className="inline-block animate-spin rounded-full h-4.5 w-4.5 border-2 border-[var(--accent)] border-t-transparent mb-1.5" />
                      <div>载入成分股列表中...</div>
                    </div>
                  ) : stocks.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--muted)] font-mono border border-[var(--border)] bg-[var(--inset)] rounded-[1px]">
                      无可用的成分股数据
                    </div>
                  ) : (
                    <div className="max-h-[360px] overflow-y-auto border border-[var(--border)] rounded-[1px]">
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead className="bg-[var(--inset)] text-[var(--muted)] border-b border-[var(--border)] sticky top-0">
                          <tr>
                            <th className="px-2.5 py-1.5">股票名</th>
                            <th className="px-2.5 py-1.5 text-right">最新价</th>
                            <th className="px-2.5 py-1.5 text-right">涨跌幅</th>
                            <th className="px-2.5 py-1.5 text-right">换手率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stocks.map((s) => {
                            const up = s.changePct >= 0;
                            return (
                              <tr key={s.code} className="border-b border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                                <td className="px-2.5 py-2">
                                  <a
                                    href={`/analyze?code=${s.code}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold text-[var(--text)] hover:text-[var(--accent)] hover:underline flex items-center gap-1"
                                  >
                                    <span>{s.name}</span>
                                    <span className="text-[9px] text-[var(--faint)] font-normal">({s.code})</span>
                                  </a>
                                </td>
                                <td className="px-2.5 py-2 text-right">{s.price.toFixed(2)}</td>
                                <td className={`px-2.5 py-2 text-right font-bold ${up ? "text-red-500" : "text-emerald-500"}`}>
                                  {up ? "+" : ""}
                                  {s.changePct.toFixed(2)}%
                                </td>
                                <td className="px-2.5 py-2 text-right text-[var(--muted)]">{s.turnoverPct.toFixed(2)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                // AI 板块研判
                <div className="space-y-4">
                  {currentAI.status === "idle" && (
                    <div className="text-center py-12 border border-dashed border-[var(--border)] bg-[var(--inset)] rounded-[2px]">
                      <p className="text-xs text-[var(--muted)]">尚未对该行业板块发起评估</p>
                      <button
                        onClick={() => runAISectorAnalyze(selectedSector.code, selectedSector.name)}
                        className="mt-3 px-4 py-2 text-xs font-bold bg-[var(--accent)] text-[var(--accent-fg)] rounded-[2px] hover:opacity-95 cursor-pointer shadow-md"
                      >
                        开启 AI 瓶颈研判 ⚡
                      </button>
                    </div>
                  )}

                  {currentAI.status === "loading" && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-[var(--accent)] font-bold animate-pulse">⚡ {currentAI.stageMsg}</span>
                        <span className="text-[var(--muted)] font-mono text-[10px]">分析可能耗时 30-50 秒</span>
                      </div>
                      
                      {/* 流式终端日志盒 */}
                      <div className="h-[250px] overflow-y-auto p-3 bg-black border border-neutral-800 rounded-[2px] text-[10.5px] font-mono text-emerald-500/90 whitespace-pre-wrap leading-relaxed shadow-inner">
                        {currentAI.logText}
                        <span className="inline-block w-1.5 h-3.5 bg-emerald-400 animate-ping ml-1" />
                      </div>
                    </div>
                  )}

                  {currentAI.status === "error" && (
                    <div className="border border-red-500/20 bg-red-950/20 text-red-400 p-4 rounded-[2px] text-xs font-mono space-y-2">
                      <div className="font-bold">❌ 评估接口出错：</div>
                      <div>{currentAI.errorMsg}</div>
                      <button
                        onClick={() => runAISectorAnalyze(selectedSector.code, selectedSector.name)}
                        className="mt-2 px-3 py-1 bg-red-800 text-white rounded-[1px] hover:opacity-90 font-sans font-semibold cursor-pointer"
                      >
                        重试研判
                      </button>
                    </div>
                  )}

                  {currentAI.status === "done" && currentAI.assessment && (
                    <div className="space-y-5 animate-fade-in text-xs">
                      {/* 研判结论与 Thesis */}
                      <div className="border border-[var(--border)] bg-[var(--inset)] p-3 rounded-[2px] space-y-2 relative overflow-hidden">
                        {/* 极光背景装饰 */}
                        <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--accent-soft)] rounded-full blur-2xl opacity-40 -mr-8 -mt-8 pointer-events-none" />
                        
                        <div className="flex justify-between items-center">
                          <span className="text-[var(--faint)] font-mono text-[10px]">SERENITY VERDICT</span>
                          <span className="px-2 py-0.5 font-bold tracking-wider rounded-[1px] bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] text-[10px]">
                            {currentAI.assessment.verdict}
                          </span>
                        </div>
                        <p className="font-semibold text-[var(--text)] leading-relaxed italic text-[11.5px]">
                          “ {currentAI.assessment.thesis} ”
                        </p>
                        <div className="text-[10px] text-[var(--muted)] font-mono flex justify-between items-center pt-1 border-t border-dashed border-[var(--border)]">
                          <span>瓶颈综合得分:</span>
                          <span className="text-md text-[var(--accent-strong)] font-black">{currentAI.assessment.totalScore.toFixed(2)} / 5.0</span>
                        </div>
                      </div>

                      {/* 雷达图与因子分析 */}
                      <div className="grid gap-4 sm:grid-cols-12 items-center">
                        <div className="sm:col-span-5 shrink-0">
                          <RadarChart
                            size={160}
                            factors={currentAI.assessment.factors.map((f) => ({
                              label: FACTOR_LABELS[f.key] || f.key,
                              score: f.score,
                            }))}
                          />
                        </div>
                        <div className="sm:col-span-7 space-y-2">
                          {currentAI.assessment.factors.map((f) => (
                            <div key={f.key} className="space-y-0.5">
                              <div className="flex justify-between text-[10px]">
                                <span className="font-semibold text-[var(--text)]">{FACTOR_LABELS[f.key] || f.key}</span>
                                <span className="font-mono text-[var(--muted)]">{f.score.toFixed(1)}</span>
                              </div>
                              <div className="h-1 bg-[var(--inset)] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[var(--accent)] transition-all duration-500"
                                  style={{ width: `${(f.score / 5) * 100}%` }}
                                />
                              </div>
                              <p className="text-[9.5px] text-[var(--muted)] leading-normal truncate" title={f.rationale}>
                                {f.rationale}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 卡脖子 BOM 节点 */}
                      {currentAI.assessment.chokepoints && currentAI.assessment.chokepoints.length > 0 && (
                        <div className="space-y-1.5">
                          <h4 className="font-bold text-[var(--text)] flex items-center gap-1.5">
                            <span className="w-1 h-3 bg-[var(--accent)]" />
                            产业卡脖子 BOM 环节
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {currentAI.assessment.chokepoints.map((cp, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 bg-[var(--hover)] border border-[var(--border)] text-[var(--text)] text-[10.5px] rounded-[1px] font-semibold"
                              >
                                {cp}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 板块潜力核心股 */}
                      {currentAI.assessment.leaders && currentAI.assessment.leaders.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="font-bold text-[var(--text)] flex items-center gap-1.5">
                            <span className="w-1 h-3 bg-[var(--accent)]" />
                            代表性龙头与潜力瓶颈标的
                          </h4>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {currentAI.assessment.leaders.map((lead, idx) => (
                              <div key={idx} className="border border-[var(--border)] bg-[var(--inset)] p-2 rounded-[1px] flex flex-col justify-between">
                                <div className="flex justify-between items-center border-b border-dashed border-[var(--border)] pb-1 mb-1">
                                  <a
                                    href={`/analyze?code=${lead.code}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold text-[var(--text)] hover:text-[var(--accent)] hover:underline"
                                  >
                                    {lead.name}
                                  </a>
                                  <span className="font-mono text-[9px] text-[var(--faint)]">{lead.code}</span>
                                </div>
                                <p className="text-[10px] text-[var(--muted)] leading-relaxed">{lead.role}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 催化剂与风险 */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {currentAI.assessment.catalysts && currentAI.assessment.catalysts.length > 0 && (
                          <div className="space-y-1.5">
                            <h4 className="font-bold text-[var(--text)] flex items-center gap-1 text-red-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                              行业催化剂
                            </h4>
                            <ul className="list-disc pl-4 space-y-1 text-[10px] text-[var(--muted)] leading-relaxed">
                              {currentAI.assessment.catalysts.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {currentAI.assessment.risks && currentAI.assessment.risks.length > 0 && (
                          <div className="space-y-1.5">
                            <h4 className="font-bold text-[var(--text)] flex items-center gap-1 text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              主要投资风险
                            </h4>
                            <ul className="list-disc pl-4 space-y-1 text-[10px] text-[var(--muted)] leading-relaxed">
                              {currentAI.assessment.risks.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* 底部重试按钮 */}
                      <div className="text-right">
                        <button
                          onClick={() => runAISectorAnalyze(selectedSector.code, selectedSector.name)}
                          className="px-2 py-1 border border-[var(--border)] hover:bg-[var(--hover)] font-semibold text-[10px] text-[var(--muted)] cursor-pointer transition rounded-[1px]"
                        >
                          重新分析 ⚡
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="border border-[var(--border)] rounded-[2px] bg-[var(--surface)] p-12 text-center text-[var(--muted)] font-mono text-xs">
              请选择一个行业板块以查看成分股及 Serenity AI 瓶颈评估
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
