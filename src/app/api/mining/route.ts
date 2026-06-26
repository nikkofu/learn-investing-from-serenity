import { NextResponse } from "next/server";
import { ndjsonStream } from "@/lib/stream";
import { runMiningScan, type MiningRequest } from "@/lib/miningScan";
import { withRequestContext, NORMAL_PRIORITY } from "@/lib/requestContext";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: MiningRequest = {};
  try {
    body = (await req.json()) as MiningRequest;
  } catch {
    /* 允许空 body */
  }

  const wantStream = body.stream !== false;

  // 泳道 mining + 普通优先级：手动扫描与 /scanner 批量诊断公平共享东财限流额度。
  if (!wantStream) {
    try {
      const { summary, results } = await withRequestContext(
        { lane: "mining", priority: NORMAL_PRIORITY },
        () => runMiningScan(body),
      );
      return NextResponse.json({ summary, results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `扫描失败: ${msg}` }, { status: 502 });
    }
  }

  return ndjsonStream((send) =>
    withRequestContext({ lane: "mining", priority: NORMAL_PRIORITY }, async () => {
      await runMiningScan(body, send);
    }),
  );
}

/** 返回挖掘能力的元信息与默认参数，便于页面初始化与 cron 自检。 */
export async function GET() {
  return NextResponse.json({
    universes: [
      { id: "hot", label: "热门人气榜 (Top100，目标>100 自动用全市场补足)" },
      { id: "broad", label: "全市场主板/创业/科创（可排序，默认成交额前 300）" },
      { id: "full", label: "全市场全量（沪深主板+创业板，剔除科创板/ST/*ST/退/北交所）" },
      { id: "sector", label: "指定行业板块成分股（本地已同步）" },
      { id: "custom", label: "自定义代码清单" },
      { id: "demo", label: "演示数据（离线合成，用于预览/自检，不联网）" },
    ],
    sorts: [
      { id: "amount", label: "成交额" },
      { id: "changePct", label: "涨跌幅" },
      { id: "turnover", label: "换手率" },
      { id: "volumeRatio", label: "量比" },
    ],
    defaults: { universe: "hot", size: 300, sort: "amount", concurrency: 8, retries: 3, maxSize: 5000, maxRetries: 10 },
    note: "POST 触发扫描；默认 NDJSON 流式返回进度与命中结果，stream:false 则一次性返回排序后的 JSON（适合 cron）。",
  });
}
