/**
 * Splits a streamed LLM answer into a human-readable "narrative" part (the
 * model thinking out loud) and a trailing fenced JSON payload.
 *
 * The prompts ask the model to first reason in natural language, then emit the
 * structured result inside a ```json code fence. We stream the narrative to the
 * UI token-by-token so the user sees live reasoning for ANY model (not just
 * ones that expose native `reasoning` deltas). The fenced JSON is streamed
 * separately (as `structured`) so the UI can show the structured phase is still
 * making progress instead of looking frozen — without the raw JSON polluting
 * the readable reasoning console. `jsonText` is parsed once the stream completes.
 */
const FENCE = "```json"; // sentinel marking the start of the structured output

/** One push yields narrative (readable) and/or structured (raw JSON) text. */
export interface SplitDelta {
  narrative: string;
  structured: string;
}

export class NarrativeJsonSplitter {
  private buf = ""; // un-emitted narrative tail (guards a fence split across deltas)
  private all = ""; // everything seen (fallback if no fence is emitted)
  private json = ""; // text from the fence onwards
  private inJson = false;

  /** Feed one content delta; returns the narrative/structured text to stream. */
  push(delta: string): SplitDelta {
    this.all += delta;
    if (this.inJson) {
      this.json += delta;
      return { narrative: "", structured: delta };
    }
    this.buf += delta;
    const idx = this.buf.toLowerCase().indexOf(FENCE);
    if (idx !== -1) {
      const narrative = this.buf.slice(0, idx);
      const structured = this.buf.slice(idx); // keep fence so parseJsonObject can strip it
      this.json = structured;
      this.buf = "";
      this.inJson = true;
      return { narrative, structured };
    }
    // Hold back the last (FENCE.length - 1) chars: the fence may be split
    // across deltas, so don't emit a partial prefix as narrative yet.
    const safe = Math.max(0, this.buf.length - (FENCE.length - 1));
    const narrative = this.buf.slice(0, safe);
    this.buf = this.buf.slice(safe);
    return { narrative, structured: "" };
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
