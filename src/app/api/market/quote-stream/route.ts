import { getQuoteFailover } from "@/lib/sources";
import { isAShareActiveTime } from "@/lib/cache";

// 单股实时报价的 SSE 下推端点：服务端轮询上游（腾讯/百度，本身约几秒更新一次），
// 只把 quote 增量推给前端，供 /chart 实时层（顶部报价 + 现价线 + 盘中临时今日蜡烛）使用。
// 与历史 K 线 / 策略 / 缓存完全解耦：本端点不走 2min 行情缓存，盘后/周末推完最后一帧即收。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 盘中轮询间隔：上游约数秒一变，3s 足够实时又不过度请求。
const POLL_MS = 3000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return new Response("请提供 6 位股票代码", { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* 控制器已关闭 */
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      };
      const tick = async () => {
        if (closed) return;
        try {
          const quote = await getQuoteFailover(code);
          send("quote", quote);
        } catch (e) {
          send("err", { message: e instanceof Error ? e.message : "实时报价获取失败" });
        }
        if (closed) return;
        // 非交易时段：推完当前这帧即收，并通知前端停止订阅（避免无谓的重连轮询）。
        if (!isAShareActiveTime()) {
          send("closed", { reason: "market-inactive" });
          close();
          return;
        }
        timer = setTimeout(() => void tick(), POLL_MS);
      };
      // 断线重连间隔提示 + 立即推一帧。
      try {
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
      } catch {
        /* noop */
      }
      req.signal.addEventListener("abort", close);
      void tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
