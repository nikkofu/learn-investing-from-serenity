/**
 * 百度股市通 K线 — 独有能力：返回自带 MA5/MA10/MA20 均价，无需本地计算。
 * 作为 push2his 日线的备选源（不封 IP）。
 */

import { UA, num, toNum, fetchRetry, qs } from "./http";
import type { BaiduCandle } from "./types";

interface BaiduResult {
  Result?: { newMarketData?: { keys?: string[]; marketData?: string } };
}

/**
 * 拉取百度日 K（自带均线）。start_time 为空表示全量。
 * 字段按返回的 keys 动态定位，缺失的均线字段返回 null。
 */
export async function getBaiduKline(code: string, startTime = ""): Promise<BaiduCandle[]> {
  const url =
    "https://finance.pae.baidu.com/selfselect/getstockquotation?" +
    qs({
      all: "1",
      isIndex: "false",
      isBk: "false",
      isBlock: "false",
      isFutures: "false",
      isStock: "true",
      newFormat: "1",
      group: "quotation_kline_ab",
      finClientType: "pc",
      code,
      start_time: startTime,
      ktype: "1",
    });
  const res = await fetchRetry(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/vnd.finance-web.v1+json",
      Origin: "https://gushitong.baidu.com",
      Referer: "https://gushitong.baidu.com/",
    },
  });
  const d = (await res.json()) as BaiduResult;
  const md = d.Result?.newMarketData ?? {};
  const keys = md.keys ?? [];
  const rows = (md.marketData ?? "").split(";").filter(Boolean);

  const idx = (name: string) => keys.indexOf(name);
  const iTime = idx("time");
  const iOpen = idx("open");
  const iClose = idx("close");
  const iHigh = idx("high");
  const iLow = idx("low");
  const iVol = idx("volume");
  const iAmt = idx("amount");
  const iTurn = idx("turnoverratio");
  const iMa5 = idx("ma5avgprice");
  const iMa10 = idx("ma10avgprice");
  const iMa20 = idx("ma20avgprice");

  const pick = (p: string[], i: number) => (i >= 0 ? p[i] : undefined);

  return rows.map((line) => {
    const p = line.split(",");
    return {
      date: pick(p, iTime) ?? "",
      open: num(pick(p, iOpen)),
      close: num(pick(p, iClose)),
      high: num(pick(p, iHigh)),
      low: num(pick(p, iLow)),
      volume: num(pick(p, iVol)),
      amount: num(pick(p, iAmt)),
      turnoverPct: num(pick(p, iTurn)),
      ma5: toNum(pick(p, iMa5)),
      ma10: toNum(pick(p, iMa10)),
      ma20: toNum(pick(p, iMa20)),
    };
  });
}
