"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import type { ChokepointAssessment, StockQuote } from "@/lib/types";
import RadarChart from "@/components/RadarChart";

interface SharingCardProps {
  quote: StockQuote;
  stats: {
    windowDays: number;
    periodReturnPct: number;
    rangePosition: number;
    avgTurnoverPct: number;
  } | null;
  assessment: ChokepointAssessment;
  onClose: () => void;
}

const FACTOR_LABELS: Record<string, string> = {
  demand: "确定需求",
  supply: "受限供给",
  attention: "低关注度",
  valueCapture: "价值捕获",
  catalyst: "催化剂",
};

export default function SharingCard({ quote, stats, assessment, onClose }: SharingCardProps) {
  const [ratio, setRatio] = useState<"9-16" | "16-9">("9-16");
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 格式化市值
  const formatCap = (n: number) => {
    if (!n) return "-";
    return (n / 1e8).toFixed(1) + " 亿";
  };

  // 导出 PNG
  const handleExport = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      // 稍等以保证渲染完全
      await new Promise((r) => setTimeout(r, 150));
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2, // 导出 2 倍图，确保高清
        style: {
          transform: "scale(1)", // 确保无缩放影响
          transformOrigin: "top left",
        },
      });

      const link = document.createElement("a");
      link.download = `${quote.name}_Serenity瓶颈点分析_${ratio}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("生成海报失败:", err);
      alert("海报生成失败，您可以尝试直接屏幕截图分享。");
    } finally {
      setExporting(false);
    }
  };

  const isUp = quote.changePct >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-5xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] p-5 shadow-2xl md:p-6">
        
        {/* 顶部标题与选项卡 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">生成专业报道海报</h3>
            <p className="text-xs text-[var(--muted)]">海报将自动适配您当前所选的系统配色与渐变</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setRatio("9-16")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                ratio === "9-16"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--hover)] text-[var(--text)] hover:opacity-80"
              }`}
            >
              9:16 竖版 (小红书/Story)
            </button>
            <button
              onClick={() => setRatio("16-9")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                ratio === "16-9"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--hover)] text-[var(--text)] hover:opacity-80"
              }`}
            >
              16:9 横版 (X/Meta Feed)
            </button>
          </div>
        </div>

        {/* 预览展示区域，海报容器按实际尺寸输出，外部以 CSS 缩小以适应视口 */}
        <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-[var(--inset)] p-4 max-h-[60vh] min-h-[350px]">
          <div className="relative origin-center transform" style={{ transform: "scale(0.85)", zoom: "0.85" }}>
            
            {/* ============================================================== */}
            {/* 9:16 竖版海报容器 */}
            {/* ============================================================== */}
            {ratio === "9-16" && (
              <div
                ref={cardRef}
                className="relative overflow-hidden p-6 flex flex-col justify-between"
                style={{
                  width: "440px",
                  height: "780px",
                  background: "var(--bg-gradient, var(--bg))",
                  color: "var(--text)",
                  fontFamily: "var(--font-sans), sans-serif",
                }}
              >
                {/* 装饰性偏角光晕，提升高级感 */}
                <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-60 pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-40 pointer-events-none" />

                {/* 1. 顶部小标题 */}
                <div className="relative z-10 flex items-center justify-between border-b border-[var(--border)] pb-2 text-[10px] uppercase tracking-wider text-[var(--faint)]">
                  <span>Serenity 瓶颈点研究 · 个股报告</span>
                  <span>{new Date().toISOString().split("T")[0]} · 免责声明</span>
                </div>

                {/* 2. 博主资质卡片 (参考截图 2) */}
                <div className="relative z-10 my-3 flex items-center gap-3 rounded-xl glass-card p-2.5 shadow-sm" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full ring-2 ring-[var(--accent)] bg-[var(--hover)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/serenity-avatar.png" alt="Serenity" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-[var(--text)]">@aleabitoreddit</span>
                      <span className="rounded bg-[var(--accent-soft)] px-1 py-0.2 text-[8px] text-[var(--accent)] font-semibold">瓶颈点鼻祖</span>
                    </div>
                    <p className="text-[9px] text-[var(--muted)] truncate">前AI研究科学家 · 前RISC-V基金会成员</p>
                  </div>
                  <div className="text-right shrink-0 border-l border-[var(--border)] pl-2.5">
                    <div className="text-[10px] font-bold text-[var(--accent)]">≈ 45 倍</div>
                    <div className="text-[8px] text-[var(--faint)]">博主年内收益率</div>
                  </div>
                </div>

                {/* 3. 股票基本行情与超大得分 */}
                <div className="relative z-10 mb-3 grid grid-cols-[1fr_120px] gap-2 items-center">
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-[var(--text)]">{quote.name}</h1>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--muted)]">{quote.code}.{quote.market}</span>
                      <span className={`text-xs font-semibold ${isUp ? "text-red-400" : "text-emerald-400"}`}>
                        {quote.price.toFixed(2)} ({isUp ? "+" : ""}{quote.changePct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                  <div className="text-right bg-gradient-to-r from-[var(--accent-soft)] to-transparent rounded-lg p-2 border-r-2 border-[var(--accent)]">
                    <div className="text-2xl font-black text-[var(--accent)] leading-none">{assessment.totalScore}</div>
                    <div className="text-[9px] text-[var(--muted)] font-medium mt-0.5">{assessment.verdict}</div>
                  </div>
                </div>

                {/* 4. 中间分析区 (雷达图 + 五因子进度条) */}
                <div className="relative z-10 grid grid-cols-[165px_1fr] gap-3 items-center glass-card p-3 rounded-xl" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                  <div className="scale-95 origin-center">
                    <RadarChart
                      factors={assessment.factors.map((f) => ({
                        label: FACTOR_LABELS[f.key] || f.key,
                        score: f.score,
                      }))}
                      size={150}
                    />
                  </div>
                  <div className="space-y-2">
                    {assessment.factors.map((f) => (
                      <div key={f.key}>
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-[var(--text)] font-medium">{FACTOR_LABELS[f.key] || f.key}</span>
                          <span className="font-mono font-semibold text-[var(--accent)]">{f.score}/5</span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(f.score / 5) * 100}%`,
                              background: "var(--accent-gradient, var(--accent))",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. 核心投资逻辑金句 (参考截图 3) */}
                <div className="relative z-10 my-3 rounded-xl border-l-4 border-[var(--accent)] glass-card p-3 shadow-sm" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                  <div className="absolute top-2 right-2 text-2xl font-serif text-[var(--accent-soft)] leading-none font-bold">“</div>
                  <h4 className="text-[10px] font-bold text-[var(--accent)] mb-1 uppercase tracking-wider">Serenity 风格瓶颈论述</h4>
                  <p className="text-xs leading-5 text-[var(--text)] italic font-medium">
                    {assessment.thesis.length > 130 ? assessment.thesis.slice(0, 127) + "..." : assessment.thesis}
                  </p>
                </div>

                {/* 6. 催化剂与风险点对比 */}
                <div className="relative z-10 grid grid-cols-2 gap-2 flex-1 min-h-[110px]">
                  <div className="rounded-xl border border-[var(--accent-line)] glass-card p-2.5" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                    <h5 className="text-[10px] font-bold text-[var(--accent)] mb-1">潜在催化剂</h5>
                    <ul className="list-disc pl-3 text-[9px] leading-4 text-[var(--muted)] space-y-0.5">
                      {assessment.catalysts.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="truncate">{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-[var(--warn-line)] glass-card p-2.5" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                    <h5 className="text-[10px] font-bold text-[var(--warn)] mb-1">关键风险点</h5>
                    <ul className="list-disc pl-3 text-[9px] leading-4 text-[var(--muted)] space-y-0.5">
                      {assessment.risks.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="truncate">{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* 7. 页脚 */}
                <div className="relative z-10 mt-3 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[9px] text-[var(--faint)]">
                  <span>白毛股神投资模型自动化评估</span>
                  <span className="font-mono">Serenity @ A-Shares</span>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* 16:9 横版海报容器 */}
            {/* ============================================================== */}
            {ratio === "16-9" && (
              <div
                ref={cardRef}
                className="relative overflow-hidden p-6 flex flex-col justify-between"
                style={{
                  width: "720px",
                  height: "405px",
                  background: "var(--bg-gradient, var(--bg))",
                  color: "var(--text)",
                  fontFamily: "var(--font-sans), sans-serif",
                }}
              >
                {/* 装饰性背景光晕 */}
                <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-60 pointer-events-none" />
                <div className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-40 pointer-events-none" />

                {/* 顶部标题栏 */}
                <div className="relative z-10 flex items-center justify-between border-b border-[var(--border)] pb-2 text-[9px] uppercase tracking-wider text-[var(--faint)]">
                  <span>Serenity 瓶颈点研究 · 深度评估研报</span>
                  <span>{new Date().toISOString().split("T")[0]} · 仅供学术研究</span>
                </div>

                {/* 主分栏区域 */}
                <div className="relative z-10 grid grid-cols-[240px_1fr] gap-4 my-auto items-stretch">
                  
                  {/* 左栏：博主背书、股票信息、雷达图 */}
                  <div className="flex flex-col justify-between space-y-3">
                    
                    {/* 博主资质 (极简横排) */}
                    <div className="flex items-center gap-2.5 rounded-lg glass-card p-2" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                      <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full ring-2 ring-[var(--accent)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/serenity-avatar.png" alt="Serenity" className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[10px] text-[var(--text)]">@aleabitoreddit</div>
                        <p className="text-[8px] text-[var(--muted)] leading-none mt-0.5">博主战绩: 年内 ≈ 45 倍收益</p>
                      </div>
                    </div>

                    {/* 行情与评分 */}
                    <div className="rounded-lg glass-card p-2.5" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                      <div className="flex items-baseline justify-between">
                        <h2 className="font-bold text-base text-[var(--text)] truncate max-w-[120px]">{quote.name}</h2>
                        <span className="font-mono text-[9px] text-[var(--faint)]">{quote.code}</span>
                      </div>
                      <div className="flex justify-between items-end mt-1">
                        <span className={`text-[11px] font-semibold ${isUp ? "text-red-400" : "text-emerald-400"}`}>
                          {quote.price.toFixed(2)} ({isUp ? "+" : ""}{quote.changePct.toFixed(2)}%)
                        </span>
                        <span className="text-right">
                          <span className="text-lg font-black text-[var(--accent)]">{assessment.totalScore}分</span>
                          <span className="text-[8px] text-[var(--muted)] block">{assessment.verdict}</span>
                        </span>
                      </div>
                    </div>

                    {/* 雷达图展示 */}
                    <div className="rounded-lg glass-card p-2 flex items-center justify-center" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                      <RadarChart
                        factors={assessment.factors.map((f) => ({
                          label: FACTOR_LABELS[f.key] || f.key,
                          score: f.score,
                        }))}
                        size={110}
                      />
                    </div>
                  </div>

                  {/* 右栏：因子条、风格论述、催化剂与风险 */}
                  <div className="flex flex-col justify-between space-y-3">
                    
                    {/* 五因子横排进度条 */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg glass-card p-2.5" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                      {assessment.factors.map((f) => (
                        <div key={f.key} className="flex items-center gap-2">
                          <span className="text-[9px] font-medium text-[var(--text)] w-14 shrink-0">{FACTOR_LABELS[f.key] || f.key}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hover)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(f.score / 5) * 100}%`,
                                background: "var(--accent-gradient, var(--accent))",
                              }}
                            />
                          </div>
                          <span className="font-mono font-bold text-[var(--accent)] text-[9px] w-6 text-right">{f.score}</span>
                        </div>
                      ))}
                    </div>

                    {/* 论述逻辑 (金句版式) */}
                    <div className="rounded-lg border-l-4 border-[var(--accent)] glass-card p-2.5 shadow-sm" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                      <h4 className="text-[8px] font-bold text-[var(--accent)] uppercase tracking-wider mb-0.5">Serenity 核心评估论述</h4>
                      <p className="text-[10px] leading-4 text-[var(--text)] italic">
                        {assessment.thesis.length > 160 ? assessment.thesis.slice(0, 157) + "..." : assessment.thesis}
                      </p>
                    </div>

                    {/* 催化剂与风险点 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-[var(--accent-line)] glass-card p-2" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                        <span className="text-[9px] font-bold text-[var(--accent)] block mb-0.5">潜在催化剂</span>
                        <p className="text-[8px] text-[var(--muted)] leading-3 truncate">{assessment.catalysts[0] || "无明显催化剂"}</p>
                        <p className="text-[8px] text-[var(--muted)] leading-3 truncate">{assessment.catalysts[1] || ""}</p>
                      </div>
                      <div className="rounded-lg border border-[var(--warn-line)] glass-card p-2" style={{ backdropFilter: "var(--card-blur, none)", WebkitBackdropFilter: "var(--card-blur, none)" }}>
                        <span className="text-[9px] font-bold text-[var(--warn)] block mb-0.5">潜在风险点</span>
                        <p className="text-[8px] text-[var(--muted)] leading-3 truncate">{assessment.risks[0] || "无明显风险"}</p>
                        <p className="text-[8px] text-[var(--muted)] leading-3 truncate">{assessment.risks[1] || ""}</p>
                      </div>
                    </div>
                  </div>

                </div>

                {/* 页脚 */}
                <div className="relative z-10 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[8px] text-[var(--faint)]">
                  <span>数据口径：东方财富行情接口 + AI 逻辑分析仪</span>
                  <span>白毛股神 chokepoint 选股模型</span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--hover)] transition"
          >
            关闭预览
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 transition"
          >
            {exporting ? "导出中…" : "保存到本地 (PNG)"}
          </button>
        </div>

      </div>
    </div>
  );
}
