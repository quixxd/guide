import { relativePosition, type LatLon, type Relative } from "./geo.ts";
import { lensFit, type Lens } from "./lenses.ts";
import type { Poi } from "./pois.ts";

export type Mode = "stationary" | "walking" | "vehicle_slow" | "vehicle_fast";

export type Position = LatLon & {
  /** Direction of travel in degrees, null when unknown (e.g. standing still). */
  heading: number | null;
  /** Metres per second, null when unknown. */
  speed: number | null;
};

type Profile = {
  /** How far around (and ahead) to look for things to talk about, metres. */
  horizon: number;
  /** Within this distance a place counts as "here now". */
  near: number;
  /** Max sideways distance at which a place can still be seen when passing. */
  visible: number;
  minSeg: number;
  maxSeg: number;
  /** Pause before re-checking when there's nothing to say. */
  silenceMs: number;
};

export const PROFILES: Record<Mode, Profile> = {
  stationary: { horizon: 300, near: 200, visible: 200, minSeg: 20, maxSeg: 75, silenceMs: 30000 },
  walking: { horizon: 500, near: 90, visible: 150, minSeg: 15, maxSeg: 60, silenceMs: 15000 },
  vehicle_slow: { horizon: 1500, near: 250, visible: 300, minSeg: 12, maxSeg: 75, silenceMs: 15000 },
  vehicle_fast: { horizon: 6000, near: 1200, visible: 1500, minSeg: 10, maxSeg: 120, silenceMs: 20000 },
};

/** Typical speaking rate of a TTS voice, words per second (~155 wpm). */
export const WORDS_PER_SEC = 2.6;
/** A place this close to coming into view counts as "now". */
const NOW_WINDOW_SEC = 25;

export function detectMode(speed: number | null): Mode {
  if (speed === null || speed < 0.6) return "stationary";
  if (speed < 2.8) return "walking"; // < 10 km/h
  if (speed < 9) return "vehicle_slow"; // < 32 km/h: city traffic, buses, trams
  return "vehicle_fast";
}

export type Candidate = Relative & {
  poi: Poi;
  /** Seconds until closest approach, null if not approaching (or speed unknown). */
  eta: number | null;
  /** Distance at closest approach, null if not approaching. */
  passDistance: number | null;
  score: number;
};

export type Plan =
  | { kind: "orientation"; budgetSec: number; upcoming: Candidate[] }
  | { kind: "poi"; phase: "now" | "approaching" | "deeper"; budgetSec: number; target: Candidate }
  | { kind: "lookahead"; budgetSec: number; target: Candidate }
  | { kind: "area"; budgetSec: number; areaName: string }
  | { kind: "focus"; budgetSec: number; focus: string; target: Candidate | null }
  | { kind: "silence"; retryMs: number; reason: string };

export type PlanInput = {
  pos: Position;
  mode: Mode;
  pois: Poi[];
  lenses: Lens[];
  /** How many times each POI id has been talked about this session. */
  covered: ReadonlyMap<string, number>;
  /** POIs that already got a look-ahead heads-up. */
  announced: ReadonlySet<string>;
  /** Areas (neighbourhoods, towns) that already got an area story. */
  areasCovered: ReadonlySet<string>;
  areaName: string | null;
  isFirst: boolean;
  focus: string | null;
};

export function rankCandidates(input: PlanInput): Candidate[] {
  const { pos, mode, pois, lenses } = input;
  const profile = PROFILES[mode];
  const moving = pos.heading !== null && pos.speed !== null && pos.speed >= 0.6;
  const out: Candidate[] = [];

  for (const poi of pois) {
    const rel = relativePosition(pos, moving ? pos.heading : null, poi);
    if (rel.distance > profile.horizon) continue;

    let eta: number | null = null;
    let passDistance: number | null = null;
    if (moving && rel.relAngle !== null) {
      const rad = (rel.relAngle * Math.PI) / 180;
      const along = rel.distance * Math.cos(rad);
      if (along > 0) {
        eta = along / pos.speed!;
        passDistance = Math.abs(rel.distance * Math.sin(rad));
      }
    }
    // Behind and not close: we've passed it.
    if (rel.side === "behind" && rel.distance > profile.near) continue;
    // Approaching, but it will never come within sight.
    if (passDistance !== null && passDistance > profile.horizon / 2 && rel.distance > profile.near) continue;

    const text = `${poi.name} ${poi.wiki?.extract ?? ""} ${poi.categories.join(" ")}`;
    const proximity = 1 - rel.distance / profile.horizon;
    const score = poi.notability + lensFit(text, lenses) + proximity;
    out.push({ ...rel, poi, eta, passDistance, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function isNow(c: Candidate, profile: Profile): boolean {
  if (c.distance <= profile.near) return true;
  return c.eta !== null && c.eta <= NOW_WINDOW_SEC && (c.passDistance ?? Infinity) <= profile.visible;
}

/** Decide what to talk about next and for how long. Pure: no I/O, no session mutation. */
export function planSegment(input: PlanInput): Plan {
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
      .map((c) => c.eta! - NOW_WINDOW_SEC);
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
    const nearby = uncovered.find((c) => c.poi.notability >= 0.8);
    if (nearby) return { kind: "poi", phase: "now", budgetSec: profile.maxSeg * 0.8, target: nearby };
  }

  // 4. Nothing specific: tell the story of the area we're in, once.
  if (input.areaName && !input.areasCovered.has(input.areaName)) {
    return { kind: "area", budgetSec: Math.round(profile.maxSeg * 0.8), areaName: input.areaName };
  }

  return { kind: "silence", retryMs: profile.silenceMs, reason: "nothing new nearby" };
}

export function wordBudget(budgetSec: number): number {
  return Math.round(budgetSec * WORDS_PER_SEC);
}
