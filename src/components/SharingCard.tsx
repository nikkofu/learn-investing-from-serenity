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

interface PosterContentProps {
  ratio: "9-16" | "16-9";
  quote: StockQuote;
  stats: any;
  assessment: ChokepointAssessment;
  isUp: boolean;
}

// 抽取公共的海报渲染逻辑，保证预览与导出使用完全一致的 DOM 树
function PosterContent({ ratio, quote, stats, assessment, isUp }: PosterContentProps) {
  const dateStr = new Date().toISOString().split("T")[0];

  // 投行专业版式：直角/微小圆角 (2px)，半透明毛玻璃底板，精细实线分割，无大阴影
  const cardStyle = {
    background: "var(--surface)",
    backdropFilter: "var(--card-blur, none)",
    WebkitBackdropFilter: "var(--card-blur, none)",
    border: "1px solid var(--border)",
    borderRadius: "2px",
  };

  if (ratio === "9-16") {
    return (
      <div
        className="relative overflow-hidden p-6 flex flex-col justify-between select-none"
        style={{
          width: "440px",
          height: "780px",
          background: "var(--bg-gradient, var(--bg))",
          color: "var(--text)",
          fontFamily: "var(--font-sans), sans-serif",
          boxSizing: "border-box",
        }}
      >
        {/* 背景光晕 (高度收敛，弱化发光) */}
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-20 pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-15 pointer-events-none" />

        {/* 1. 顶部眉栏 - 研报风，等宽英汉双语 */}
        <div className="relative z-10 flex items-center justify-between border-b border-[var(--border)] pb-2 text-[8px] uppercase tracking-wider text-[var(--faint)] font-mono">
          <span>SERENITY RESEARCH · INDIVIDUAL STOCK REPORT</span>
          <span>{dateStr} · PROPRIETARY</span>
        </div>

        {/* 2. 博主资质卡片 (Bloomberg Terminal 联名签名版式) */}
        <div className="relative z-10 my-2 flex items-center gap-3 p-2.5" style={cardStyle}>
          {/* 方形分析师证照头像 */}
          <div className="relative h-9.5 w-9.5 shrink-0 overflow-hidden border border-[var(--border)] rounded-[2px] bg-[var(--hover)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/serenity-avatar.png" alt="Serenity" className="h-full w-full object-cover grayscale-[20%]" />
          </div>
          {/* 姓名与专业资质 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-[10px] text-[var(--text)] tracking-wider">@aleabitoreddit</span>
              <span className="border border-[var(--accent)] bg-transparent px-1 py-0.2 text-[6px] text-[var(--accent)] font-bold uppercase tracking-wider rounded-none">
                ORIGINATOR
              </span>
            </div>
            <p className="text-[7.5px] text-[var(--muted)] mt-0.5 truncate tracking-wide font-sans">
              前 AI 研究科学家 · 前 RISC-V 基金会成员
            </p>
          </div>
          {/* 彭博社风格收益格子 */}
          <div className="text-right shrink-0 border-l border-[var(--border)] pl-2.5 flex flex-col justify-center h-7.5">
            <span className="text-[6.5px] text-[var(--faint)] font-mono uppercase tracking-wider block">YTD RETURN</span>
            <span className="text-[11px] font-mono font-black text-[var(--accent)] leading-none mt-0.5">≈ 45.0x</span>
          </div>
        </div>

        {/* 3. 股票基本行情与晨星信用评级风格总分 */}
        <div className="relative z-10 mb-2 grid grid-cols-[1fr_120px] gap-2.5 items-stretch">
          {/* 行情区块 */}
          <div className="flex flex-col justify-center p-2.5" style={cardStyle}>
            <div className="flex items-baseline gap-1.5">
              <h1 className="text-base font-bold tracking-tight text-[var(--text)] leading-none">{quote.name}</h1>
              <span className="font-mono text-[8px] text-[var(--muted)]">{quote.code}.{quote.market}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xs font-bold text-[var(--text)]">{quote.price.toFixed(2)}</span>
              <span className={`font-mono text-[9px] font-bold ${isUp ? "text-red-500" : "text-emerald-500"}`}>
                {isUp ? "+" : ""}{quote.changePct.toFixed(2)}%
              </span>
            </div>
          </div>
          {/* 晨星信用评级风格总分 */}
          <div className="text-center p-2 flex flex-col justify-between" style={cardStyle}>
            <span className="text-[6.5px] text-[var(--faint)] font-mono uppercase tracking-wider block">SERENITY SCORE</span>
            <span className="text-lg font-mono font-black text-[var(--accent)] leading-none my-0.5">{assessment.totalScore}</span>
            <span className="text-[7.5px] text-[var(--muted)] font-bold border-t border-[var(--border)] pt-0.5 block truncate">
              {assessment.verdict}
            </span>
          </div>
        </div>

        {/* 4. 中间分析区 (极细直角进度条 + 雷达图) */}
        <div className="relative z-10 grid grid-cols-[155px_1fr] gap-2.5 items-center p-2.5" style={cardStyle}>
          {/* 左侧雷达图 */}
          <div className="scale-95 origin-center shrink-0 w-[140px] h-[140px] flex items-center justify-center">
            <RadarChart
              factors={assessment.factors.map((f) => ({
                label: FACTOR_LABELS[f.key] || f.key,
                score: f.score,
              }))}
              size={135}
            />
          </div>
          {/* 右侧五因子极细刻度线 */}
          <div className="space-y-2 min-w-0">
            {assessment.factors.map((f) => (
              <div key={f.key} className="min-w-0">
                <div className="flex items-center justify-between text-[8.5px] font-mono">
                  <span className="text-[var(--text)] font-semibold">{FACTOR_LABELS[f.key] || f.key}</span>
                  <span className="font-bold text-[var(--accent)]">{f.score} / 5</span>
                </div>
                {/* 极细直角刻度进度线 */}
                <div className="mt-0.5 h-[2px] bg-[var(--border)] rounded-none overflow-hidden">
                  <div
                    className="h-full rounded-none"
                    style={{
                      width: `${(f.score / 5) * 100}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. 投资逻辑主线 (EXECUTIVE SUMMARY 风格) */}
        <div className="relative z-10 my-2 border-l-[3px] border-l-[var(--accent)] p-3" style={cardStyle}>
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-0.5 mb-1 text-[7.5px] font-mono text-[var(--accent)] uppercase tracking-wider font-bold">
            <span>INVESTMENT THESIS / 瓶颈核心论述</span>
            <span className="text-[var(--faint)] font-normal font-sans">EXECUTIVE SUMMARY</span>
          </div>
          <p className="text-[9.5px] leading-4 text-[var(--text)] font-normal font-sans text-justify">
            {assessment.thesis.length > 130 ? assessment.thesis.slice(0, 127) + "..." : assessment.thesis}
          </p>
        </div>

        {/* 6. 催化剂与风险点对比 (宽度精确限制，防止被文字撑爆破损) */}
        <div className="relative z-10 grid grid-cols-2 gap-2 flex-1 min-h-[110px]">
          {/* 潜在催化剂 */}
          <div className="p-2.5 flex flex-col justify-between min-w-0" style={{ ...cardStyle, borderLeft: "2px solid var(--accent-line)" }}>
            <div>
              <span className="text-[7.5px] font-mono font-bold text-[var(--accent)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                CATALYSTS / 催化剂
              </span>
              <div className="space-y-0.5 min-w-0">
                {assessment.catalysts.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex gap-1 items-start min-w-0 text-[8px] leading-3 text-[var(--muted)]">
                    <span className="font-mono text-[var(--accent)] font-semibold shrink-0">[0{idx + 1}]</span>
                    <span className="truncate flex-1 min-w-0 block">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* 关键风险点 */}
          <div className="p-2.5 flex flex-col justify-between min-w-0" style={{ ...cardStyle, borderLeft: "2px solid var(--warn-line)" }}>
            <div>
              <span className="text-[7.5px] font-mono font-bold text-[var(--warn)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                KEY RISKS / 关键风险点
              </span>
              <div className="space-y-0.5 min-w-0">
                {assessment.risks.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex gap-1 items-start min-w-0 text-[8px] leading-3 text-[var(--muted)]">
                    <span className="font-mono text-[var(--warn)] font-semibold shrink-0">[0{idx + 1}]</span>
                    <span className="truncate flex-1 min-w-0 block">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 7. 页脚 */}
        <div className="relative z-10 mt-2 pt-1.5 border-t border-[var(--border)] flex items-center justify-between text-[7.5px] text-[var(--faint)] font-mono">
          <span>SERENITY AUTOMATION ENGINE</span>
          <span>SYSTEM RUNTIME @ A-SHARES</span>
        </div>
      </div>
    );
  } else {
    // 16:9 横版海报
    return (
      <div
        className="relative overflow-hidden p-6 flex flex-col justify-between select-none"
        style={{
          width: "720px",
          height: "405px",
          background: "var(--bg-gradient, var(--bg))",
          color: "var(--text)",
          fontFamily: "var(--font-sans), sans-serif",
          boxSizing: "border-box",
        }}
      >
        {/* 背景光晕 (高度收敛，弱化发光) */}
        <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-20 pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-[var(--accent-soft)] blur-3xl opacity-15 pointer-events-none" />

        {/* 顶部眉栏 */}
        <div className="relative z-10 flex items-center justify-between border-b border-[var(--border)] pb-1.5 text-[7.5px] uppercase tracking-wider text-[var(--faint)] font-mono">
          <span>SERENITY RESEARCH · EQUITY DEEP DIVE REPORT</span>
          <span>{dateStr} · CONFIDENTIAL</span>
        </div>

        {/* 主分栏区域 */}
        <div className="relative z-10 grid grid-cols-[240px_1fr] gap-4 my-auto items-stretch flex-1 py-2 min-h-[300px]">
          
          {/* 左栏：博主背书、股票信息、雷达图 (总宽度固定 240px) */}
          <div className="flex flex-col justify-between space-y-2 w-[240px] shrink-0 min-w-0">
            
            {/* 博主资质 (极简横排) */}
            <div className="flex items-center gap-2.5 p-2 min-w-0" style={cardStyle}>
              {/* 方形分析师证照头像 */}
              <div className="relative h-8 w-8 shrink-0 overflow-hidden border border-[var(--border)] rounded-[2px] bg-[var(--hover)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/serenity-avatar.png" alt="Serenity" className="h-full w-full object-cover grayscale-[20%]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-[8.5px] text-[var(--text)] tracking-wider">@aleabitoreddit</div>
                <p className="text-[7px] text-[var(--muted)] leading-none mt-0.5 truncate">年内收益 (YTD) ≈ 45.0x</p>
              </div>
            </div>

            {/* 行情与评分 (晨星风格) */}
            <div className="p-2 flex flex-col justify-center min-w-0" style={cardStyle}>
              <div className="flex items-baseline justify-between gap-1">
                <h2 className="font-bold text-[12px] text-[var(--text)] truncate max-w-[120px] leading-none">{quote.name}</h2>
                <span className="font-mono text-[8px] text-[var(--muted)]">{quote.code}</span>
              </div>
              <div className="flex justify-between items-end mt-1.5 border-t border-[var(--border)] pt-1.5">
                <div className="flex flex-col">
                  <span className="font-mono text-[10px] font-bold text-[var(--text)] leading-none">{quote.price.toFixed(2)}</span>
                  <span className={`font-mono text-[7.5px] font-bold ${isUp ? "text-red-500" : "text-emerald-500"} mt-0.5`}>
                    {isUp ? "+" : ""}{quote.changePct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-right flex flex-col justify-center">
                  <span className="text-[11px] font-mono font-black text-[var(--accent)] leading-none">{assessment.totalScore} 分</span>
                  <span className="text-[6.5px] text-[var(--muted)] font-bold mt-0.5 tracking-tighter truncate max-w-[90px] block">{assessment.verdict}</span>
                </div>
              </div>
            </div>

            {/* 雷达图展示 */}
            <div className="p-2 flex items-center justify-center flex-1 h-[115px]" style={cardStyle}>
              <RadarChart
                factors={assessment.factors.map((f) => ({
                  label: FACTOR_LABELS[f.key] || f.key,
                  score: f.score,
                }))}
                size={95}
              />
            </div>
          </div>

          {/* 右栏：因子条、风格论述、催化剂与风险 (宽度恒为 416px) */}
          <div className="flex flex-col justify-between space-y-2 flex-1 min-w-0">
            
            {/* 五因子进度条网格 */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-2" style={cardStyle}>
              {assessment.factors.map((f) => (
                <div key={f.key} className="flex items-center gap-2 min-w-0">
                  <span className="text-[7.5px] font-semibold text-[var(--text)] w-14 shrink-0 truncate">{FACTOR_LABELS[f.key] || f.key}</span>
                  <div className="h-[2px] flex-1 bg-[var(--border)] rounded-none overflow-hidden">
                    <div
                      className="h-full rounded-none"
                      style={{
                        width: `${(f.score / 5) * 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="font-mono font-bold text-[var(--accent)] text-[7.5px] w-5 text-right shrink-0">{f.score}/5</span>
                </div>
              ))}
            </div>

            {/* 论述逻辑 (Golden sentence) */}
            <div className="border-l-[3px] border-l-[var(--accent)] p-2 flex flex-col justify-center" style={cardStyle}>
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-0.5 mb-1 text-[7px] font-mono text-[var(--accent)] uppercase tracking-wider font-bold">
                <span>INVESTMENT THESIS / 评估论述</span>
                <span className="text-[var(--faint)] font-normal font-sans">EXECUTIVE SUMMARY</span>
              </div>
              <p className="text-[8.5px] leading-3 text-[var(--text)] italic font-sans text-justify">
                {assessment.thesis.length > 160 ? assessment.thesis.slice(0, 157) + "..." : assessment.thesis}
              </p>
            </div>

            {/* 催化剂与风险点 */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-2 flex flex-col justify-between min-w-0" style={{ ...cardStyle, borderLeft: "2px solid var(--accent-line)" }}>
                <div>
                  <span className="text-[7px] font-mono font-bold text-[var(--accent)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                    CATALYSTS / 催化剂
                  </span>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex gap-1 items-start min-w-0 text-[7px] leading-3 text-[var(--muted)]">
                      <span className="font-mono text-[var(--accent)] font-semibold shrink-0">[01]</span>
                      <span className="truncate flex-1 min-w-0 block">{assessment.catalysts[0] || "无明显催化剂"}</span>
                    </div>
                    {assessment.catalysts[1] && (
                      <div className="flex gap-1 items-start min-w-0 text-[7px] leading-3 text-[var(--muted)]">
                        <span className="font-mono text-[var(--accent)] font-semibold shrink-0">[02]</span>
                        <span className="truncate flex-1 min-w-0 block">{assessment.catalysts[1]}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-2 flex flex-col justify-between min-w-0" style={{ ...cardStyle, borderLeft: "2px solid var(--warn-line)" }}>
                <div>
                  <span className="text-[7px] font-mono font-bold text-[var(--warn)] uppercase tracking-wider block mb-1 border-b border-[var(--border)] pb-0.5">
                    KEY RISKS / 风险点
                  </span>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex gap-1 items-start min-w-0 text-[7px] leading-3 text-[var(--muted)]">
                      <span className="font-mono text-[var(--warn)] font-semibold shrink-0">[01]</span>
                      <span className="truncate flex-1 min-w-0 block">{assessment.risks[0] || "无明显风险点"}</span>
                    </div>
                    {assessment.risks[1] && (
                      <div className="flex gap-1 items-start min-w-0 text-[7px] leading-3 text-[var(--muted)]">
                        <span className="font-mono text-[var(--warn)] font-semibold shrink-0">[02]</span>
                        <span className="truncate flex-1 min-w-0 block">{assessment.risks[1]}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* 页脚 */}
        <div className="relative z-10 pt-1.5 border-t border-[var(--border)] flex items-center justify-between text-[7px] text-[var(--faint)] font-mono">
          <span>DATA METHODOLOGY: EASTMONEY API + SERENITY ENGINE</span>
          <span>VALUATION CHOKEPOINT MODEL</span>
        </div>
      </div>
    );
  }
}

export default function SharingCard({ quote, stats, assessment, onClose }: SharingCardProps) {
  const [ratio, setRatio] = useState<"9-16" | "16-9">("9-16");
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

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
      <div className="flex w-full max-w-5xl flex-col rounded-[4px] border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] p-5 shadow-2xl md:p-6">
        
        {/* 顶部标题与选项卡 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text)] tracking-wider">生成专业研报海报</h3>
            <p className="text-[11px] text-[var(--muted)]">海报将自动适配您当前所选的系统配色与渐变</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setRatio("9-16")}
              className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                ratio === "9-16"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--hover)] text-[var(--text)] hover:opacity-80"
              }`}
            >
              9:16 竖版 (小红书/Story)
            </button>
            <button
              onClick={() => setRatio("16-9")}
              className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
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
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[var(--inset)] p-4 max-h-[60vh] min-h-[380px] rounded-[2px] border border-[var(--border)]">
          
          {/* ============================================================== */}
          {/* 预览卡片容器：只做预览渲染，外层通过 CSS 进行缩放以自适应视口 */}
          {/* ============================================================== */}
          <div className="shrink-0 scale-[0.75] md:scale-90 transition-transform origin-center">
            <PosterContent
              ratio={ratio}
              quote={quote}
              stats={stats}
              assessment={assessment}
              isUp={isUp}
            />
          </div>

        </div>

        {/* ============================================================== */}
        {/* 导出专用离屏 DOM (绝对物理尺寸锁定，保证 html-to-image 克隆时不发生裁切溢出) */}
        {/* ============================================================== */}
        <div
          style={{
            position: "absolute",
            left: "-9999px",
            top: "-9999px",
            overflow: "hidden",
            width: ratio === "9-16" ? "440px" : "720px",
            height: ratio === "9-16" ? "780px" : "405px",
          }}
        >
          <div ref={cardRef}>
            <PosterContent
              ratio={ratio}
              quote={quote}
              stats={stats}
              assessment={assessment}
              isUp={isUp}
            />
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            className="rounded-[2px] border border-[var(--border)] px-4 py-2 text-xs font-semibold tracking-wider text-[var(--text)] hover:bg-[var(--hover)] transition cursor-pointer"
          >
            关闭预览
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-[2px] bg-[var(--accent)] px-5 py-2 text-xs font-semibold tracking-wider text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
          >
            {exporting ? "导出中…" : "保存至本地 (PNG)"}
          </button>
        </div>

      </div>
    </div>
  );
}
