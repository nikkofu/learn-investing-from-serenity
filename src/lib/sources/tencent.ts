/**
 * 腾讯财经 API（qt.gtimg.cn）— 批量实时行情 + 估值（PE/PB/市值/换手/涨跌停/量比）。
 * 不封 IP、全球可达；支持个股、指数（000001/000300/399006）、ETF（510050…）。
 * V3.2 原则：行情/实时价/市值/估值优先用腾讯，避免东财 push2 被封。
 */

import { classifyCode } from "../market";
import { globalCache, getAdaptiveTTL } from "../cache";
import { UA, num, toNum, fetchRetry, readText } from "./http";
import type { TencentQuote } from "./types";

/** 把 6 位代码转成腾讯前缀代码（sh/sz/bj）。 */
function tencentSymbol(code: string): string {
  return classifyCode(code).tencent;
}

function fmtTime(raw: string | undefined): string {
  if (raw && raw.length >= 14) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;
  }
  return new Date().toISOString();
}

function parseLine(vals: string[]): Omit<TencentQuote, "code"> | null {
  if (vals.length < 53) return null;
  return {
    name: vals[1],
    price: num(vals[3]),
    prevClose: num(vals[4]),
    open: num(vals[5]),
    change: num(vals[31]),
    changePct: num(vals[32]),
    high: num(vals[33]),
    low: num(vals[34]),
    volume: num(vals[6]),
    amountWan: num(vals[37]),
    time: fmtTime(vals[30]),
    turnoverPct: num(vals[38]),
    peTtm: toNum(vals[39]),
    amplitudePct: num(vals[43]),
    totalMarketCapYi: num(vals[44]),
    floatMarketCapYi: num(vals[45]),
    pb: toNum(vals[46]),
    limitUp: num(vals[47]),
    limitDown: num(vals[48]),
    volRatio: num(vals[49]),
    peStatic: toNum(vals[52]),
  };
}

/**
 * 批量拉取腾讯行情。codes 为 6 位代码数组（个股/指数/ETF 混合均可）。
 * 返回 Map<code, TencentQuote>，缺失的代码不会出现在结果里。
 */
export async function getTencentQuotes(codes: string[]): Promise<Map<string, TencentQuote>> {
  const out = new Map<string, TencentQuote>();
  if (codes.length === 0) return out;

  // 腾讯单次 URL 不宜过长，按 60 个一批切分。
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 60) chunks.push(codes.slice(i, i + 60));

  for (const chunk of chunks) {
    const q = chunk.map(tencentSymbol).join(",");
    const res = await fetchRetry(`https://qt.gtimg.cn/q=${q}`, {
      headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
    });
    const text = await readText(res, true);
    for (const line of text.trim().split(";")) {
      if (!line.includes("=") || !line.includes('"')) continue;
      const key = line.split("=")[0].split("_").pop() ?? ""; // 形如 sh600519
      const code = key.slice(2);
      const vals = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')).split("~");
      const parsed = parseLine(vals);
      if (parsed && code) out.set(code, { code, ...parsed });
    }
  }
  return out;
}

/** 单只腾讯行情（带缓存，盘中 8s）。 */
export async function getTencentQuote(code: string): Promise<TencentQuote | null> {
  return globalCache.getOrCreate(
    `tx-quote:${code}`,
    async () => {
      const m = await getTencentQuotes([code]);
      return m.get(code) ?? null;
    },
    getAdaptiveTTL("quote"),
  );
}
