// Prompts for the narration LLM. The planner's brief, word budget, context and sources go in;
// spoken text comes out. Ported from server/narrator.ts (push-to-talk and topic cards are
// not part of the phone prototype yet).

import { describeDistance, describeDuration, describeSide } from "./geo.js";
import { wordBudget } from "./planner.js";

/** @typedef {import("./planner.js").Candidate} Candidate */
/** @typedef {import("./planner.js").Plan} Plan */
/** @typedef {import("./planner.js").Mode} Mode */
/** @typedef {import("./lenses.js").Lens} Lens */
/** @typedef {import("./sources.js").Place} Place */

export const NARRATION_SYSTEM = `You are the voice of a personal audio tour guide app. The listener is on holiday, walking through a place with headphones on. Everything you write is read aloud by a text-to-speech voice.

How to write:
- Spoken English only. Short, natural sentences that sound good read aloud. No markdown, lists, headings, emoji, stage directions or parentheses.
- Talk to the listener directly. Use the directions and distances given in the brief ("on your left", "just ahead"); never invent a direction or distance.
- Never use compass directions ("north", "to the south-west", "eastern side"), even when the sources do: people on a walk can't relate to them. Say left, right, ahead or behind as the brief gives them, or point to something visible ("across the square", "by the river"); if the brief says only "nearby", don't give a direction.
- Only ask the listener to look at something, or describe what they can see of it, when the brief says it's in view. A place marked "hidden behind buildings" is nearby but out of sight: talk about it as close by or around the corner.
- Lead with what makes a place interesting. One good story beats five dry facts.
- Continue naturally from what you said earlier (under RECENTLY SAID). Never repeat it. Refer back to it when that adds something.
- Tell things through the listener's chosen lens.
- Don't greet the listener or say goodbye, except in the opening segment.
- Write numbers, years and dates in digits ("1404", "in 1755", "about 100 metres", "the 15th century"), never spelled out as words: the text is also shown on screen, and the voice reads digits correctly.

Facts:
- Use only facts found in SOURCES or the brief. If the sources don't cover something, don't fill the gap from memory: say less, or say you're not sure.
- Never make up names, dates, numbers or stories.
- A "Facts about …" source is structured data from Wikidata and OpenStreetMap: trust it for dates, architects, styles and heritage status. "the 1400s" means only the decade is known; "the 15th century" only the century: don't turn those into an exact year.

Length:
- Stay within the word budget: it is sized so you finish before the listener reaches the next thing. Ending a little short is better than running over.`;

function modePhrase(mode, speed) {
  const kmh = speed ? Math.round(speed * 3.6) : 0;
  switch (mode) {
    case "stationary":
      return "standing still";
    case "walking":
      return `walking at about ${kmh} km/h`;
    case "vehicle_slow":
      return `moving slowly through town at about ${kmh} km/h`;
    default:
      return `moving at about ${kmh} km/h`;
  }
}

/** @param {Candidate} c */
export function where(c) {
  const parts = [describeSide(c), describeDistance(c.distance)];
  if (c.eta !== null && c.eta > 20) parts.push(`reached in ${describeDuration(c.eta)}`);
  parts.push(c.visible ? "in view" : "hidden behind buildings");
  return parts.join(", ");
}

/** @param {Exclude<Plan, { kind: "silence" }>} plan */
function briefFor(plan) {
  switch (plan.kind) {
    case "orientation": {
      const up = plan.upcoming.map((c) => `${c.poi.name} (${where(c)})`).join("; ");
      return `This is the opening of the walk. Say where the listener is and what this place is in a sentence or two, then mention what's coming up${up ? `: ${up}` : ""}. Warm and brief.`;
    }
    case "poi": {
      const t = plan.target;
      if (plan.phase === "now") return `Talk about ${t.poi.name}, ${where(t)}. The listener is passing it now.`;
      if (plan.phase === "approaching") {
        return `${t.poi.name} is coming up, ${where(t)}. Start telling its story now, while the listener walks towards it.`;
      }
      return `The listener has stopped near ${t.poi.name} (${where(t)}). Go deeper: a story, a detail to look for, something you haven't said yet.`;
    }
    case "lookahead":
      return `Give a short heads-up that ${plan.target.poi.name} is coming up, ${where(plan.target)}. Just enough to make them look forward to it.`;
    case "area":
      return `Nothing specific is right next to the listener. Talk about the area they are in, ${plan.areaName}: pick one theme that fits their lens.`;
    case "focus":
      return plan.target
        ? `The listener asked to hear more about "${plan.focus}". Go deeper on it (${where(plan.target)}).`
        : `The listener asked to hear more about "${plan.focus}". Go deeper on it, and link it to where they are if the sources allow.`;
  }
}

/**
 * @typedef {{ mode: Mode, localTime: string, speed: number | null, place: Place | null, lenses: Lens[],
 *   nearby: Candidate[], covered: ReadonlyMap<string, number>, recent: string[],
 *   sources: { title: string, text: string }[] }} Context
 */

/** @param {Context} ctx */
function contextBlock(ctx) {
  const lines = [];
  lines.push(`LISTENER: ${modePhrase(ctx.mode, ctx.speed)}. Local time ${ctx.localTime}.`);
  if (ctx.place?.label) lines.push(`LOCATION: ${ctx.place.label}`);
  lines.push(`LENS: ${ctx.lenses.map((l) => `${l.label} (${l.covers})`).join("; ")}`);
  if (ctx.nearby.length) {
    const near = ctx.nearby
      .slice(0, 8)
      .map((c) => `- ${c.poi.name}: ${where(c)}${ctx.covered.has(c.poi.id) ? " (already talked about)" : ""}`);
    lines.push(`NEARBY:\n${near.join("\n")}`);
  }
  if (ctx.recent.length) {
    const said = ctx.recent.map((t) => `- ${t.length > 700 ? `${t.slice(0, 700)}…` : t}`);
    lines.push(`RECENTLY SAID (oldest first):\n${said.join("\n")}`);
  }
  if (ctx.sources.length) {
    lines.push(`SOURCES:\n${ctx.sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.text}`).join("\n\n")}`);
  } else {
    lines.push("SOURCES: none available. Stick to what the brief and location tell you, and keep it short.");
  }
  return lines.join("\n\n");
}

/** @param {Exclude<Plan, { kind: "silence" }>} plan @param {Context} ctx */
export function narrationPrompt(plan, ctx) {
  const words = wordBudget(plan.budgetSec);
  return `BRIEF: ${briefFor(plan)}\n\nWORD BUDGET: about ${words} words (${Math.round(plan.budgetSec)} seconds of speech).\n\n${contextBlock(ctx)}`;
}
