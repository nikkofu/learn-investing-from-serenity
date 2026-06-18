"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { ChokepointAssessment, StockQuote, StockSearchResult } from "@/lib/types";
import { readNdjson } from "@/lib/stream-client";
import QuantChart from "@/components/QuantChart";
import RadarChart from "@/components/RadarChart";

interface AnalyzeResponse {
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
  matchedKnowledge?: {
    themeName: string;
    themeThesis: string;
    tweets: { date: string; text: string }[];
  } | null;
  quant?: any;
}

const FACTOR_LABELS: Record<string, string> = {
  demand: "确定需求",
  supply: "受限供给",
  attention: "低关注度",
  valueCapture: "价值捕获",
  catalyst: "催化剂",
};

function ChartInner() {
  const params = useSearchParams();
  const router = useRouter();
  
  const [codeQuery, setCodeQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  
  // AI 后台加载状态
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStageMsg, setAiStageMsg] = useState("");
  const [aiLogText, setAiLogText] = useState("");
  const [aiError, setAiError] = useState("");

  // UI 交互控制
  const [activeTab, setActiveTab] = useState<"ai" | "trades" | "terminal">("ai");
  const [chartHeight, setChartHeight] = useState(520);
  const [period, setPeriod] = useState<"1D" | "1W" | "1M">("1D");
  
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // 推理日志流式输出时自动滚动到底部
  useEffect(() => {
    if (activeTab === "terminal" && aiLoading) {
      if (terminalRef.current) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
      }
      if (sidebarRef.current) {
        sidebarRef.current.scrollTop = sidebarRef.current.scrollHeight;
      }
    }
  }, [aiLogText, aiLoading, activeTab]);

  // 动态监听视口高度，计算最适宜的 K 线高度
  useEffect(() => {
    function handleResize() {
      if (typeof window !== "undefined") {
        // 全屏模式下，K线图占满除顶部工具栏和padding外的全部高度
        const availableHeight = window.innerHeight - 90;
        setChartHeight(Math.max(380, Math.floor(availableHeight)));
      }
    }
    
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 执行核心诊断与图表数据载入 (并行优化：行情秒开 + AI 诊断后台同时并发)
  async function loadStock(code: string, currentPeriod = period) {
    if (!/^\d{6}$/.test(code)) return;
    setLoading(true);
    setError("");
    setData(null);
    setSearchResults([]);
    setAiLoading(false);
    setAiStageMsg("");
    setAiLogText("");
    setAiError("");
    
    // 同时并发发起行情基础数据与 AI 诊断请求，互不阻塞
    const chartPromise = fetch(`/api/market/chart-data?code=${code}&period=${currentPeriod}`);
    const aiPromise = fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    // 阶段1：优先 await 轻量行情数据（~300ms），立即渲染 K 线首屏
    try {
      const chartRes = await chartPromise;
      if (!chartRes.ok) {
        throw new Error(`基础行情拉取错误: ${chartRes.status}`);
      }
      const chartJson = await chartRes.json();
      if (chartJson.error) {
        throw new Error(chartJson.error);
      }
      
      // 立即渲染 K 线图表与指标，隐藏大 loading 圈
      setData({
        quote: chartJson.quote,
        stats: chartJson.stats,
        assessment: {
          factors: [],
          totalScore: 0,
          verdict: "AI诊断中...",
          thesis: "Serenity AI 正在深度研判该板块产业链与瓶颈中...",
          recommendedBuy: false,
          buyPriceRange: "",
          sellPriceRange: "",
          catalysts: [],
          risks: [],
          workflowSteps: [],
          bomPosition: null,
        },
        quant: chartJson.quant,
      });
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "载入行情失败，请重试");
      setLoading(false);
      return;
    }

    // 阶段2：行情已秒开渲染，现在开始消费 AI 诊断流（此请求已与行情同时发出，大幅缩短等待时间）
    setAiLoading(true);
    setAiStageMsg("启动 AI 瓶颈点打分分析...");
    setActiveTab("terminal"); // 自动选定终端显示推理过程
    try {
      const aiRes = await aiPromise;

      if (!(aiRes.headers.get("content-type") || "").includes("ndjson")) {
        const json = await aiRes.json().catch(() => ({}));
        throw new Error(json.error || "大模型评估服务连接失败");
      }

      let gotResult = false;
      let streamError = "";
      let logBuffer = "";
      let lastUpdateTime = 0;

      await readNdjson(aiRes, (ev) => {
        const now = Date.now();
        switch (ev.type as string) {
          case "stage":
            let msg = "";
            if (ev.key === "quote" && ev.status === "start") msg = "整理最新价格指标与资金面数据...";
            else if (ev.key === "reason" && ev.status === "start") msg = "AI 以六步工作流对主营产业链进行瓶颈研判中...";
            else if (ev.key === "summary" && ev.status === "start") msg = "正在解析并生成结构化打分卡...";
            if (msg) setAiStageMsg(msg);
            break;
          case "token":
            if (ev.kind === "content" || ev.kind === "reasoning") {
              logBuffer += ev.text || "";
              if (now - lastUpdateTime > 200) {
                lastUpdateTime = now;
                setAiLogText(logBuffer);
              }
            }
            break;
          case "result":
            // 收到完整 AI 分析报告后，将打分、投资评级、以及依据最终 AI 分数计算好的 projections 注入数据状态
            setData((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                assessment: ev.assessment as ChokepointAssessment,
                quant: ev.quant,
                matchedKnowledge: ev.matchedKnowledge as any,
              };
            });
            gotResult = true;
            setActiveTab("ai"); // 推理完成后自动切换回 AI 诊断面板
            break;
          case "error":
            streamError = ev.message as string;
            break;
        }
      });

      if (streamError) throw new Error(streamError);
      if (!gotResult) throw new Error("AI 分析未返回最终评估打分");
      setAiLoading(false);
    } catch (err) {
      console.error(err);
      setAiError(err instanceof Error ? err.message : "AI 评估中断");
      setAiLoading(false);
    }
  }

  // 初始化代码载入
  useEffect(() => {
    const code = params.get("code") || "300308"; // 默认中际旭创
    setCodeQuery(code);
    loadStock(code, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // 搜索框防抖
  function onSearchChange(v: string) {
    setCodeQuery(v);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (v.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(v.trim())}`);
        const json = await res.json();
        setSearchResults(json.results || []);
      } catch {
        setSearchResults([]);
      }
    }, 250);
  }

  // 切换个股
  function handleSelectStock(selectedCode: string) {
    setCodeQuery(selectedCode);
    setSearchResults([]);
    setSearchFocused(false);
    router.replace(`/chart?code=${selectedCode}`);
  }

  // 键盘快捷键监听：未处于输入状态时直接键入字符，自动聚焦搜索框
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }

      // 仅针对单字符的字母和数字响应聚焦
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        const searchInput = document.querySelector('input[placeholder*="搜索"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const up = data ? data.quote.changePct >= 0 : true;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] text-[var(--text)] font-sans overflow-hidden select-none">
      
      {/* 顶部 TradingView 极简自适应工具栏 */}
      <header className="h-[48px] bg-[var(--surface)] border-b border-[var(--border)] px-3 flex items-center justify-between shrink-0">
        
        {/* 左侧：搜索与切换 */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="text"
              value={codeQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && /^\d{6}$/.test(codeQuery.trim())) {
                  handleSelectStock(codeQuery.trim());
                }
              }}
              placeholder="🔍 搜索个股代码/名称..."
              className="bg-[var(--bg)] border border-[var(--border)] text-xs px-2.5 py-1 w-48 rounded-[2px] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono placeholder:text-[var(--faint)]"
            />
            
            {/* 搜索结果浮层 */}
            {searchFocused && searchResults.length > 0 && (
              <div className="absolute left-0 mt-1 w-64 bg-[var(--popover-bg)] border border-[var(--border)] z-50 max-h-60 overflow-y-auto rounded-[2px] shadow-2xl">
                {searchResults.map((r) => (
                  <button
                    key={`${r.code}-${r.market}`}
                    onMouseDown={() => handleSelectStock(r.code)}
                    className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-[var(--hover)] flex items-center justify-between border-b border-[var(--border)]"
                  >
                    <span className="font-bold text-[var(--text)]">{r.name}</span>
                    <span className="text-[var(--faint)]">{r.code}.{r.market}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 周期切换按钮 */}
          <div className="flex items-center gap-1 border-l border-[var(--border)] pl-3 ml-1">
            {(["1D", "1W", "1M"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  const code = data?.quote.code || params.get("code") || "300308";
                  loadStock(code, p);
                }}
                className={`px-2 py-0.5 text-[10px] font-bold font-mono rounded-[1px] transition cursor-pointer ${
                  period === p
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {p === "1D" ? "日线" : p === "1W" ? "周线" : "月线"}
              </button>
            ))}
          </div>

          {data && (
            <div className="flex items-baseline gap-2 border-l border-[var(--border)] pl-3">
              <span className="text-xs font-bold text-[var(--text)] font-mono">{data.quote.name}</span>
              <span className="text-[10px] font-mono text-[var(--muted)]">{data.quote.code}</span>
              <span className="text-xs font-black font-mono ml-1">{data.quote.price.toFixed(2)}</span>
              <span className={`text-[10px] font-mono font-bold ${up ? "text-red-500" : "text-emerald-500"}`}>
                {up ? "+" : ""}{data.quote.changePct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* 右侧：功能控制及关闭 */}
        <div className="flex items-center gap-3">
          <a
            href={data ? `/analyze?code=${data.quote.code}` : "/analyze"}
            className="px-3 py-1 border border-[var(--border)] bg-[var(--hover)] hover:bg-[var(--border)] text-xs font-bold text-[var(--text)] rounded-[2px] transition flex items-center gap-1"
          >
            <span>返回分析 ↵</span>
          </a>
        </div>
      </header>

      {/* 主画布与边栏分割 */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* 左侧大图表工作区 */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg)] p-3">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] font-mono text-xs">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-[var(--accent)] border-t-transparent mb-3" />
              <div>极速载入全画幅行情与均线筹码指标...</div>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-red-400 font-mono text-xs p-6 text-center">
              <div>❌ {error}</div>
              <button
                onClick={() => data?.quote.code && loadStock(data.quote.code)}
                className="mt-3 px-3 py-1.5 bg-red-950/40 border border-red-500/30 text-red-300 rounded-[2px] hover:bg-red-900/30 transition cursor-pointer font-sans"
              >
                重试加载
              </button>
            </div>
          ) : data && data.quant ? (
            <div className="flex-1 overflow-hidden" ref={containerRef}>
              <QuantChart
                quantData={data.quant}
                currentPrice={data.quote.price}
                height={chartHeight}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--faint)] font-mono">
              无可用的图表数据
            </div>
          )}
        </div>

        {/* 右侧综合面板 (长驻) */}
        {data && (
          <div className="w-[380px] shrink-0 bg-[var(--surface)] border-l border-[var(--border)] flex flex-col overflow-hidden">
            {/* 侧栏功能切换 Tab */}
            <div className="h-[40px] bg-[var(--bg)] border-b border-[var(--border)] flex items-stretch shrink-0 overflow-x-auto select-none">
              <button
                onClick={() => setActiveTab("ai")}
                className={`flex-1 px-2.5 text-[11px] font-bold transition cursor-pointer border-r border-[var(--border)] flex items-center justify-center gap-1 ${
                  activeTab === "ai"
                    ? "bg-[var(--surface)] text-[var(--accent)] font-black border-b-2 border-b-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                }`}
              >
                <span>AI 研判</span>
              </button>
              
              <button
                onClick={() => setActiveTab("trades")}
                className={`flex-1 px-2.5 text-[11px] font-bold transition cursor-pointer border-r border-[var(--border)] flex items-center justify-center gap-1 ${
                  activeTab === "trades"
                    ? "bg-[var(--surface)] text-[var(--accent)] font-black border-b-2 border-b-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                }`}
              >
                <span>交易信号</span>
              </button>

              <button
                onClick={() => setActiveTab("terminal")}
                className={`flex-1 px-2.5 text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  activeTab === "terminal"
                    ? "bg-[var(--surface)] text-[var(--accent)] font-black border-b-2 border-b-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                }`}
              >
                <span className={`w-1 h-1 rounded-full ${aiLoading ? "bg-[var(--accent)] animate-pulse" : "bg-[var(--faint)]"}`} />
                <span>推理终端</span>
              </button>
            </div>

            {/* 侧栏滚动容器 */}
            <div ref={sidebarRef} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              
              {/* 终端日志面板 */}
              {activeTab === "terminal" && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className={`font-bold font-mono ${aiLoading ? "text-[var(--accent)] animate-pulse" : "text-[var(--muted)]"}`}>
                      {aiLoading ? `⚡ ${aiStageMsg}` : "✔ 大模型诊断已完成"}
                    </span>
                    <span className="text-[var(--faint)] font-mono text-[9px]">
                      {aiLoading ? "推理中..." : "IDLE"}
                    </span>
                  </div>
                  {aiLogText ? (
                    <div ref={terminalRef} className="flex-1 min-h-[350px] overflow-y-auto p-3 bg-[var(--bg)] border border-[var(--border)] rounded-[2px] text-[10px] font-mono text-emerald-500/90 whitespace-pre-wrap leading-relaxed shadow-inner">
                      {aiLogText}
                      {aiLoading && <span className="inline-block w-1.5 h-3 bg-emerald-400 animate-ping ml-0.5" />}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-[var(--faint)] font-mono text-[10px]">
                      等待大模型评估流程启动...
                    </div>
                  )}
                </div>
              )}

              {/* 研判失败展示 (全局悬挂) */}
              {aiError && (
                <div className="border border-red-500/20 bg-red-950/20 text-red-400 p-4 rounded-[2px] text-xs font-mono space-y-2">
                  <div className="font-bold">❌ AI 评估失败：</div>
                  <div className="leading-relaxed">{aiError}</div>
                  <button
                    onClick={() => data?.quote.code && loadStock(data.quote.code)}
                    className="mt-2 px-3 py-1 bg-red-800 text-white rounded-[1px] hover:opacity-90 font-sans font-semibold cursor-pointer"
                  >
                    重试研判 ⚡
                  </button>
                </div>
              )}

              {/* AI 研判详情面板 */}
              {activeTab === "ai" && !aiError && (
                <>
                  {/* Verdict Card */}
                  <div className="border border-[var(--border)] bg-[var(--bg)] p-3 rounded-[2px] space-y-2">
                    <div className="flex justify-between items-center text-[9px] text-[var(--faint)] font-mono">
                      <span>研判等级 (VERDICT)</span>
                      <span className="text-red-400 font-bold">{data.assessment.verdict}</span>
                    </div>
                    <p className="font-semibold text-[var(--text)] leading-relaxed italic text-[11px] border-t border-[var(--border)] pt-1.5 mt-1">
                      “ {data.assessment.thesis} ”
                    </p>
                  </div>

                  {/* 五因子雷达图 */}
                  {data.assessment.factors && data.assessment.factors.length > 0 ? (
                    <div className="border border-[var(--border)] bg-[var(--bg)] p-3 rounded-[2px] space-y-3">
                      <h4 className="font-bold text-[var(--text)] border-b border-[var(--border)] pb-1.5 text-[10.5px]">五因子雷达图谱</h4>
                      <div className="py-2">
                        <RadarChart
                          size={140}
                          factors={data.assessment.factors.map((f) => ({
                            label: FACTOR_LABELS[f.key] || f.key,
                            score: f.score,
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        {data.assessment.factors.map((f) => (
                          <div key={f.key} className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-[var(--text)] font-semibold">{FACTOR_LABELS[f.key] || f.key}</span>
                              <span className="font-mono text-[var(--accent)]">{f.score.toFixed(1)}</span>
                            </div>
                            <div className="h-[3px] bg-[var(--border)] rounded-none overflow-hidden">
                              <div
                                className="h-full bg-[var(--accent)] transition-all"
                                style={{ width: `${(f.score / 5) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-[var(--faint)] font-mono text-[10px]">
                      (大模型分析就绪后即展现量化打分图谱)
                    </div>
                  )}

                  {/* BOM 拆解与卡脖子 */}
                  {data.assessment.bomPosition && (
                    <div className="border border-[var(--border)] bg-[var(--bg)] p-3 rounded-[2px] space-y-2">
                      <h4 className="font-bold text-[var(--text)] border-b border-[var(--border)] pb-1.5 text-[10.5px] flex justify-between items-center">
                        <span>BOM 成本链定位</span>
                        <span className="text-[9.5px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] px-1 rounded-[1px]">
                          BOM占比: {data.assessment.bomPosition.bomRatio}
                        </span>
                      </h4>
                      <div className="space-y-1 text-[11px]">
                        <div className="text-[var(--faint)] font-semibold">主研节点：</div>
                        <div className="font-mono font-bold text-[var(--text)]">{data.assessment.bomPosition.nodeName}</div>
                        <div className="text-[var(--faint)] font-semibold mt-2">物料作用与瓶颈点验证：</div>
                        <p className="text-[var(--muted)] leading-relaxed text-justify">{data.assessment.bomPosition.role}</p>
                      </div>
                    </div>
                  )}

                  {/* 催化剂与风险 */}
                  {data.assessment.catalysts && data.assessment.catalysts.length > 0 && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-red-400 text-[10.5px]">潜在催化剂</h4>
                        <ul className="list-decimal pl-4 space-y-1 text-[11px] text-[var(--muted)]">
                          {data.assessment.catalysts.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                      <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
                        <h4 className="font-bold text-emerald-400 text-[10.5px]">潜在投资风险</h4>
                        <ul className="list-decimal pl-4 space-y-1 text-[11px] text-[var(--muted)]">
                          {data.assessment.risks.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 交易回测与模拟明细面板 */}
              {activeTab === "trades" && data.quant && (
                <div className="space-y-4">
                  {/* 策略胜率/收益率面板 */}
                  <div className="border border-[var(--border)] bg-[var(--bg)] p-3 rounded-[2px] space-y-2 font-mono text-[11px]">
                    <div className="font-bold text-[var(--text)] border-b border-[var(--border)] pb-1.5 text-[10.5px] uppercase">
                      回测统计 (BACKTEST STATS)
                    </div>
                    <div className="flex justify-between py-1 border-b border-[var(--border)]/20">
                      <span className="text-[var(--faint)]">策略胜率:</span>
                      <span className="font-bold text-[var(--accent)]">
                        {((data.quant.backtest?.winRate || 0.5) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[var(--border)]/20">
                      <span className="text-[var(--faint)]">策略累计收益:</span>
                      <span className="font-bold text-red-400">
                        +{data.quant.backtest?.strategyReturn.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-[var(--faint)]">个股同期基准:</span>
                      <span className={`font-bold ${data.quant.backtest?.stockReturn >= 0 ? "text-red-500" : "text-emerald-500"}`}>
                        {data.quant.backtest?.stockReturn >= 0 ? "+" : ""}{data.quant.backtest?.stockReturn.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* 交易历史卡片列表 */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[var(--faint)] uppercase tracking-wider">
                      量化策略历史交易信号明细
                    </div>
                    {data.quant.backtest?.trades && data.quant.backtest.trades.length > 0 ? (
                      <div className="border border-[var(--border)] bg-[var(--surface)] rounded-[2px] overflow-hidden">
                        <div className="p-3">
                          <div className="space-y-3 divide-y divide-[var(--border)]/40">
                            {[...data.quant.backtest.trades].reverse().map((t: any, i: number) => {
                              const isBuy = t.type === "buy";
                              return (
                                <div key={i} className={`pt-3 first:pt-0 text-[10.5px] font-mono space-y-1.5`}>
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`px-1 py-0.5 rounded-[1px] font-bold text-[8px] leading-none ${
                                        isBuy ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                      }`}>
                                        {isBuy ? "BUY 买入" : "SELL 卖出"}
                                      </span>
                                      <span className="text-[var(--text)] font-semibold">{t.date}</span>
                                    </div>
                                    <div className="font-bold">
                                      成交: <span className="text-[var(--text)]">{t.price.toFixed(2)} 元</span>
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-[var(--muted)] leading-relaxed bg-[var(--bg)] p-1.5 rounded-[1px] border border-[var(--border)]/30">
                                    {t.reason}
                                  </p>
                                  {!isBuy && t.profitPct != null && (
                                    <div className="text-right text-[9.5px]">
                                      单笔盈亏: <span className={`font-bold ${t.profitPct >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                                        {t.profitPct >= 0 ? "+" : ""}{t.profitPct.toFixed(2)}%
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 text-center text-[var(--faint)] font-mono text-[10px]">
                        该回测区间内未触发任何策略交易。
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-[var(--bg)] flex items-center justify-center font-mono text-xs text-[var(--muted)]">Loading terminal...</div>}>
      <ChartInner />
    </Suspense>
  );
}
