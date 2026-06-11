/**
 * Splits a streamed LLM answer into a human-readable "narrative" part (the
 * model thinking out loud) and a trailing fenced JSON payload.
 *
 * The prompts ask the model to first reason in natural language, then emit the
 * structured result inside a ```json code fence. We stream the narrative to the
 * UI token-by-token so the user sees live reasoning for ANY model (not just
 * ones that expose native `reasoning` deltas), while keeping the raw JSON out
 * of the visible console. `jsonText` is parsed once the stream completes.
 */
const FENCE = "```json"; // sentinel marking the start of the structured output

export class NarrativeJsonSplitter {
  private buf = ""; // un-emitted narrative tail (guards a fence split across deltas)
  private all = ""; // everything seen (fallback if no fence is emitted)
  private json = ""; // text from the fence onwards
  private inJson = false;

  /** Feed one content delta; returns the narrative text to stream (may be ""). */
  push(delta: string): string {
    this.all += delta;
    if (this.inJson) {
      this.json += delta;
      return "";
    }
    this.buf += delta;
    const idx = this.buf.toLowerCase().indexOf(FENCE);
    if (idx !== -1) {
      const narrative = this.buf.slice(0, idx);
      this.json = this.buf.slice(idx); // keep the fence so parseJsonObject can strip it
      this.buf = "";
      this.inJson = true;
      return narrative;
    }
    // Hold back the last (FENCE.length - 1) chars: the fence may be split
    // across deltas, so don't emit a partial prefix as narrative yet.
    const safe = Math.max(0, this.buf.length - (FENCE.length - 1));
    const out = this.buf.slice(0, safe);
    this.buf = this.buf.slice(safe);
    return out;
  }

  /** Flush any buffered narrative at stream end (no fence was found). */
  end(): string {
    if (this.inJson) return "";
    const out = this.buf;
    this.buf = "";
    return out;
  }

  /** Whether the structured (JSON) phase has begun — narrative is finished. */
  get inJsonPhase(): boolean {
    return this.inJson;
  }

  /** The text to parse as JSON: the fenced block, or the whole answer as fallback. */
  get jsonText(): string {
    return this.inJson ? this.json : this.all;
  }
}
