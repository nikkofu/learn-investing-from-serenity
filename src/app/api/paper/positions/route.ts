import { NextResponse } from "next/server";
import { getKlinesBatch, getQuotesFailover, HISTORY_LIMIT } from "@/lib/sources";
import {
  currentArbSignal,
  evaluatePair,
  latestPairZ,
  type PairCandidate,
} from "@/lib/pairTrading";
import { getSavedStrategy } from "@/lib/savedStrategies";
import {
  listPaperPositions,
  openPaperPosition,
  applyMark,
  deletePaperPosition,
  clearClosedPositions,
  computeMark,
  autoCloseReason,
  holdDaysBetween,
  summarize,
  type PaperPosition,
} from "@/lib/paperTrades";
import { getUniverseConfig, isExcluded } from "@/lib/universe";
import { NFA } from "@/lib/disclaimers";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 把实时价拼为最后一根：同日覆盖收盘，否则追加一根合成日 K（与 alertEngine 同口径）。 */
function spliceLivePrice(candles: Candle[], price: number, today: string): Candle[] {
  if (!(price > 0) || candles.length === 0) return candles;
  const sorted = [...candles].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  if (last.date === today) {
    sorted[sorted.length - 1] = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    return sorted;
  }
  if (today > last.date) {
    sorted.push({ date: today, open: price, high: price, low: price, close: price, volume: 0, amount: 0, changePct: 0, turnoverPct: 0 });
  }
  return sorted;
}

/** 上海钟（UTC+8）的当前日期 YYYY-MM-DD。 */
function shanghaiToday(): string {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const cleanCandles = (cs: Candle[]): Candle[] => cs.filter((k) => k.close > 0 && k.open > 0 && k.high > 0 && k.low > 0);

interface PaperBody {
  action?: "open" | "refresh" | "close" | "clear";
  /** open：来源沉淀策略 id（与 a/b 二选一）。 */
  strategyId?: string;
  /** open（手动）：配对两腿代码。 */
  a?: string;
  b?: string;
  /** open（手动）：交易参数覆盖。 */
  params?: { lookback?: number; entryZ?: number; exitZ?: number; stopZ?: number; feeBps?: number; maxHoldDays?: number };
  notional?: number;
  note?: string;
  /** close：目标持仓 id。 */
  id?: string;
}

/** 拉取一个配对两腿的清洗 K + 实时报价，并把实时价拼成最后一根。 */
async function fetchPairData(a: string, b: string) {
  const km = await getKlinesBatch([a, b], Math.min(HISTORY_LIMIT, 500), "baidu-first");
  const quotes = await getQuotesFailover([a, b]);
  const today = shanghaiToday();
  const splice = (code: string): Candle[] => {
    let cs = cleanCandles(km.get(code)?.candles ?? []);
    const px = quotes[code]?.price;
    if (px && px > 0) cs = spliceLivePrice(cs, px, today);
    return cs;
  };
  return { aCandles: splice(a), bCandles: splice(b), quotes };
}

/** 盯市全部持仓中纸面仓：重算 z + 实时盈亏，命中回归/止损/超时则自动平仓。 */
async function refreshOpenPositions(): Promise<{ refreshed: number; autoClosed: number }> {
  const all = await listPaperPositions();
  const open = all.filter((p) => p.status === "open");
  if (open.length === 0) return { refreshed: 0, autoClosed: 0 };

  // 批量拉取所有相关代码的 K + 报价，避免逐仓重复请求
  const codes = Array.from(new Set(open.flatMap((p) => [p.pair.a, p.pair.b])));
  const km = await getKlinesBatch(codes, Math.min(HISTORY_LIMIT, 500), "baidu-first");
  const quotes = await getQuotesFailover(codes);
  const today = shanghaiToday();
  const candleOf = (code: string): Candle[] => {
    let cs = cleanCandles(km.get(code)?.candles ?? []);
    const px = quotes[code]?.price;
    if (px && px > 0) cs = spliceLivePrice(cs, px, today);
    return cs;
  };

  let refreshed = 0;
  let autoClosed = 0;
  for (const pos of open) {
    const aCandles = candleOf(pos.pair.a);
    const bCandles = candleOf(pos.pair.b);
    if (aCandles.length === 0 || bCandles.length === 0) continue;
    const pc: PairCandidate = {
      a: pos.pair.a,
      b: pos.pair.b,
      beta: pos.pair.beta,
      adfT: pos.pair.adfT,
      cointegrated: true,
      correlation: pos.pair.correlation,
      halfLifeDays: pos.pair.halfLifeDays,
      n: pos.pair.n,
    };
    const zr = latestPairZ(pc, aCandles, bCandles, pos.params.lookback);
    if (!zr) continue;
    const buyCandles = pos.buyCode === pos.pair.a ? aCandles : bCandles;
    const price = quotes[pos.buyCode]?.price || buyCandles[buyCandles.length - 1]?.close || pos.entryPrice;
    const holdDays = holdDaysBetween(zr.dates, pos.entryDate, zr.asOf);
    const mark = computeMark(pos, price, zr.z, zr.asOf, holdDays);
    const reason = autoCloseReason(mark);
    await applyMark(pos.id, mark, reason);
    refreshed++;
    if (reason) autoClosed++;
  }
  return { refreshed, autoClosed };
}

async function listWithSummary() {
  const positions = await listPaperPositions();
  return { positions, summary: summarize(positions) };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("refresh") === "1") {
    try {
      await refreshOpenPositions();
    } catch {
      /* 盯市失败不阻断列表读取 */
    }
  }
  const { positions, summary } = await listWithSummary();
  return NextResponse.json({
    positions,
    summary,
    note: "纸面仓=按当前开口信号前向跟踪：盯市重算 z 与实时盈亏，命中回归/止损/超时自动平仓。成本走 A 股模型。" + NFA,
  });
}

