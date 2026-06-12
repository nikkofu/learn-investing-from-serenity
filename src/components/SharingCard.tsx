"use client";

import { useEffect, useRef, useState } from "react";
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
  ratio: "3-4" | "9-16" | "16-9";
  quote: StockQuote;
  stats: any;
  assessment: ChokepointAssessment;
  isUp: boolean;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  themeColors?: {
    text: string;
    border: string;
    accent: string;
    accentSoft: string;
  };
}

// 抽取公共的海报渲染逻辑，保证预览与导出使用完全一致的 DOM 树
function PosterContent({ ratio, quote, stats, assessment, isUp, innerRef, themeColors }: PosterContentProps) {
  const dateStr = new Date().toISOString().split("T")[0];

  // 投行专业版式：直角/微小圆角，半透明毛玻璃底板，精细实线分割
  const cardStyle: React.CSSProperties = {
    background: "var(--surface)",
    backdropFilter: "var(--card-blur, none)",
    WebkitBackdropFilter: "var(--card-blur, none)",
    border: "2px solid var(--border)",
    borderRadius: "4px",
  };

  // ===================== 3:4 手机竖版 (880×1160) =====================
  if (ratio === "3-4") {
    return (
      <div
        ref={innerRef}
        className="relative flex flex-col justify-between select-none"
        style={{
          width: "880px",
          minHeight: "1160px",
          padding: "40px 44px",
          background: "var(--bg-gradient, var(--bg))",
          color: "var(--text)",
          fontFamily: "var(--font-sans), sans-serif",
          boxSizing: "border-box",
        }}
      >
        {/* 背景光晕 */}
        <div className="absolute -top-40 -right-40 h-[400px] w-[400px] rounded-full bg-[var(--accent-soft)] blur-[100px] opacity-20 pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-[var(--accent-soft)] blur-[100px] opacity-15 pointer-events-none" />

        {/* 1. 顶部眉栏 */}
        <div className="relative z-10 flex items-center justify-between" style={{ borderBottom: "2px solid var(--border)", paddingBottom: "14px", fontSize: "20px", letterSpacing: "0.08em", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase" }}>
          <span>SERENITY · STOCK REPORT</span>
          <span>{dateStr}</span>
        </div>

        {/* 2. 博主资质卡片 */}
        <div className="relative z-10 flex items-center" style={{ ...cardStyle, margin: "16px 0", padding: "18px 22px", gap: "20px" }}>
          <div style={{ width: "76px", height: "76px", flexShrink: 0, overflow: "hidden", border: "2px solid var(--border)", borderRadius: "4px", background: "var(--hover)" }}>
            <img src="/serenity-avatar.png" alt="Serenity" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(20%)" }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <span style={{ fontSize: "28px", fontWeight: 700, fontFamily: "monospace", color: "var(--text)", letterSpacing: "0.04em" }}>@aleabitoreddit</span>
              <span style={{ fontSize: "16px", fontWeight: 700, border: "2px solid var(--accent)", color: "var(--accent)", padding: "2px 10px", letterSpacing: "0.1em", textTransform: "uppercase" }}>ORIGINATOR</span>
            </div>
            <p style={{ fontSize: "20px", color: "var(--muted)", marginTop: "6px", letterSpacing: "0.02em" }}>前 AI 研究科学家 · 前 RISC-V 基金会成员</p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, borderLeft: "2px solid var(--border)", paddingLeft: "22px", display: "flex", flexDirection: "column", justifyContent: "center", height: "56px" }}>
            <span style={{ fontSize: "16px", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>YTD RETURN</span>
            <span style={{ fontSize: "32px", fontFamily: "monospace", fontWeight: 900, color: "var(--accent)", lineHeight: 1, marginTop: "4px" }}>≈ 45.0x</span>
          </div>
        </div>

        {/* 3. 股票行情与总分 */}
        <div className="relative z-10" style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: "16px", alignItems: "stretch", margin: "8px 0" }}>
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", justifyContent: "center", padding: "18px 22px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px", minWidth: 0 }}>
                <span style={{ fontSize: "44px", fontWeight: 900, color: "var(--text)", lineHeight: 1, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{quote.name}</span>
                <span style={{ fontSize: "22px", fontFamily: "monospace", color: "var(--muted)", flexShrink: 0 }}>{quote.code}</span>
              </div>
              {assessment.recommendedBuy && (
                <span style={{ fontSize: "18px", fontWeight: 700, border: "2px solid var(--accent)", color: "var(--accent)", padding: "4px 14px", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>BUY</span>
              )}
            </div>
            <div style={{ marginTop: "14px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "14px", flexShrink: 0 }}>
                <span style={{ fontSize: "38px", fontFamily: "monospace", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{quote.price.toFixed(2)}</span>
                <span style={{ fontSize: "26px", fontFamily: "monospace", fontWeight: 700, color: isUp ? "#ef4444" : "#10b981", lineHeight: 1 }}>
                  {isUp ? "+" : ""}{quote.changePct.toFixed(2)}%
                </span>
              </div>
              {assessment.recommendedBuy && assessment.buyPriceRange && (
                <span style={{ fontSize: "20px", fontFamily: "monospace", color: "var(--muted)", flexShrink: 0 }}>建议买入: {assessment.buyPriceRange}</span>
              )}
            </div>
          </div>
          <div style={{ ...cardStyle, textAlign: "center", padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <span style={{ fontSize: "18px", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>SERENITY SCORE</span>
            <span style={{ fontSize: "60px", fontFamily: "monospace", fontWeight: 900, color: "var(--accent)", lineHeight: 1, margin: "6px 0" }}>{assessment.totalScore}</span>
            <span style={{ fontSize: "22px", color: "var(--muted)", fontWeight: 700, borderTop: "2px solid var(--border)", paddingTop: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assessment.verdict}</span>
          </div>
        </div>

        {/* 4. 分析区 (雷达图 + 五因子) */}
        <div className="relative z-10" style={{ ...cardStyle, display: "grid", gridTemplateColumns: "300px 1fr", gap: "20px", alignItems: "center", padding: "18px 22px" }}>
          <div style={{ width: "300px", height: "300px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <RadarChart
              factors={assessment.factors.map((f) => ({ label: FACTOR_LABELS[f.key] || f.key, score: f.score }))}
              size={240}
              textColor={themeColors?.text}
              borderColor={themeColors?.border}
              accentColor={themeColors?.accent}
              accentSoftColor={themeColors?.accentSoft}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0, paddingRight: "8px" }}>
            {assessment.factors.map((f) => (
              <div key={f.key} style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "monospace" }}>
                  <span style={{ fontSize: "24px", color: "var(--text)", fontWeight: 600 }}>{FACTOR_LABELS[f.key] || f.key}</span>
                  <span style={{ fontSize: "24px", fontWeight: 700, color: "var(--accent)" }}>{f.score} / 5</span>
                </div>
                <div style={{ marginTop: "8px", height: "8px", background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(f.score / 5) * 100}%`, background: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. 投资逻辑 */}
        <div className="relative z-10" style={{ ...cardStyle, borderLeft: "6px solid var(--accent)", padding: "18px 22px", margin: "12px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "8px", marginBottom: "12px" }}>
            <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>INVESTMENT THESIS / 瓶颈核心论述</span>
            <span style={{ fontSize: "16px", color: "var(--faint)" }}>EXECUTIVE SUMMARY</span>
          </div>
          <p style={{ fontSize: "24px", lineHeight: 1.6, color: "var(--text)", textAlign: "justify" }}>
            {assessment.thesis.length > 80 ? assessment.thesis.slice(0, 77) + "..." : assessment.thesis}
          </p>
        </div>

        {/* 6. 催化剂与风险点 */}
        <div className="relative z-10" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "12px", marginBottom: "12px" }}>
          <div style={{ ...cardStyle, borderLeft: "4px solid var(--accent-line)", padding: "18px 20px 22px 20px", display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "18px", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "10px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>CATALYSTS / 催化剂</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {assessment.catalysts.slice(0, 2).map((item, idx) => (
                <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0 }}>
                  <span style={{ fontSize: "20px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>[0{idx + 1}]</span>
                  <span style={{ fontSize: "20px", color: "var(--muted)", lineHeight: 1.5, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...cardStyle, borderLeft: "4px solid var(--warn-line)", padding: "18px 20px 22px 20px", display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "18px", fontFamily: "monospace", fontWeight: 700, color: "var(--warn)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "10px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>KEY RISKS / 关键风险点</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {assessment.risks.slice(0, 2).map((item, idx) => (
                <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0 }}>
                  <span style={{ fontSize: "20px", fontFamily: "monospace", color: "var(--warn)", fontWeight: 600, flexShrink: 0 }}>[0{idx + 1}]</span>
                  <span style={{ fontSize: "20px", color: "var(--muted)", lineHeight: 1.5, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 7. 页脚 */}
        <div className="relative z-10" style={{ marginTop: "auto", paddingTop: "14px", borderTop: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "18px", color: "var(--faint)", fontFamily: "monospace" }}>
          <span>SERENITY AUTOMATION ENGINE</span>
          <span>VALUATION CHOKEPOINT MODEL</span>
        </div>
      </div>
    );
  }

  // ===================== 9:16 故事版 (880×1560) =====================
  if (ratio === "9-16") {
    return (
      <div
        ref={innerRef}
        className="relative flex flex-col justify-between select-none"
        style={{
          width: "880px",
          minHeight: "1560px",
          padding: "44px 48px",
          background: "var(--bg-gradient, var(--bg))",
          color: "var(--text)",
          fontFamily: "var(--font-sans), sans-serif",
          boxSizing: "border-box",
        }}
      >
        {/* 背景光晕 */}
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-[var(--accent-soft)] blur-[100px] opacity-20 pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-[var(--accent-soft)] blur-[100px] opacity-15 pointer-events-none" />

        {/* 1. 顶部眉栏 */}
        <div className="relative z-10 flex items-center justify-between" style={{ borderBottom: "2px solid var(--border)", paddingBottom: "16px", fontSize: "22px", letterSpacing: "0.08em", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase" }}>
          <span>SERENITY RESEARCH · STOCK REPORT</span>
          <span>{dateStr}</span>
        </div>

        {/* 2. 博主资质卡片 */}
        <div className="relative z-10 flex items-center" style={{ ...cardStyle, margin: "20px 0", padding: "22px 26px", gap: "22px" }}>
          <div style={{ width: "84px", height: "84px", flexShrink: 0, overflow: "hidden", border: "2px solid var(--border)", borderRadius: "4px", background: "var(--hover)" }}>
            <img src="/serenity-avatar.png" alt="Serenity" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(20%)" }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <span style={{ fontSize: "30px", fontWeight: 700, fontFamily: "monospace", color: "var(--text)", letterSpacing: "0.04em" }}>@aleabitoreddit</span>
              <span style={{ fontSize: "18px", fontWeight: 700, border: "2px solid var(--accent)", color: "var(--accent)", padding: "3px 12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>ORIGINATOR</span>
            </div>
            <p style={{ fontSize: "22px", color: "var(--muted)", marginTop: "8px", letterSpacing: "0.02em" }}>前 AI 研究科学家 · 前 RISC-V 基金会成员</p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, borderLeft: "2px solid var(--border)", paddingLeft: "24px", display: "flex", flexDirection: "column", justifyContent: "center", height: "60px" }}>
            <span style={{ fontSize: "18px", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>YTD RETURN</span>
            <span style={{ fontSize: "36px", fontFamily: "monospace", fontWeight: 900, color: "var(--accent)", lineHeight: 1, marginTop: "6px" }}>≈ 45.0x</span>
          </div>
        </div>

        {/* 3. 股票行情与总分 */}
        <div className="relative z-10" style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "18px", alignItems: "stretch", marginBottom: "16px" }}>
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", justifyContent: "center", padding: "20px 24px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px", minWidth: 0 }}>
                <span style={{ fontSize: "48px", fontWeight: 900, color: "var(--text)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{quote.name}</span>
                <span style={{ fontSize: "24px", fontFamily: "monospace", color: "var(--muted)", flexShrink: 0 }}>{quote.code}</span>
              </div>
              {assessment.recommendedBuy && (
                <span style={{ fontSize: "20px", fontWeight: 700, border: "2px solid var(--accent)", color: "var(--accent)", padding: "4px 16px", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>BUY</span>
              )}
            </div>
            <div style={{ marginTop: "14px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "14px", flexShrink: 0 }}>
                <span style={{ fontSize: "40px", fontFamily: "monospace", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{quote.price.toFixed(2)}</span>
                <span style={{ fontSize: "28px", fontFamily: "monospace", fontWeight: 700, color: isUp ? "#ef4444" : "#10b981", lineHeight: 1 }}>
                  {isUp ? "+" : ""}{quote.changePct.toFixed(2)}%
                </span>
              </div>
              {assessment.recommendedBuy && assessment.buyPriceRange && (
                <span style={{ fontSize: "22px", fontFamily: "monospace", color: "var(--muted)", flexShrink: 0 }}>买入价: {assessment.buyPriceRange}</span>
              )}
            </div>
          </div>
          <div style={{ ...cardStyle, textAlign: "center", padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <span style={{ fontSize: "18px", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>SERENITY SCORE</span>
            <span style={{ fontSize: "64px", fontFamily: "monospace", fontWeight: 900, color: "var(--accent)", lineHeight: 1, margin: "8px 0" }}>{assessment.totalScore}</span>
            <span style={{ fontSize: "24px", color: "var(--muted)", fontWeight: 700, borderTop: "2px solid var(--border)", paddingTop: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assessment.verdict}</span>
          </div>
        </div>

        {/* 4. 分析区 */}
        <div className="relative z-10" style={{ ...cardStyle, display: "grid", gridTemplateColumns: "330px 1fr", gap: "24px", alignItems: "center", padding: "22px 26px" }}>
          <div style={{ width: "330px", height: "330px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <RadarChart
              factors={assessment.factors.map((f) => ({ label: FACTOR_LABELS[f.key] || f.key, score: f.score }))}
              size={260}
              textColor={themeColors?.text}
              borderColor={themeColors?.border}
              accentColor={themeColors?.accent}
              accentSoftColor={themeColors?.accentSoft}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0, paddingRight: "8px" }}>
            {assessment.factors.map((f) => (
              <div key={f.key} style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "monospace" }}>
                  <span style={{ fontSize: "26px", color: "var(--text)", fontWeight: 600 }}>{FACTOR_LABELS[f.key] || f.key}</span>
                  <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--accent)" }}>{f.score} / 5</span>
                </div>
                <div style={{ marginTop: "8px", height: "8px", background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(f.score / 5) * 100}%`, background: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. 投资逻辑 */}
        <div className="relative z-10" style={{ ...cardStyle, borderLeft: "6px solid var(--accent)", padding: "22px 26px", margin: "16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "10px", marginBottom: "14px" }}>
            <span style={{ fontSize: "20px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>INVESTMENT THESIS / 瓶颈核心论述</span>
            <span style={{ fontSize: "18px", color: "var(--faint)" }}>EXECUTIVE SUMMARY</span>
          </div>
          <p style={{ fontSize: "26px", lineHeight: 1.7, color: "var(--text)", textAlign: "justify" }}>
            {assessment.thesis.length > 150 ? assessment.thesis.slice(0, 147) + "..." : assessment.thesis}
          </p>
        </div>

        {/* 6. 催化剂与风险点 */}
        <div className="relative z-10" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px", marginBottom: "16px" }}>
          <div style={{ ...cardStyle, borderLeft: "4px solid var(--accent-line)", padding: "20px 22px 24px 22px", display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "20px", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>CATALYSTS / 催化剂</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {assessment.catalysts.slice(0, 3).map((item, idx) => (
                <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0 }}>
                  <span style={{ fontSize: "22px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>[0{idx + 1}]</span>
                  <span style={{ fontSize: "22px", color: "var(--muted)", lineHeight: 1.5, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...cardStyle, borderLeft: "4px solid var(--warn-line)", padding: "20px 22px 24px 22px", display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "20px", fontFamily: "monospace", fontWeight: 700, color: "var(--warn)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>KEY RISKS / 关键风险点</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {assessment.risks.slice(0, 3).map((item, idx) => (
                <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0 }}>
                  <span style={{ fontSize: "22px", fontFamily: "monospace", color: "var(--warn)", fontWeight: 600, flexShrink: 0 }}>[0{idx + 1}]</span>
                  <span style={{ fontSize: "22px", color: "var(--muted)", lineHeight: 1.5, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 7. 页脚 */}
        <div className="relative z-10" style={{ marginTop: "auto", paddingTop: "14px", borderTop: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "18px", color: "var(--faint)", fontFamily: "monospace" }}>
          <span>SERENITY AUTOMATION ENGINE</span>
          <span>SYSTEM RUNTIME @ A-SHARES</span>
        </div>
      </div>
    );
  } else {
    // ===================== 16:9 横版 (1440×810) =====================
    return (
      <div
        ref={innerRef}
        className="relative flex flex-col justify-between select-none"
        style={{
          width: "1440px",
          minHeight: "810px",
          padding: "36px 44px",
          background: "var(--bg-gradient, var(--bg))",
          color: "var(--text)",
          fontFamily: "var(--font-sans), sans-serif",
          boxSizing: "border-box",
        }}
      >
        {/* 背景光晕 */}
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-[var(--accent-soft)] blur-[100px] opacity-20 pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 h-[500px] w-[500px] rounded-full bg-[var(--accent-soft)] blur-[100px] opacity-15 pointer-events-none" />

        {/* 顶部眉栏 */}
        <div className="relative z-10 flex items-center justify-between" style={{ borderBottom: "2px solid var(--border)", paddingBottom: "12px", fontSize: "20px", letterSpacing: "0.08em", color: "var(--faint)", fontFamily: "monospace", textTransform: "uppercase" }}>
          <span>SERENITY RESEARCH · EQUITY DEEP DIVE</span>
          <span>{dateStr} · CONFIDENTIAL</span>
        </div>

        {/* 主分栏区域 */}
        <div className="relative z-10" style={{ display: "grid", gridTemplateColumns: "520px 1fr", gap: "28px", marginTop: "20px", marginBottom: "20px", alignItems: "stretch", minHeight: "600px" }}>

          {/* 左栏 */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "14px", width: "520px", flexShrink: 0, minWidth: 0 }}>

            {/* 博主资质 */}
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "18px", padding: "16px 20px", minWidth: 0 }}>
              <div style={{ width: "64px", height: "64px", flexShrink: 0, overflow: "hidden", border: "2px solid var(--border)", borderRadius: "4px", background: "var(--hover)" }}>
                <img src="/serenity-avatar.png" alt="Serenity" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(20%)" }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "26px", fontFamily: "monospace", fontWeight: 700, color: "var(--text)", letterSpacing: "0.04em" }}>@aleabitoreddit</div>
                <p style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1, marginTop: "8px" }}>年内收益 (YTD) ≈ 45.0x</p>
              </div>
            </div>

            {/* 行情与评分 */}
            <div style={{ ...cardStyle, padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px", minWidth: 0 }}>
                  <span style={{ fontSize: "40px", fontWeight: 900, color: "var(--text)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{quote.name}</span>
                  <span style={{ fontSize: "20px", fontFamily: "monospace", color: "var(--muted)", flexShrink: 0 }}>{quote.code}</span>
                </div>
                {assessment.recommendedBuy && (
                  <span style={{ fontSize: "16px", fontWeight: 700, border: "2px solid var(--accent)", color: "var(--accent)", padding: "3px 12px", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>BUY</span>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "14px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: "34px", fontFamily: "monospace", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{quote.price.toFixed(2)}</span>
                  <span style={{ fontSize: "22px", fontFamily: "monospace", fontWeight: 700, color: isUp ? "#ef4444" : "#10b981", marginTop: "8px" }}>
                    {isUp ? "+" : ""}{quote.changePct.toFixed(2)}%
                  </span>
                  {assessment.recommendedBuy && assessment.buyPriceRange && (
                    <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--muted)", marginTop: "8px" }}>建议买入: {assessment.buyPriceRange}</span>
                  )}
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: "40px", fontFamily: "monospace", fontWeight: 900, color: "var(--accent)", lineHeight: 1 }}>{assessment.totalScore} 分</span>
                  <span style={{ fontSize: "18px", color: "var(--muted)", fontWeight: 700, marginTop: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px", display: "block" }}>{assessment.verdict}</span>
                </div>
              </div>
            </div>

            {/* 雷达图 */}
            <div style={{ ...cardStyle, padding: "16px", display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: "220px" }}>
              <RadarChart
                factors={assessment.factors.map((f) => ({ label: FACTOR_LABELS[f.key] || f.key, score: f.score }))}
                size={220}
                textColor={themeColors?.text}
                borderColor={themeColors?.border}
                accentColor={themeColors?.accent}
                accentSoftColor={themeColors?.accentSoft}
              />
            </div>
          </div>

          {/* 右栏 */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "14px", flex: 1, minWidth: 0 }}>

            {/* 五因子 */}
            <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 28px", padding: "18px 22px" }}>
              {assessment.factors.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                  <span style={{ fontSize: "20px", fontWeight: 600, color: "var(--text)", width: "110px", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FACTOR_LABELS[f.key] || f.key}</span>
                  <div style={{ height: "6px", flex: 1, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(f.score / 5) * 100}%`, background: "var(--accent)" }} />
                  </div>
                  <span style={{ fontSize: "20px", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", width: "48px", textAlign: "right", flexShrink: 0 }}>{f.score}/5</span>
                </div>
              ))}
            </div>

            {/* 论述 */}
            <div style={{ ...cardStyle, borderLeft: "6px solid var(--accent)", padding: "18px 22px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "8px", marginBottom: "12px" }}>
                <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>INVESTMENT THESIS / 评估论述</span>
                <span style={{ fontSize: "16px", color: "var(--faint)" }}>EXECUTIVE SUMMARY</span>
              </div>
              <p style={{ fontSize: "22px", lineHeight: 1.6, color: "var(--text)", fontStyle: "italic", textAlign: "justify" }}>
                {assessment.thesis.length > 180 ? assessment.thesis.slice(0, 177) + "..." : assessment.thesis}
              </p>
            </div>

            {/* 催化剂与风险点 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              <div style={{ ...cardStyle, borderLeft: "4px solid var(--accent-line)", padding: "16px 18px 20px 18px", display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "18px", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "10px", paddingBottom: "6px", borderBottom: "1px solid var(--border)" }}>CATALYSTS / 催化剂</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", minWidth: 0 }}>
                    <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>[01]</span>
                    <span style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1.4, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{assessment.catalysts[0] || "无明显催化剂"}</span>
                  </div>
                  {assessment.catalysts[1] && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", minWidth: 0 }}>
                      <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>[02]</span>
                      <span style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1.4, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{assessment.catalysts[1]}</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ ...cardStyle, borderLeft: "4px solid var(--warn-line)", padding: "16px 18px 20px 18px", display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "18px", fontFamily: "monospace", fontWeight: 700, color: "var(--warn)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "10px", paddingBottom: "6px", borderBottom: "1px solid var(--border)" }}>KEY RISKS / 风险点</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", minWidth: 0 }}>
                    <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--warn)", fontWeight: 600, flexShrink: 0 }}>[01]</span>
                    <span style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1.4, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{assessment.risks[0] || "无明显风险点"}</span>
                  </div>
                  {assessment.risks[1] && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", minWidth: 0 }}>
                      <span style={{ fontSize: "18px", fontFamily: "monospace", color: "var(--warn)", fontWeight: 600, flexShrink: 0 }}>[02]</span>
                      <span style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1.4, flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{assessment.risks[1]}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* 页脚 */}
        <div className="relative z-10" style={{ marginTop: "auto", paddingTop: "12px", borderTop: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "18px", color: "var(--faint)", fontFamily: "monospace" }}>
          <span>DATA METHODOLOGY: EASTMONEY API + SERENITY ENGINE</span>
          <span>VALUATION CHOKEPOINT MODEL</span>
        </div>
      </div>
    );
  }
}

export default function SharingCard({ quote, stats, assessment, onClose }: SharingCardProps) {
  const [ratio, setRatio] = useState<"3-4" | "9-16" | "16-9">("3-4");
  const [exporting, setExporting] = useState(false);
  const [scale, setScale] = useState(0.85);
  const cardRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(1160);
  const [themeStyles, setThemeStyles] = useState<React.CSSProperties>({});
  const [themeColors, setThemeColors] = useState({
    text: "#e7ecf3",
    border: "rgba(255, 255, 255, 0.1)",
    accent: "#10b981",
    accentSoft: "rgba(16, 185, 129, 0.15)",
  });

  // 获取页面运行时计算出的所有 CSS 主题变量及特定颜色值，通过内联 style 写入以解决 html-to-image 沙箱导出变量丢失问题
  useEffect(() => {
    if (typeof window === "undefined") return;

    const rootStyle = window.getComputedStyle(document.documentElement);

    // 1. 读取用于 RadarChart 的直接颜色值
    setThemeColors({
      text: rootStyle.getPropertyValue("--text").trim() || "#e7ecf3",
      border: rootStyle.getPropertyValue("--border").trim() || "rgba(255, 255, 255, 0.1)",
      accent: rootStyle.getPropertyValue("--accent").trim() || "#10b981",
      accentSoft: rootStyle.getPropertyValue("--accent-soft").trim() || "rgba(16, 185, 129, 0.15)",
    });

    // 2. 读取所有的 CSS 变量值
    const variables = [
      "--bg",
      "--bg-gradient",
      "--surface",
      "--border",
      "--hover",
      "--text",
      "--muted",
      "--faint",
      "--accent",
      "--accent-strong",
      "--accent-soft",
      "--accent-line",
      "--accent-fg",
      "--warn",
      "--warn-soft",
      "--warn-line",
      "--card-blur",
    ];
    const styles: Record<string, string> = {};
    variables.forEach((v) => {
      const val = rootStyle.getPropertyValue(v);
      if (val) {
        styles[v] = val.trim();
      }
    });
    setThemeStyles(styles as React.CSSProperties);
  }, [ratio, assessment]);

  // 动态测量预览中海报内容的实际渲染高度，配合 scale 调整预览盒子的长宽，消除大片空白和被截断的可能
  useEffect(() => {
    const measureHeight = () => {
      if (posterRef.current) {
        setContentHeight(posterRef.current.offsetHeight);
      }
    };
    const timer = setTimeout(measureHeight, 60);

    let observer: ResizeObserver | null = null;
    if (typeof window !== "undefined" && window.ResizeObserver && posterRef.current) {
      observer = new ResizeObserver(() => {
        measureHeight();
      });
      observer.observe(posterRef.current);
    }

    return () => {
      clearTimeout(timer);
      if (observer) observer.disconnect();
    };
  }, [ratio, scale, assessment, themeStyles]);

  useEffect(() => {
    const updateScale = () => {
      if (typeof window === "undefined") return;
      const width = window.innerWidth;
      // 翻倍后的物理尺寸：3:4/9:16 = 880px, 16:9 = 1440px
      const targetWidth = ratio === "16-9" ? 1440 : 880;
      if (width < 520) {
        // 手机端，留出边距，动态缩放以完美嵌入屏幕
        const newScale = Math.max(0.2, (width - 40) / targetWidth);
        setScale(newScale);
      } else {
        setScale(ratio === "16-9" ? 0.45 : ratio === "9-16" ? 0.4 : 0.5);
      }
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [ratio]);

  // 导出 PNG
  const handleExport = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      // 稍等以保证渲染完全
      await new Promise((r) => setTimeout(r, 200));
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2, // 导出 2 倍图，确保高清
        style: {
          ...themeStyles,
          transform: "scale(1)", // 确保无缩放影响
          transformOrigin: "top left",
        } as any,
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
      <div className="flex w-full max-w-5xl flex-col max-h-[95vh] overflow-y-auto rounded-[4px] border border-[var(--border)] bg-[var(--popover-bg,var(--surface))] p-4 sm:p-5 shadow-2xl md:p-6">
        
        {/* 顶部标题与选项卡 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text)] tracking-wider">生成专业研报海报</h3>
            <p className="text-[11px] text-[var(--muted)]">海报将自动适配您当前所选的系统配色与渐变</p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <button
              onClick={() => setRatio("3-4")}
              className={`rounded-[2px] px-2.5 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                ratio === "3-4"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--hover)] text-[var(--text)] hover:opacity-80"
              }`}
            >
              3:4 手机卡片 (推荐)
            </button>
            <button
              onClick={() => setRatio("9-16")}
              className={`rounded-[2px] px-2.5 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                ratio === "9-16"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--hover)] text-[var(--text)] hover:opacity-80"
              }`}
            >
              9:16 故事版
            </button>
            <button
              onClick={() => setRatio("16-9")}
              className={`rounded-[2px] px-2.5 py-1.5 text-xs font-semibold tracking-wider transition cursor-pointer ${
                ratio === "16-9"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--hover)] text-[var(--text)] hover:opacity-80"
              }`}
            >
              16:9 横版
            </button>
          </div>
        </div>

        {/* 预览展示区域，海报容器按实际尺寸输出，外部以 CSS 缩小以适应视口 */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[var(--inset)] p-4 max-h-[50vh] sm:max-h-[60vh] min-h-[260px] sm:min-h-[380px] rounded-[2px] border border-[var(--border)]">
          
          {/* ============================================================== */}
          {/* 预览卡片容器：外层容器限制为缩放后的实际尺寸，防止撑开产生滚动条 */}
          {/* ============================================================== */}
          <div 
            className="shrink-0 transition-all duration-300"
            style={{ 
              width: `${(ratio === "16-9" ? 1440 : 880) * scale}px`,
              height: `${contentHeight * scale}px`,
              position: "relative",
              overflow: "hidden"
            }}
          >
            <div 
              style={{ 
                transform: `scale(${scale})`, 
                transformOrigin: "top left",
                position: "absolute",
                left: 0,
                top: 0,
                width: ratio === "16-9" ? "1440px" : "880px",
                ...themeStyles // 注入内联 CSS 主题变量
              }}
            >
              <PosterContent
                ratio={ratio}
                quote={quote}
                stats={stats}
                assessment={assessment}
                isUp={isUp}
                innerRef={posterRef}
                themeColors={themeColors}
              />
            </div>
          </div>

        </div>

        {/* ============================================================== */}
        {/* 导出专用离屏 DOM：不设固定高度和 overflow:hidden，让内容自然撑开以避免裁切 */}
        {/* ============================================================== */}
        <div
          style={{
            position: "absolute",
            left: "-9999px",
            top: "-9999px",
            width: ratio === "3-4" ? "880px" : ratio === "9-16" ? "880px" : "1440px",
          }}
        >
          <div ref={cardRef} style={themeStyles}>
            <PosterContent
              ratio={ratio}
              quote={quote}
              stats={stats}
              assessment={assessment}
              isUp={isUp}
              themeColors={themeColors}
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
