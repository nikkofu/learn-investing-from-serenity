import { NextResponse } from "next/server";
import { getKlinesBatch, HISTORY_LIMIT, getQuotesFailover } from "@/lib/sources";
import { scoreCrossSection, DEFAULT_MOMENTUM_WEIGHTS } from "@/lib/momentum";
import { COMPARE_COLUMNS, percentile, normalizeCodes } from "@/lib/compare";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CompareBody {
  codes?: string[] | string;
  names?: Record<string, string>;
  /** 单只取 K 根数，默认 280。 */
  limit?: number;
  /** 归一化走势叠加图回看交易日数，默认 120。 */
  chartDays?: number;
}

/** 一只标的的对比行：各列原始值 + 横截面百分位（着色用）。 */
interface CompareRow {
  code: string;
  name: string;
  values: Record<string, number | null>;
  pct: Record<string, number | null>;
}

/**
 * POST /api/compare
 * 多标的横向对比：批量取日 K + 实时行情 → 合成横截面动量因子 + 行情列 → 逐列算截面百分位（着色）
 * → 叠加「归一化价格走势」（公共交易日窗口，基点=100）。仅供研究，不构成投资建议。
 */
export async function POST(req: Request) {
  let body: CompareBody = {};
  try {
    body = (await req.json()) as CompareBody;
  } catch {
    /* 允许空 body */
  }

  const codes = normalizeCodes(body.codes);
  if (codes.length === 0) {
    return NextResponse.json({ error: "缺少有效的 codes（6 位代码清单）" }, { status: 400 });
  }
  if (codes.length > 30) {
    return NextResponse.json({ error: "单次最多对比 30 只标的" }, { status: 400 });
  }

  const limit = Math.max(70, Math.min(HISTORY_LIMIT, body.limit ?? 280));
  const chartDays = Math.max(20, Math.min(250, body.chartDays ?? 120));
  const names = body.names ?? {};

  try {
    const [klineMap, quotes] = await Promise.all([
      getKlinesBatch(codes, limit, "baidu-first"),
      getQuotesFailover(codes),
    ]);

    const resolved: Record<string, string> = { ...names };
    for (const [c, q] of Object.entries(quotes)) {
      if (q?.name && (!resolved[c] || resolved[c] === c)) resolved[c] = q.name;
    }

    // 清洗 K 线（升序、剔除异常根），构造打分视图。
    const cleanMap = new Map<string, Candle[]>();
    const view: Array<{ code: string; name: string; history: Candle[] }> = [];
    for (const code of codes) {
      const item = klineMap.get(code);
      const clean = (item?.candles ?? [])
        .filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      cleanMap.set(code, clean);
      if (clean.length >= 30) view.push({ code, name: resolved[code] ?? code, history: clean });
    }

    // 横截面动量因子 + 合成分（与 /momentum 同口径）。
    const scored = scoreCrossSection(view, DEFAULT_MOMENTUM_WEIGHTS);
    const scoreMap = new Map(scored.map((s) => [s.code, s]));

    // 逐标的组装各列原始值。
    const rows: CompareRow[] = codes.map((code) => {
      const q = quotes[code];
      const s = scoreMap.get(code);
      const f = s?.factors;
      const values: Record<string, number | null> = {
        price: q?.price ?? null,
        changePct: q?.changePct ?? null,
        turnoverPct: q?.turnoverPct ?? null,
        r1m: f ? pctOrNull(f.r1m) : null,
        r3m: f ? pctOrNull(f.r3m) : null,
        r6m: f ? pctOrNull(f.r6m) : null,
        skip: f ? pctOrNull(f.skip) : null,
        vol: f ? pctOrNull(f.vol) : null,
        riskAdj: f?.riskAdj ?? null,
        trend: f ? pctOrNull(f.trend) : null,
        composite: s ? Number((s.composite * 100).toFixed(1)) : null,
      };
      return { code, name: resolved[code] ?? code, values, pct: {} };
    });

    // 逐列算横截面百分位（着色），写回每行 pct。
    for (const col of COMPARE_COLUMNS) {
      const colVals = rows.map((r) => r.values[col.key]);
      const ranks = percentile(colVals, col.better);
      rows.forEach((r, i) => {
        r.pct[col.key] = ranks[i];
      });
    }

    // 归一化价格走势叠加：取所有标的公共交易日的最后 chartDays 根，基点 = 100。
    const chart = buildNormalizedSeries(codes, resolved, cleanMap, chartDays);

    return NextResponse.json({
      columns: COMPARE_COLUMNS,
      rows,
      chart,
      asOf: latestDate(cleanMap),
      note: "横向对比：行情 + 横截面动量因子（截面百分位着色）。仅供研究，不构成投资建议。",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `横向对比失败: ${msg}` }, { status: 502 });
  }
}

/** GET：返回列目录与默认参数，便于前端初始化。 */
export async function GET() {
  return NextResponse.json({
    columns: COMPARE_COLUMNS,
    defaults: { limit: 280, chartDays: 120 },
    note: "POST {codes:[...],names?,limit?,chartDays?} 触发多标的横向对比。",
  });
}

function pctOrNull(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : Number((v * 100).toFixed(2));
}

function latestDate(cleanMap: Map<string, Candle[]>): string {
  let d = "";
  for (const candles of cleanMap.values()) {
    const last = candles[candles.length - 1]?.date;
    if (last && last > d) d = last;
  }
  return d;
}

interface NormalizedChart {
  dates: string[];
  series: Array<{ code: string; name: string; points: number[] }>;
}

/** 取所有标的公共交易日的最后 N 根，把每只价格归一化到基点 100。无足够公共日则返回空。 */
function buildNormalizedSeries(
  codes: string[],
  names: Record<string, string>,
  cleanMap: Map<string, Candle[]>,
  chartDays: number,
): NormalizedChart {
  const maps = new Map<string, Map<string, number>>();
  let common: Set<string> | null = null;
  for (const code of codes) {
    const candles = cleanMap.get(code) ?? [];
    if (candles.length === 0) return { dates: [], series: [] };
    const m = new Map<string, number>();
    for (const k of candles) m.set(k.date, k.close);
    maps.set(code, m);
    if (common === null) {
      common = new Set(m.keys());
    } else {
      const next = new Set<string>();
      for (const d of common) if (m.has(d)) next.add(d);
      common = next;
    }
  }
  if (!common || common.size === 0) return { dates: [], series: [] };
  const dates = [...common].sort().slice(-chartDays);
  if (dates.length === 0) return { dates: [], series: [] };
  const series = codes.map((code) => {
    const m = maps.get(code)!;
    const base = m.get(dates[0])!;
    const points = dates.map((d) => Number(((m.get(d)! / base) * 100).toFixed(2)));
    return { code, name: names[code] ?? code, points };
  });
  return { dates, series };
}