export async function POST(req: Request) {
  let body: PaperBody = {};
  try {
    body = (await req.json()) as PaperBody;
  } catch {
    /* 允许空 body */
  }
  const action = body.action ?? "open";

  try {
    if (action === "refresh") {
      const r = await refreshOpenPositions();
      const { positions, summary } = await listWithSummary();
      return NextResponse.json({ ...r, positions, summary });
    }

    if (action === "clear") {
      const removed = await clearClosedPositions();
      const { positions, summary } = await listWithSummary();
      return NextResponse.json({ removed, positions, summary });
    }

    if (action === "close") {
      const id = (body.id ?? "").trim();
      if (!id) return NextResponse.json({ error: "缺少持仓 id" }, { status: 400 });
      const all = await listPaperPositions();
      const pos = all.find((p) => p.id === id);
      if (!pos) return NextResponse.json({ error: "持仓不存在" }, { status: 404 });
      if (pos.status !== "open") return NextResponse.json({ error: "该持仓已平仓" }, { status: 400 });
      const { aCandles, bCandles, quotes } = await fetchPairData(pos.pair.a, pos.pair.b);
      const pc: PairCandidate = {
        a: pos.pair.a, b: pos.pair.b, beta: pos.pair.beta, adfT: pos.pair.adfT,
        cointegrated: true, correlation: pos.pair.correlation, halfLifeDays: pos.pair.halfLifeDays, n: pos.pair.n,
      };
      const zr = latestPairZ(pc, aCandles, bCandles, pos.params.lookback);
      if (!zr) return NextResponse.json({ error: "可用 K 线不足，无法盯市平仓" }, { status: 502 });
      const buyCandles = pos.buyCode === pos.pair.a ? aCandles : bCandles;
      const price = quotes[pos.buyCode]?.price || buyCandles[buyCandles.length - 1]?.close || pos.entryPrice;
      const holdDays = holdDaysBetween(zr.dates, pos.entryDate, zr.asOf);
      const mark = computeMark(pos, price, zr.z, zr.asOf, holdDays);
      const updated = await applyMark(pos.id, mark, "manual");
      const { positions, summary } = await listWithSummary();
      return NextResponse.json({ position: updated, positions, summary });
    }

    // action === "open"
    const cfg = getUniverseConfig();
    let pc: PairCandidate;
    let pairMeta: PaperPosition["pair"];
    let params: PaperPosition["params"];
    let strategyId: string | undefined;
    let source: string;
    let name: string | undefined;

    if (body.strategyId) {
      const strat = await getSavedStrategy(body.strategyId.trim());
      if (!strat) return NextResponse.json({ error: "来源策略不存在" }, { status: 404 });
      pc = {
        a: strat.pair.a, b: strat.pair.b, beta: strat.pair.beta, adfT: strat.pair.adfT,
        cointegrated: true, correlation: strat.pair.correlation, halfLifeDays: strat.pair.halfLifeDays, n: strat.pair.n,
      };
      pairMeta = { ...strat.pair };
      params = { ...strat.params };
      strategyId = strat.id;
      source = `strategy:${strat.id}`;
      name = `纸面仓 · ${strat.name}`;
    } else {
      const a = (body.a ?? "").trim();
      const b = (body.b ?? "").trim();
      if (!/^\d{6}$/.test(a) || !/^\d{6}$/.test(b) || a === b) {
        return NextResponse.json({ error: "需提供两只不同的 6 位代码 a、b（或 strategyId）" }, { status: 400 });
      }
      if (isExcluded(a, undefined, cfg) || isExcluded(b, undefined, cfg)) {
        return NextResponse.json({ error: "配对含已排除标的（按主板纯净化口径）" }, { status: 400 });
      }
      const { aCandles, bCandles } = await fetchPairData(a, b);
      if (aCandles.length < 250 || bCandles.length < 250) {
        return NextResponse.json({ error: "可用 K 线不足（每腿需 ≥250 根）" }, { status: 502 });
      }
      const evald = evaluatePair(a, b, aCandles, bCandles, { minOverlap: 120 });
      if (!evald) return NextResponse.json({ error: "两腿重叠样本不足，无法估计协整" }, { status: 502 });
      pc = evald;
      // 名称留待下方用开口信号那次报价补全
      pairMeta = {
        a, b, aName: a, bName: b,
        beta: evald.beta, adfT: evald.adfT, halfLifeDays: evald.halfLifeDays, correlation: evald.correlation, n: evald.n,
      };
      params = {
        lookback: body.params?.lookback ?? 60,
        entryZ: body.params?.entryZ ?? 2.0,
        exitZ: body.params?.exitZ ?? 0.5,
        stopZ: body.params?.stopZ ?? 3.5,
        feeBps: body.params?.feeBps ?? 30,
        maxHoldDays: body.params?.maxHoldDays ?? 120,
      };
      source = "arb";
    }

    // 拉数据、求当前开口信号（含实时拼接），无开口则不可建仓
    const { aCandles, bCandles, quotes } = await fetchPairData(pc.a, pc.b);
    if (aCandles.length === 0 || bCandles.length === 0) {
      return NextResponse.json({ error: "可用 K 线不足，无法建仓" }, { status: 502 });
    }
    const sig = currentArbSignal(pc, aCandles, bCandles, params);
    if (!sig) {
      return NextResponse.json(
        { error: `当前无开口信号（|z| < 入场阈 ${params.entryZ}），均值回归仓需在价差显著偏离时建。` },
        { status: 409 },
      );
    }
    const buyCandles = sig.buyCode === pc.a ? aCandles : bCandles;
    const entryPrice = quotes[sig.buyCode]?.price || buyCandles[buyCandles.length - 1]?.close || 0;

    // 名称补全（沉淀策略已带名；手动模式上面已尽量取）
    if (!pairMeta.aName || pairMeta.aName === pairMeta.a) pairMeta.aName = quotes[pc.a]?.name || pairMeta.a;
    if (!pairMeta.bName || pairMeta.bName === pairMeta.b) pairMeta.bName = quotes[pc.b]?.name || pairMeta.b;
    const buyName = sig.buyCode === pc.a ? pairMeta.aName : pairMeta.bName;

    const pos = await openPaperPosition({
      strategyId,
      source,
      name,
      note: body.note,
      pair: pairMeta,
      params,
      side: sig.side,
      buyCode: sig.buyCode,
      buyName,
      deRiskCode: sig.deRiskCode,
      entryDate: sig.asOf,
      entryPrice,
      entryZ: sig.z,
      notional: body.notional,
    });
    const { positions, summary } = await listWithSummary();
    return NextResponse.json({ position: pos, positions, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const ok = await deletePaperPosition(id);
  if (!ok) return NextResponse.json({ error: "持仓不存在" }, { status: 404 });
  const { positions, summary } = await listWithSummary();
  return NextResponse.json({ ok: true, positions, summary });
}
