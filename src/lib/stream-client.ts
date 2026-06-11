/** Read an NDJSON response line-by-line, invoking `onEvent` for each JSON object. */
export async function readNdjson(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void
): Promise<void> {
  if (!res.body) throw new Error("无响应流");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as Record<string, unknown>);
    }
  }
  const tail = buf.trim();
  if (tail) onEvent(JSON.parse(tail) as Record<string, unknown>);
}
