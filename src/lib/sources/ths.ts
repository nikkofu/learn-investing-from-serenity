/**
 * 同花顺数据源（不封 IP / 弱风控）：
 *   - 当日强势股 + 题材归因 reason（zx.10jqka.com.cn，独家人工运营标签）
 *   - 北向资金实时分钟流向（data.hexin.cn）
 *   - 机构一致预期 EPS（basic.10jqka.com.cn，HTML 表格）
 */

import { UA, num, fetchRetry, readText } from "./http";
import type { ThsHotStock, NorthboundPoint } from "./types";

interface ThsHotResp {
  errocode?: number;
  errormsg?: string;
  data?: Array<Record<string, unknown>>;
}

/** 同花顺当日强势股归因。date 形如 'YYYY-MM-DD'，默认今天（北京时区）。 */
export async function getThsHotReason(date?: string): Promise<ThsHotStock[]> {
  const d =
    date ??
    new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }))
      .toISOString()
      .slice(0, 10);
  const url = `http://zx.10jqka.com.cn/event/api/getharden/date/${d}/orderby/date/orderway/desc/charset/GBK/`;
  const res = await fetchRetry(url, { headers: { "User-Agent": UA } });
  const json = JSON.parse(await readText(res, true)) as ThsHotResp;
  if (json.errocode && json.errocode !== 0) {
    throw new Error(`同花顺热点错误: ${json.errormsg ?? json.errocode}`);
  }
  return (json.data ?? []).map((r) => ({
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    reason: String(r.reason ?? ""),
    changePct: num(r.zhangfu),
    turnoverPct: num(r.huanshou),
    amount: num(r.chengjiaoe),
    close: num(r.close),
    market: String(r.market ?? ""),
  }));
}

interface HexinResp {
  time?: string[];
  hgt?: number[];
  sgt?: number[];
}

/** 沪深股通当日实时分钟流向（亿元）。net 字段上游自 2024-08 起断供，此处取累计净买入。 */
export async function getNorthboundFlow(): Promise<NorthboundPoint[]> {
  const res = await fetchRetry("https://data.hexin.cn/market/hsgtApi/method/dayChart/", {
    headers: { "User-Agent": UA, Referer: "https://data.hexin.cn/" },
  });
  const d = (await res.json()) as HexinResp;
  const times = d.time ?? [];
  const hgt = d.hgt ?? [];
  const sgt = d.sgt ?? [];
  return times.map((t, i) => ({
    time: t,
    hgtYi: i < hgt.length ? hgt[i] : null,
    sgtYi: i < sgt.length ? sgt[i] : null,
  }));
}

/** 极简 HTML 表格解析（无第三方依赖），返回每个 <table> 的二维单元格数组。 */
function parseHtmlTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const cellRe = /<t[hd][\s\S]*?<\/t[hd]>/gi;
  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  for (const t of html.match(tableRe) ?? []) {
    const rows: string[][] = [];
    for (const r of t.match(rowRe) ?? []) {
      const cells = (r.match(cellRe) ?? []).map(strip);
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

export interface ThsEpsTable {
  headers: string[];
  rows: string[][];
}

/**
 * 同花顺机构一致预期 EPS。返回含「每股收益/均值」的表格（headers + rows）。
 * "均值" 列即一致预期 EPS；"预测机构数" < 3 时需谨慎。找不到则返回首个表格。
 */
export async function getThsEpsForecast(code: string): Promise<ThsEpsTable | null> {
  const res = await fetchRetry(`https://basic.10jqka.com.cn/new/${code}/worth.html`, {
    headers: { "User-Agent": UA, Referer: "https://basic.10jqka.com.cn/" },
  });
  const html = await readText(res, true);
  const tables = parseHtmlTables(html);
  if (!tables.length) return null;

  const target =
    tables.find((t) => t.some((row) => row.some((c) => c.includes("每股收益") || c.includes("均值")))) ??
    tables[0];
  const [headers, ...rows] = target;
  return { headers: headers ?? [], rows };
}
