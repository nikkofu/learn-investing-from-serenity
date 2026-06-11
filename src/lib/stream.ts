/**
 * Wrap a producer in an NDJSON streaming Response. The producer receives a
 * `send` callback; every object it sends is serialized as one JSON line so the
 * browser can render progress (stages, tokens, results) in real time.
 */
export function ndjsonStream(
  producer: (send: (event: unknown) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await producer(send);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
