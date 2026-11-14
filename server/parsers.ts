/**
 * Splits a streamed narration into the spoken part and a trailing "CARDS: a | b" line,
 * without ever emitting a partial "CARDS:" marker to the listener.
 */
export class CardsSplitter {
  private buffer = "";
  private inCards = false;
  private cardsRaw = "";
  private static readonly MARKER = "CARDS:";

  /** Feed a text delta; returns the text that is safe to speak now. */
  push(delta: string): string {
    if (this.inCards) {
      this.cardsRaw += delta;
      return "";
    }
    this.buffer += delta;
    const idx = this.buffer.indexOf(CardsSplitter.MARKER);
    if (idx >= 0) {
      this.inCards = true;
      this.cardsRaw = this.buffer.slice(idx + CardsSplitter.MARKER.length);
      const out = this.buffer.slice(0, idx);
      this.buffer = "";
      return out;
    }
    // Hold back a tail that could be the start of the marker.
    const keep = CardsSplitter.MARKER.length - 1;
    const out = this.buffer.slice(0, Math.max(0, this.buffer.length - keep));
    this.buffer = this.buffer.slice(out.length);
    return out;
  }

  /** Call at the end of the stream; returns remaining speakable text and the parsed cards. */
  finish(): { text: string; cards: string[] } {
    const text = this.inCards ? "" : this.buffer;
    this.buffer = "";
    const cards = this.cardsRaw
      .split("\n")[0]
      .split("|")
      .map((c) => c.trim().replace(/^["'“]|["'”.]$/g, ""))
      .filter((c) => c.length > 0 && c.length <= 60)
      .slice(0, 3);
    return { text, cards };
  }
}

export type Intent =
  | { type: "question" }
  | { type: "steer"; note: string }
  | { type: "control"; action: "pause" | "resume" | "skip" | "repeat" | "stop" };

const CONTROL_ACTIONS = new Set(["pause", "resume", "skip", "repeat", "stop"]);

/** Parses the first line of a push-to-talk reply: "INTENT: question | steer | <note> | control | <action>". */
export function parseIntent(line: string): Intent {
  const m = line.match(/^\s*INTENT:\s*(\w+)\s*(?:\|\s*(.*))?$/i);
  if (!m) return { type: "question" };
  const kind = m[1].toLowerCase();
  const arg = (m[2] ?? "").trim();
  if (kind === "steer" && arg) return { type: "steer", note: arg };
  if (kind === "control" && CONTROL_ACTIONS.has(arg.toLowerCase())) {
    return { type: "control", action: arg.toLowerCase() as "pause" };
  }
  return { type: "question" };
}

/** Buffers a stream until its first line is complete, then hands the rest through. */
export class FirstLineSplitter {
  private buffer = "";
  private done = false;
  firstLine: string | null = null;

  push(delta: string): string {
    if (this.done) return delta;
    this.buffer += delta;
    const nl = this.buffer.indexOf("\n");
    if (nl < 0) return "";
    this.done = true;
    this.firstLine = this.buffer.slice(0, nl);
    const rest = this.buffer.slice(nl + 1);
    this.buffer = "";
    return rest;
  }

  /** At end of stream: if no newline ever came, the whole thing was the first line. */
  finish(): void {
    if (!this.done) {
      this.firstLine = this.buffer;
      this.done = true;
      this.buffer = "";
    }
  }
}
