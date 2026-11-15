// One walk: memory of what's been said, and preparing the next segment (where are we, what's
// around, what to talk about, which sources, which prompt). Ported from server/tour.ts and
// server/session.ts; the session now lives in the page.

import { describeDistance, describeSide } from "./geo.js";
import { resolveLenses } from "./lenses.js";
import { NARRATION_SYSTEM, narrationPrompt } from "./narrator.js";
import { PROFILES, detectMode, planSegment, rankCandidates } from "./planner.js";
import { localWikiLang, poisAround } from "./pois.js";
import { articleText, reverseGeocode, searchArticle } from "./sources.js";

/** @typedef {import("./planner.js").Poi} Poi */
/** @typedef {import("./planner.js").Plan} Plan */
/** @typedef {import("./planner.js").Position} Position */
/** @typedef {import("./planner.js").Candidate} Candidate */
/** @typedef {import("./sources.js").Place} Place */

export class Session {
  constructor(lensIds = ["history"]) {
    this.lenses = resolveLenses(lensIds);
    /** @type {Map<string, number>} times each place has been talked about */
    this.covered = new Map();
    /** @type {Set<string>} */
    this.announced = new Set();
    /** @type {Set<string>} */
    this.areasCovered = new Set();
    /** @type {string[]} what was said, oldest first */
    this.segments = [];
  }

  /** Records a segment that has started playing, so the planner won't pick the same thing again. */
  record(prepared) {
    const { plan } = prepared;
    const target = "target" in plan ? plan.target : null;
    if (target) this.covered.set(target.poi.id, (this.covered.get(target.poi.id) ?? 0) + 1);
    if (plan.kind === "lookahead") this.announced.add(plan.target.poi.id);
    if (plan.kind === "area") this.areasCovered.add(plan.areaName);
    if (plan.kind === "orientation" && prepared.areaName) this.areasCovered.add(prepared.areaName);
  }

  /** Adds the spoken text, once complete, so later prompts can continue from it. */
  remember(text) {
    if (!text.trim()) return;
    this.segments.push(text.trim());
    if (this.segments.length > 12) this.segments.shift();
  }
}

/** Describes an OSM-only place from its tags, for when there's no Wikipedia article. @param {Poi} poi */
function tagSummary(poi) {
  const t = poi.tags ?? {};
  const facts = [
    t.historic && `Type: ${t.historic.replace(/_/g, " ")}`,
    t.tourism && `Tourism: ${t.tourism}`,
    t.amenity && `Amenity: ${t.amenity.replace(/_/g, " ")}`,
    t.religion && `Religion: ${t.religion}${t.denomination ? ` (${t.denomination})` : ""}`,
    t.start_date && `Built: ${t.start_date}`,
    t.architect && `Architect: ${t.architect}`,
    t["building:architecture"] && `Style: ${t["building:architecture"]}`,
    t.heritage && "Listed heritage site",
    t.description && `Description: ${t.description}`,
    t["description:en"] && `Description: ${t["description:en"]}`,
  ].filter(Boolean);
  return `${poi.name}. ${facts.join(". ")}`;
}

/** @param {Poi} poi @param {boolean} full */
async function poiSource(poi, full) {
  if (!poi.wiki) return { title: `${poi.name} (OpenStreetMap)`, text: tagSummary(poi) };
  const text = full ? await articleText(poi.wiki.lang, poi.wiki.title).catch(() => poi.wiki.extract) : poi.wiki.extract;
  return { title: `${poi.wiki.title} (Wikipedia, ${poi.wiki.lang})`, text: text || poi.wiki.extract };
}

/** @param {Exclude<Plan, { kind: "silence" }>} plan @param {Place | null} place */
async function sourcesFor(plan, place) {
  /** @type {{ title: string, text: string }[]} */
  const sources = [];
  const add = async (p) => {
    const s = await p.catch(() => null);
    if (s?.text) sources.push(s);
  };
  const search = (q) => searchArticle("en", q).then((r) => (r ? { title: `${r.title} (Wikipedia, en)`, text: r.text } : null));

  switch (plan.kind) {
    case "poi":
      await add(poiSource(plan.target.poi, true));
      break;
    case "lookahead":
      await add(poiSource(plan.target.poi, false));
      break;
    case "focus":
      if (plan.target) await add(poiSource(plan.target.poi, true));
      else await add(search([plan.focus, place?.town].filter(Boolean).join(" ")));
      break;
    case "area":
      await add(search(plan.areaName));
      break;
    case "orientation":
      await Promise.all([
        add(search([place?.neighbourhood, place?.town].filter(Boolean).join(" ") || "")),
        ...plan.upcoming.slice(0, 2).map((c) => add(poiSource(c.poi, false))),
      ]);
      break;
  }
  return sources;
}

function areaNameFor(place) {
  if (!place) return null;
  return [...new Set([place.neighbourhood ?? place.town, place.town].filter(Boolean))].join(", ") || null;
}

function localTime() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Short description of a plan, for the debug panel and status line. @param {Plan} plan */
export function planSummary(plan) {
  if (plan.kind === "silence") return `silence (${plan.reason})`;
  const target = "target" in plan && plan.target ? plan.target : null;
  const what = target ? `${target.poi.name}, ${describeSide(target)}, ${describeDistance(target.distance)}` : plan.kind === "area" ? plan.areaName : "";
  return `${plan.kind}${"phase" in plan ? `/${plan.phase}` : ""} ${Math.round(plan.budgetSec)} s${what ? `: ${what}` : ""}`;
}

/**
 * @typedef {{ plan: Plan, mode: string, place: Place | null, pois: Poi[], ranked: Candidate[],
 *   areaName: string | null, system?: string, prompt?: string }} Prepared
 */

/**
 * Works out what to say next at this position. Does all the lookups; doesn't touch the session.
 * @param {Session} session @param {Position} pos @param {string | null} focus
 * @returns {Promise<Prepared>}
 */
export async function prepareSegment(session, pos, focus = null) {
  const mode = detectMode(pos.speed);
  const place = await reverseGeocode(pos.lat, pos.lon).catch(() => null);
  const pois = await poisAround(pos.lat, pos.lon, PROFILES[mode].horizon, localWikiLang(place?.countryCode)).catch(() => []);
  const areaName = areaNameFor(place);
  const input = {
    pos,
    mode,
    pois,
    lenses: session.lenses,
    covered: session.covered,
    announced: session.announced,
    areasCovered: session.areasCovered,
    areaName,
    isFirst: session.segments.length === 0,
    focus,
  };
  const ranked = rankCandidates(input);
  const plan = planSegment(input);
  /** @type {Prepared} */
  const prepared = { plan, mode, place, pois, ranked, areaName };
  if (plan.kind === "silence") return prepared;

  const sources = await sourcesFor(plan, place);
  prepared.system = NARRATION_SYSTEM;
  prepared.prompt = narrationPrompt(plan, {
    mode,
    localTime: localTime(),
    speed: pos.speed,
    place,
    lenses: session.lenses,
    nearby: ranked,
    covered: session.covered,
    recent: session.segments.slice(-5),
    sources,
  });
  return prepared;
}
