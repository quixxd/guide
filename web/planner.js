// The planner decides WHAT to talk about next and for HOW LONG; the LLM only writes the words.
// Pure: no I/O, no state. Ported from server/planner.ts (unit-tested in test/web/planner.test.js).

import { relativePosition } from "./geo.js";
import { lensFit } from "./lenses.js";

/** @typedef {import("./geo.js").Relative} Relative */
/** @typedef {import("./lenses.js").Lens} Lens */
/** @typedef {"stationary" | "walking" | "vehicle_slow" | "vehicle_fast"} Mode */
/**
 * @typedef {{ lat: number, lon: number, heading: number | null, speed: number | null, facing?: number | null }} Position
 * heading: direction of travel (null when standing). facing: where the listener looks (compass, or the
 * last walking direction), used for the field of view when standing still.
 */
/**
 * @typedef {{ id: string, name: string, lat: number, lon: number, categories: string[], notability: number,
 *   wiki?: { lang: string, title: string, extract: string, length: number }, wikidata?: string,
 *   tags?: Record<string, string>, altNames?: string[] }} Poi
 */
/** @typedef {Relative & { poi: Poi, eta: number | null, passDistance: number | null, score: number, visible: boolean }} Candidate */
/**
 * @typedef {{ kind: "orientation", budgetSec: number, upcoming: Candidate[] }
 *   | { kind: "poi", phase: "now" | "approaching" | "deeper", budgetSec: number, target: Candidate }
 *   | { kind: "lookahead", budgetSec: number, target: Candidate }
 *   | { kind: "area", budgetSec: number, areaName: string }
 *   | { kind: "focus", budgetSec: number, focus: string, target: Candidate | null }
 *   | { kind: "silence", retryMs: number, reason: string }} Plan
 */
/**
 * @typedef {{ pos: Position, mode: Mode, pois: Poi[], lenses: Lens[],
 *   covered: ReadonlyMap<string, number>, announced: ReadonlySet<string>, areasCovered: ReadonlySet<string>,
 *   areaName: string | null, isFirst: boolean, focus: string | null, blocked?: ReadonlySet<string> }} PlanInput
 * blocked: places whose line of sight from the listener crosses another building.
 */

/**
 * horizon: how far around (and ahead) to look, m. near: within this a place is "here now".
 * visible: max sideways distance at which a place can be seen when passing. Segment limits in seconds.
 */
export const PROFILES = {
  stationary: { horizon: 300, near: 200, visible: 200, minSeg: 20, maxSeg: 75, silenceMs: 30000 },
  walking: { horizon: 500, near: 90, visible: 150, minSeg: 15, maxSeg: 60, silenceMs: 15000 },
  vehicle_slow: { horizon: 1500, near: 250, visible: 300, minSeg: 12, maxSeg: 75, silenceMs: 15000 },
  vehicle_fast: { horizon: 6000, near: 1200, visible: 1500, minSeg: 10, maxSeg: 120, silenceMs: 20000 },
};

/** Typical speaking rate of a TTS voice, words per second (~155 wpm). */
export const WORDS_PER_SEC = 2.6;
/** A place this close to coming into view counts as "now". */
const NOW_WINDOW_SEC = 25;
/** Places further than this off the direction you look at (degrees) are out of view: 7–8 o'clock is out. */
export const FOV_LIMIT = 105;
/** Right beside you: always in view, whatever the direction or buildings. */
export const BESIDE_M = 25;

/** @param {number | null} speed m/s @returns {Mode} */
export function detectMode(speed) {
  if (speed === null || speed < 0.6) return "stationary";
  if (speed < 2.8) return "walking"; // < 10 km/h
  if (speed < 9) return "vehicle_slow"; // < 32 km/h
  return "vehicle_fast";
}

