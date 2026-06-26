import { NextResponse } from "next/server";
import { ndjsonStream } from "@/lib/stream";
import { withRequestContext, INTERACTIVE_PRIORITY } from "@/lib/requestContext";
import type { MiningFilters } from "@/lib/mining";
import type { Prefilter } from "@/lib/miningScan";
import {
  generateDailyPool,
  loadDailyPool,
  loadLatestPool,
  listPoolDates,
  todayStr,
  DAILY_DEFAULTS,
} from "@/lib/dailyPool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/mining/daily[?date=YYYY-MM-DD]
 * 秒读已存盘的当日（或指定日期）股票池；当日缺失时回退到最近一次并标记 stale。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined;
  const today = todayStr();

  const wanted = await loadDailyPool(date);
  if (wanted) {
    return NextResponse.json({ stale: false, requestedDate: date ?? today, pool: wanted, dates: await listPoolDates() });
  }

  // 当日/指定日期没有 → 回退最近一次。
  const latest = await loadLatestPool();
  return NextResponse.json({
    stale: true,
    requestedDate: date ?? today,
    pool: latest,
    dates: await listPoolDates(),
    note: latest ? "当日尚未生成股票池，返回最近一次结果。点击「生成今日股票池」刷新。" : "尚无任何股票池，请先生成。",
  });
}

interface DailyPostBody {
  stream?: boolean;
  includeBJ?: boolean;
  concurrency?: number;
  retries?: number;
  filters?: MiningFilters;
  /** 粗筛阈值覆盖（默认仅跳过停牌，保全量覆盖）；传 null 可完全关闭。 */
  prefilter?: Prefilter | null;
}

/**
 * POST /api/mining/daily
 * 触发当日全市场全量「刚发出 B 信号」扫描并落盘。
 * 默认 NDJSON 流式进度；stream:false 一次性返回（适合 cron/定时任务）。
 */
export async function POST(req: Request) {
  let body: DailyPostBody = {};
  try {
    body = (await req.json()) as DailyPostBody;
  } catch {
    /* 允许空 body，用默认参数 */
  }

  const opts = {
    includeBJ: body.includeBJ,
    concurrency: body.concurrency,
    retries: body.retries,
    filters: body.filters,
    prefilter: body.prefilter,
  };
  const wantStream = body.stream !== false;

  // 泳道 mining-daily + 交互优先级：生成今日股票池是前台交互请求，其候选池拉取
  // 应优先于 /scanner 的批量诊断，避免被后者饫死（详见 docs/perf-concurrency-analysis.md）。
  if (!wantStream) {
    try {
      const file = await withRequestContext(
        { lane: "mining-daily", priority: INTERACTIVE_PRIORITY },
        () => generateDailyPool(opts),
      );
      return NextResponse.json({ ok: true, meta: file.meta, count: file.results.length, results: file.results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: `生成当日股票池失败: ${msg}` }, { status: 502 });
    }
  }

  return ndjsonStream((send) =>
    withRequestContext({ lane: "mining-daily", priority: INTERACTIVE_PRIORITY }, async () => {
      // 立即回一条 ack：告知前端请求已到达后端、开始拉取候选池（区别于「还卡在浏览器队列」）。
      send({ type: "accepted", message: "已受理，正在拉取全市场候选池…" });
      const file = await generateDailyPool(opts, send);
      // 扫描的 done 事件后，再补一条 saved 事件，告知已落盘的清单与元信息。
      send({ type: "saved", date: file.meta.date, generatedAt: file.meta.generatedAt, count: file.results.length });
    }),
  );
}

/** 返回当日股票池能力的默认参数（便于页面初始化与 cron 自检）。 */
export async function PUT() {
  return NextResponse.json({ defaults: DAILY_DEFAULTS, today: todayStr(), dates: await listPoolDates() });
}
