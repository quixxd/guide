// Client for api/narrate.php: sends a prompt, streams back text. The relay speaks one
// provider-neutral event stream (text / done / error), whichever LLM is behind it.

export class RelayError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Last known "calls used / daily limit" reported by the relay, e.g. "12/300". */
export let callsToday = "";

/**
 * @param {string} token access token
 * @param {string} system
 * @param {string} prompt
 * @param {(text: string) => void} onText
 * @param {AbortSignal} signal
 * @returns {Promise<{ stop: string | null, usage: { in: number | null, out: number | null } | null }>}
 */
export async function streamNarration(token, system, prompt, onText, signal) {
  const res = await fetch("api/narrate.php", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify({ system, messages: [{ role: "user", content: prompt }] }),
    signal,
  });
  callsToday = res.headers.get("x-guide-calls") ?? callsToday;
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // not JSON
    }
    throw new RelayError(message, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let done = { stop: null, usage: null };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += value;
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buffer = buffer.slice(i + 2);
      if (!line) continue;
      const msg = JSON.parse(line.slice(6));
      if (msg.type === "text") onText(msg.text);
      else if (msg.type === "error") throw new RelayError(msg.message, 502);
      else if (msg.type === "done") done = msg;
    }
  }
  return done;
}
