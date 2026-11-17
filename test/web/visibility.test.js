import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLenses } from "../../web/lenses.js";
import { planSegment, rankCandidates } from "../../web/planner.js";
import { hiddenPlaces } from "../../web/visibility.js";

const here = { lat: 53.0757, lon: 8.8075 };
const mLat = (m) => m / 111320;
const mLon = (m) => m / (111320 * Math.cos((here.lat * Math.PI) / 180));
/** A point offset from `here` by metres north/east. */
const at = (north, east) => ({ lat: here.lat + mLat(north), lon: here.lon + mLon(east) });
/** A rectangular building from (south, west) to (north, east), in metres from `here`. */
function box(s, w, n, e) {
  const p = (north, east) => { const q = at(north, east); return [q.lat, q.lon]; };
  return [p(s, w), p(s, e), p(n, e), p(n, w), p(s, w)];
}
function poi(id, north, east, notability = 2.5) {
  return { id, name: id, ...at(north, east), categories: [], notability };
}

test("a place behind another building is hidden; an open line is not", () => {
  const places = [poi("Behind the block", 80, 0), poi("Open view", 0, 80)];
  const buildings = [box(30, -10, 50, 10)]; // a block straight north, 30–50 m away
  const hidden = hiddenPlaces(here, places, buildings);
  assert.deepEqual([...hidden], ["Behind the block"]);
});

test("a place inside its own building is not hidden by that building", () => {
  const cathedral = poi("Cathedral", 60, 0);
  const hidden = hiddenPlaces(here, [cathedral], [box(40, -20, 90, 20)]);
  assert.equal(hidden.size, 0);
});

test("places right beside you are always in view", () => {
  const hidden = hiddenPlaces(here, [poi("Next door", 15, 0)], [box(5, -5, 10, 5)]);
  assert.equal(hidden.size, 0);
});

function input(overrides) {
  return {
    pos: { ...here, heading: 0, speed: 1.4 },
    mode: "walking",
    pois: [],
    lenses: resolveLenses(["history"]),
    covered: new Map(),
    announced: new Set(),
    areasCovered: new Set(),
    areaName: "Altstadt, Bremen",
    isFirst: false,
    focus: null,
    ...overrides,
  };
}

test("places at 7–8 o'clock are out of the field of view", () => {
  // Walking north; 50 m away at about 225° (south-west, 7–8 o'clock).
  const ranked = rankCandidates(input({ pois: [poi("Over your shoulder", -35, -35)] }));
  assert.equal(ranked.length, 0);
});

test("standing still, the facing direction sets the field of view", () => {
  const standing = { ...here, heading: null, speed: 0, facing: 0 }; // facing north
  const ranked = rankCandidates(input({ pos: standing, mode: "stationary", pois: [poi("Ahead", 60, 0), poi("Behind", -60, 0)] }));
  assert.deepEqual(ranked.map((c) => c.poi.id), ["Ahead"]);
});

test("a hidden place is not narrated as 'here now'", () => {
  const pois = [poi("Hidden church", 60, 10)];
  const plan = planSegment(input({ pois, blocked: new Set(["Hidden church"]) }));
  assert.ok(!(plan.kind === "poi" && plan.phase === "now"), `got ${plan.kind}`);
  const open = planSegment(input({ pois }));
  assert.equal(open.kind, "poi");
});

import { mergePois } from "../../web/pois.js";

test("district and borough articles count as areas, not sights", () => {
  const page = (title, extract) => ({ lang: "en", pageId: title.length, title, lat: 53.07, lon: 8.8, extract, length: 5000 });
  const pois = mergePois([
    page("Mitte (Bremen)", "Mitte is a borough of the city of Bremen."),
    page("Bremen Roland", "The Bremen Roland is a statue of Roland."),
  ], []);
  const byName = Object.fromEntries(pois.map((p) => [p.name, p.categories.includes("area")]));
  assert.deepEqual(byName, { Mitte: true, "Bremen Roland": false });
});

import { describeSide, relativePosition } from "../../web/geo.js";

test("directions never use compass names when the facing direction is unknown", () => {
  const rel = relativePosition(here, null, at(50, -50));
  assert.equal(describeSide(rel), "nearby");
  assert.equal(describeSide(relativePosition(here, 0, at(50, -50))), "on your left");
});
