import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import { describeDistance, describeDuration, describeSide } from "./geo.ts";
import type { Lens } from "./lenses.ts";
import type { Candidate, Mode, Plan } from "./planner.ts";
import { wordBudget } from "./planner.ts";
import type { Segment } from "./session.ts";
import type { Place } from "./sources/nominatim.ts";

const client = new Anthropic();

const STYLE_RULES = `How to write:
- Spoken English only. Short, natural sentences that sound good read aloud. No markdown, lists, headings, emoji, stage directions or parentheses.
- Talk to the listener directly. Use the directions and distances given in the brief ("on your left", "just ahead"); never invent a direction or distance.
- Lead with what makes a place interesting. One good story beats five dry facts.
- Continue naturally from what you said earlier (under RECENTLY SAID). Never repeat it. Refer back to it when that adds something.
- Tell things through the listener's chosen lenses and follow their steering notes.

Facts:
- Use only facts found in SOURCES or the brief. If the sources don't cover something, don't fill the gap from memory: say less, or say you're not sure.
- Never make up names, dates, numbers or stories.`;

const NARRATION_SYSTEM = `You are the voice of a personal audio tour guide app. The listener is on holiday, walking or riding through a place with headphones on. Everything you write is read aloud by a text-to-speech voice.

${STYLE_RULES}
- Stay within the word budget: it is sized so you finish before the listener reaches the next thing. Ending a little short is better than running over.

After the narration, on a new final line, write "CARDS:" followed by 1 to 3 short topic names from what you just said, separated by " | ": the main place first, then notable people, events or topics you mentioned. They appear on screen as tappable topics and are not read aloud.`;

const ASK_SYSTEM = `You are the voice of a personal audio tour guide app. The listener is on holiday, walking or riding through a place with headphones on. They just held the talk button and said something to you. Everything you write after the first line is read aloud by a text-to-speech voice.

The first line of your reply must be exactly one of:
INTENT: question
INTENT: steer | <one sentence describing how future commentary should change>
INTENT: control | <pause, resume, skip, repeat or stop>

Use "steer" when they ask to change what the tour talks about or how (topics, depth, tone, length, how often you talk). Use "control" for playback commands. Anything else is a question.

Then, from the second line, the spoken reply:
- question: answer directly, usually 20 to 90 words, more only if they ask you to go deeper. If it's unclear which place they mean, ask a short clarifying question. "That" or "this" usually means what you just talked about or what is closest in the direction they mention.
- steer: a short spoken acknowledgment, under 12 words.
- control: a very short acknowledgment, or nothing.

${STYLE_RULES}`;

function modePhrase(mode: Mode, speed: number | null): string {
  const kmh = speed ? Math.round(speed * 3.6) : 0;
  switch (mode) {
    case "stationary":
      return "standing still";
    case "walking":
      return `walking at about ${kmh} km/h`;
    case "vehicle_slow":
      return `riding slowly through town (bus, tram or car) at about ${kmh} km/h`;
    case "vehicle_fast":
      return `driving or riding at about ${kmh} km/h`;
  }
}

function where(c: Candidate): string {
  const parts = [describeSide(c), describeDistance(c.distance)];
  if (c.eta !== null && c.eta > 20) parts.push(`reached in ${describeDuration(c.eta)}`);
  return parts.join(", ");
}