/** @param {PlanInput} input @returns {Candidate[]} */
export function rankCandidates(input) {
  const { pos, mode, pois, lenses } = input;
  const profile = PROFILES[mode];
  const moving = pos.heading !== null && pos.speed !== null && pos.speed >= 0.6;
  /** @type {Candidate[]} */
  const out = [];

  for (const poi of pois) {
    // Moving: the direction of travel. Standing: where the listener faces, when known.
    const rel = relativePosition(pos, moving ? pos.heading : pos.facing ?? null, poi);
    if (rel.distance > profile.horizon) continue;
    // Out of the field of view (behind, or 7–8 o'clock), unless right beside you.
    if (rel.relAngle !== null && Math.abs(rel.relAngle) > FOV_LIMIT && rel.distance > BESIDE_M) continue;

    let eta = null;
    let passDistance = null;
    if (moving && rel.relAngle !== null) {
      const rad = (rel.relAngle * Math.PI) / 180;
      const along = rel.distance * Math.cos(rad);
      if (along > 0) {
        eta = along / pos.speed;
        passDistance = Math.abs(rel.distance * Math.sin(rad));
      }
    }
    // Behind and not close: we've passed it.
    if (rel.side === "behind" && rel.distance > profile.near) continue;
    // Approaching, but it will never come within sight.
    if (passDistance !== null && passDistance > profile.horizon / 2 && rel.distance > profile.near) continue;

    const visible = rel.distance <= BESIDE_M || !input.blocked?.has(poi.id);
    const text = `${poi.name} ${poi.wiki?.extract ?? ""} ${poi.categories.join(" ")}`;
    const proximity = 1 - rel.distance / profile.horizon;
    // Prefer what's in front of you, and what you can actually see.
    const inFront = rel.relAngle === null ? 0 : 0.4 * Math.cos((rel.relAngle * Math.PI) / 180);
    const score = poi.notability + lensFit(text, lenses) + proximity + inFront - (visible ? 0 : 1);
    out.push({ ...rel, poi, eta, passDistance, score, visible });
  }
  return out.sort((a, b) => b.score - a.score);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function isNow(c, profile) {
  // Hidden behind buildings: it can be mentioned as nearby, but it isn't "here, look".
  if (!c.visible) return false;
  if (c.distance <= profile.near) return true;
  return c.eta !== null && c.eta <= NOW_WINDOW_SEC && (c.passDistance ?? Infinity) <= profile.visible;
}

/** Decide what to talk about next and for how long. @param {PlanInput} input @returns {Plan} */
export function planSegment(input) {
  const profile = PROFILES[input.mode];
  const ranked = rankCandidates(input);
  const uncovered = ranked.filter((c) => !input.covered.has(c.poi.id) && !c.poi.categories.includes("area"));

  if (input.focus) {
    const f = input.focus.toLowerCase();
    const target =
      ranked.find((c) => c.poi.name.toLowerCase() === f) ??
      ranked.find((c) => c.poi.name.toLowerCase().includes(f) || f.includes(c.poi.name.toLowerCase())) ??
      null;
    return { kind: "focus", budgetSec: Math.max(45, profile.maxSeg), focus: input.focus, target };
  }

  if (input.isFirst) {
    return {
      kind: "orientation",
      budgetSec: input.mode === "vehicle_fast" ? 45 : 35,
      upcoming: uncovered.filter((c) => c.side !== "behind").slice(0, 3),
    };
  }

  // 1. Something notable is here now, or is about to come into view.
  const now = uncovered.filter((c) => isNow(c, profile) && c.poi.notability >= 0.8);
  if (now.length) {
    const target = now[0];
    // Time until the next uncovered place becomes "now" bounds how long we can talk.
    const nextEtas = uncovered
      .filter((c) => c !== target && c.eta !== null && c.eta > NOW_WINDOW_SEC)
      .map((c) => c.eta - NOW_WINDOW_SEC);
    const room = nextEtas.length ? Math.min(...nextEtas) : profile.maxSeg;
    return { kind: "poi", phase: "now", budgetSec: clamp(room, profile.minSeg, profile.maxSeg), target };
  }

  // 2. Something notable is coming up.
  const upcoming = uncovered.filter((c) => c.eta !== null && c.eta > NOW_WINDOW_SEC && c.poi.notability >= 1.5);
  if (upcoming.length) {
    const target = upcoming[0];
    if (input.mode === "vehicle_slow" || input.mode === "vehicle_fast") {
      if (!input.announced.has(target.poi.id)) return { kind: "lookahead", budgetSec: 14, target };
    } else if (target.distance <= 300) {
      // On foot, start telling the story while the listener walks up to it.
      return {
        kind: "poi",
        phase: "approaching",
        budgetSec: clamp(target.eta ?? profile.maxSeg, profile.minSeg, profile.maxSeg),
        target,
      };
    }
  }

  // 3. Standing still next to something we've only covered once: go deeper.
  if (input.mode === "stationary") {
    const deeper = ranked.find(
      (c) => c.distance <= profile.near && input.covered.get(c.poi.id) === 1 && c.poi.notability >= 2,
    );
    if (deeper) return { kind: "poi", phase: "deeper", budgetSec: profile.maxSeg, target: deeper };
    const nearby = uncovered.find((c) => c.visible && c.poi.notability >= 0.8);
    if (nearby) return { kind: "poi", phase: "now", budgetSec: profile.maxSeg * 0.8, target: nearby };
  }

  // 4. Nothing specific: tell the story of the area we're in, once.
  if (input.areaName && !input.areasCovered.has(input.areaName)) {
    return { kind: "area", budgetSec: Math.round(profile.maxSeg * 0.8), areaName: input.areaName };
  }

  return { kind: "silence", retryMs: profile.silenceMs, reason: "nothing new nearby" };
}

/** @param {number} budgetSec */
export function wordBudget(budgetSec) {
  return Math.round(budgetSec * WORDS_PER_SEC);
}
