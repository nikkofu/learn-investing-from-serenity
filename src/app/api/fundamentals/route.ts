import { NextResponse } from "next/server";
import { getQuotesFailover, getFinancialsHistory, getDividendHistory } from "@/lib/sources";
import { scoreFundamentals, pegRatio } from "@/lib/fundamentals";
import type { StockFinancials } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/fundamentals?code=600519&periods=8
 * 聚合基本面面板所需：估值（PE/PB/市值/换手/PEG/TTM 股息率）+ 最新一期财报 +
 * 近 N 期营收/净利/ROE 趋势 + 近期分红 + 0~100 基本面质量分。各源 best-effort 容错，
 * 单源失败不影响其余字段。仅供研究，不构成投资建议。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请提供 6 位股票代码" }, { status: 400 });
  }
  const periods = Math.max(2, Math.min(16, Number(url.searchParams.get("periods")) || 8));

  const [quoteRes, histRes, divRes] = await Promise.allSettled([
    getQuotesFailover([code]),
    getFinancialsHistory(code, periods),
    getDividendHistory(code, 16),
  ]);

  const quote = quoteRes.status === "fulfilled" ? quoteRes.value[code] : undefined;
  if (!quote) {
    return NextResponse.json({ error: "行情获取失败，暂无法生成基本面面板" }, { status: 502 });
  }

  // 财报：降序拉取，取最新一期 + 升序趋势序列。
  const histDesc: StockFinancials[] = histRes.status === "fulfilled" ? histRes.value : [];
  const latest = histDesc[0] ?? null;
  const history = [...histDesc].reverse(); // 升序（旧 → 新），供趋势图

  // TTM 股息率：近 365 天除权的税前每 10 股派现求和 / 10 / 现价。
  const dividends = divRes.status === "fulfilled" ? divRes.value : [];
  const dividendYield = computeTtmDividendYield(dividends, quote.price);

  const peg = pegRatio(quote.pe, latest?.netProfitYoy ?? null);
  const quality = scoreFundamentals(latest, { pe: quote.pe, pb: quote.pb });

  return NextResponse.json({
    code,
    name: quote.name,
    asOf: quote.time,
    valuation: {
      price: quote.price,
      pe: quote.pe,
      pb: quote.pb,
      totalMarketCap: quote.totalMarketCap,
      floatMarketCap: quote.floatMarketCap,
      turnoverPct: quote.turnoverPct,
      peg,
      dividendYield,
    },
    financials: latest,
    history,
    dividends: dividends.slice(0, 6),
    quality,
    sources: {
      quote: quoteRes.status === "fulfilled",
      financials: histDesc.length > 0,
      dividends: dividends.length > 0,
    },
    note: "基本面面板：财务指标季度更新、估值/股息为实时推导，质量分为透明加权的单只自评（不做同业对标、不预测未来）。仅供研究，不构成投资建议。",
  });
}

/** 近 365 天除权派现（税前每 10 股 RMB）求和 → 每股 → 占现价比例（%）。无有效数据返回 null。 */
function computeTtmDividendYield(
  dividends: Array<{ date: string; bonusRmb: number }>,
  price: number,
): number | null {
  if (!price || !Number.isFinite(price) || price <= 0) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  let per10 = 0;
  let hit = false;
  for (const d of dividends) {
    if (!d.date) continue;
    const t = new Date(d.date);
    if (Number.isNaN(t.getTime()) || t < cutoff) continue;
    if (d.bonusRmb && Number.isFinite(d.bonusRmb) && d.bonusRmb > 0) {
      per10 += d.bonusRmb;
      hit = true;
    }
  }
  if (!hit) return null;
  return Number((((per10 / 10) / price) * 100).toFixed(2));
}