function briefFor(plan: Exclude<Plan, { kind: "silence" }>): string {
  switch (plan.kind) {
    case "orientation": {
      const up = plan.upcoming.map((c) => `${c.poi.name} (${where(c)})`).join("; ");
      return `This is the opening of the tour. Say where the listener is and what this place is in a sentence or two, then mention what's coming up${up ? `: ${up}` : ""}. Warm and brief.`;
    }
    case "poi": {
      const t = plan.target;
      if (plan.phase === "now") return `Talk about ${t.poi.name}, ${where(t)}. The listener is passing it now.`;
      if (plan.phase === "approaching")
        return `${t.poi.name} is coming up, ${where(t)}. Start telling its story now, while the listener walks towards it.`;
      return `The listener has stopped near ${t.poi.name} (${where(t)}). Go deeper: a story, a detail to look for, something you haven't said yet.`;
    }
    case "lookahead":
      return `Give a short heads-up that ${plan.target.poi.name} is coming up, ${where(plan.target)}. Just enough to make them look forward to it; the full story comes when they get close.`;
    case "area":
      return `Nothing specific is right next to the listener. Talk about the area they are in, ${plan.areaName}: pick one theme that fits their lenses.`;
    case "focus":
      return plan.target
        ? `The listener tapped "${plan.focus}" on screen to hear more. Go deeper on it (${where(plan.target)}).`
        : `The listener tapped the topic "${plan.focus}" on screen to hear more. Go deeper on it, and link it to where they are if the sources allow.`;
  }
}

export type Context = {
  mode: Mode;
  /** The listener's local time, as reported by their device ("14:05"). */
  localTime: string | null;
  speed: number | null;
  place: Place | null;
  lenses: Lens[];
  steering: string[];
  nearby: Candidate[];
  covered: ReadonlyMap<string, number>;
  recent: Segment[];
  sources: { title: string; text: string }[];
};

function contextBlock(ctx: Context): string {
  const lines: string[] = [];
  lines.push(`LISTENER: ${modePhrase(ctx.mode, ctx.speed)}.${ctx.localTime ? ` Local time ${ctx.localTime}.` : ""}`);
  if (ctx.place?.label) lines.push(`LOCATION: ${ctx.place.label}`);
  lines.push(`LENSES: ${ctx.lenses.map((l) => `${l.label} (${l.covers})`).join("; ")}`);
  if (ctx.steering.length) lines.push(`STEERING NOTES (most recent last):\n${ctx.steering.map((s) => `- ${s}`).join("\n")}`);
  if (ctx.nearby.length) {
    const near = ctx.nearby
      .slice(0, 8)
      .map((c) => `- ${c.poi.name}: ${where(c)}${ctx.covered.has(c.poi.id) ? " (already talked about)" : ""}`);
    lines.push(`NEARBY:\n${near.join("\n")}`);
  }
  if (ctx.recent.length) {
    const said = ctx.recent.map((s) => `- ${s.text.length > 700 ? `${s.text.slice(0, 700)}…` : s.text}`);
    lines.push(`RECENTLY SAID (oldest first):\n${said.join("\n")}`);
  }
  if (ctx.sources.length) {
    lines.push(`SOURCES:\n${ctx.sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.text}`).join("\n\n")}`);
  } else {
    lines.push("SOURCES: none available. Stick to what the brief and location tell you, and keep it short.");
  }
  return lines.join("\n\n");
}

export function narrationPrompt(plan: Exclude<Plan, { kind: "silence" }>, ctx: Context): string {
  const words = wordBudget(plan.budgetSec);
  return `BRIEF: ${briefFor(plan)}\n\nWORD BUDGET: about ${words} words (${Math.round(plan.budgetSec)} seconds of speech).\n\n${contextBlock(ctx)}`;
}

export function askPrompt(question: string, ctx: Context): string {
  return `THE LISTENER SAID: "${question}"\n\n${contextBlock(ctx)}`;
}

export type StreamResult = { usage: Anthropic.Beta.BetaUsage | null; refused: boolean };

/** Streams a reply from Claude, calling onText for each text delta. */
export async function streamClaude(
  kind: "narration" | "ask",
  prompt: string,
  onText: (delta: string) => void,
  signal: AbortSignal,
): Promise<StreamResult> {
  const stream = client.beta.messages.stream(
    {
      model: config.narrationModel,
      max_tokens: 4000,
      system: kind === "narration" ? NARRATION_SYSTEM : ASK_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
  }
  const final = await stream.finalMessage();
  return { usage: final.usage, refused: final.stop_reason === "refusal" };
}
