/**
 * 新浪财报三表（资产负债表 fzb / 利润表 lrb / 现金流量表 llb）。
 * 不封 IP；V3.2 原则：能从新浪/腾讯拿到的财务数据优先，不走东财。
 */

import { classifyCode } from "../market";
import { UA, num, fetchRetry, qs } from "./http";
import type { Candle } from "../types";
import type { SinaReportPeriod, SinaReportType } from "./types";

/** 新浪行情符号前缀：sh / sz / bj。 */
function sinaSymbol(code: string): string {
  const m = classifyCode(code).market;
  const p = m === "SH" ? "sh" : m === "BJ" ? "bj" : "sz";
  return p + code;
}

interface SinaKlineRow {
  day?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

/** 新浪 datalen 实测可取上限（远高于旧代码自设的 1023，足够约 12 年日线）。 */
export const SINA_KLINE_MAX = 8000;

/**
 * 新浪日 K 线（scale=240 即日线），不封 IP、全球可达，作为 push2his/百度的互备源。
 * 新浪只返回 OHLCV，无成交额/换手率/涨跌幅，涨跌幅按前收盘价推算，缺失字段置 0。
 */
export async function getSinaKline(code: string, limit = 360): Promise<Candle[]> {
  const datalen = Math.max(1, Math.min(SINA_KLINE_MAX, limit));
  const url =
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?" +
    qs({ symbol: sinaSymbol(code), scale: 240, ma: "no", datalen });
  const res = await fetchRetry(url, {
    headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn/" },
  });
  const rows = (await res.json()) as SinaKlineRow[];
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const close = num(r.close);
    const prev = i > 0 ? num(rows[i - 1].close) : num(r.open);
    out.push({
      date: r.day ?? "",
      open: num(r.open),
      close,
      high: num(r.high),
      low: num(r.low),
      volume: num(r.volume),
      amount: 0,
      changePct: prev ? Math.round(((close - prev) / prev) * 100 * 100) / 100 : 0,
      turnoverPct: 0,
    });
  }
  return out.slice(-limit);
}

interface SinaReportItem {
  item_title?: string;
  item_value?: string | null;
  item_tongbi?: string | null;
}
interface SinaResp {
  result?: {
    data?: { report_list?: Record<string, { data?: SinaReportItem[] }> };
  };
}

/**
 * 新浪财报三表，返回按报告期倒序的记录列表。
 * 每期 items 含「科目 -> 值」，有同比时附 "<科目>_同比"。
 */
export async function getSinaFinancialReport(
  code: string,
  reportType: SinaReportType = "lrb",
  num = 8,
): Promise<SinaReportPeriod[]> {
  const prefix = classifyCode(code).market === "SH" ? "sh" : "sz";
  const url =
    "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022?" +
    qs({ paperCode: `${prefix}${code}`, source: reportType, type: "0", page: "1", num: String(num) });

  const res = await fetchRetry(url, { headers: { "User-Agent": UA }, timeoutMs: 15000 });
  const d = (await res.json()) as SinaResp;
  const reportList = d.result?.data?.report_list ?? {};

  const periods = Object.keys(reportList).sort().reverse().slice(0, num);
  return periods.map((period) => {
    const items: Record<string, string> = {};
    for (const it of reportList[period]?.data ?? []) {
      const title = it.item_title ?? "";
      if (!title || it.item_value === null || it.item_value === undefined) continue;
      items[title] = it.item_value;
      if (it.item_tongbi !== null && it.item_tongbi !== undefined && it.item_tongbi !== "") {
        items[`${title}_同比`] = it.item_tongbi;
      }
    }
    return {
      period: `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}`,
      items,
    };
  });
}
