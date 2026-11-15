import assert from "node:assert/strict";
import { test } from "node:test";
// Same cases as test/planner.test.ts, run against the phone port in web/planner.js.
import { resolveLenses } from "../../web/lenses.js";
import { detectMode, planSegment } from "../../web/planner.js";

const here = { lat: 38.71, lon: -9.135, heading: 0, speed: 1.4 }; // walking north

/** A POI offset from `here` by metres north/east. */
function poi(id, north, east, notability = 2.5, categories = []) {
  return {
    id,
    name: id,
    lat: here.lat + north / 111320,
    lon: here.lon + east / (111320 * Math.cos((here.lat * Math.PI) / 180)),
    categories,
    notability,
  };
}

function input(overrides) {
  return {
    pos: here,
    mode: "walking",
    pois: [],
    lenses: resolveLenses(["surprise"]),
    covered: new Map(),
    announced: new Set(),
    areasCovered: new Set(),
    areaName: "Baixa, Lisbon",
    isFirst: false,
    focus: null,
    ...overrides,
  };
}

test("detectMode buckets speeds", () => {
  assert.equal(detectMode(null), "stationary");
  assert.equal(detectMode(0.3), "stationary");
  assert.equal(detectMode(1.4), "walking");
  assert.equal(detectMode(6), "vehicle_slow");
  assert.equal(detectMode(25), "vehicle_fast");
});

test("first segment is an orientation listing what's ahead, not behind", () => {
  const plan = planSegment(input({ isFirst: true, pois: [poi("Ahead", 200, 0), poi("Behind", -300, 0)] }));
  assert.equal(plan.kind, "orientation");
  if (plan.kind !== "orientation") return;
  assert.deepEqual(plan.upcoming.map((c) => c.poi.id), ["Ahead"]);
});

test("a notable place right here is covered now", () => {
  const plan = planSegment(input({ pois: [poi("Church", 40, 20)] }));
  assert.equal(plan.kind, "poi");
  if (plan.kind === "poi") {
    assert.equal(plan.target.poi.id, "Church");
    assert.equal(plan.phase, "now");
    assert.equal(plan.target.side, "ahead");
  }
});

test("the budget shrinks when the next place is close", () => {
  // Next place becomes "now" in ~(150/1.4 - 25) ≈ 82 s; clamp to the walking max of 60 s.
  const roomy = planSegment(input({ pois: [poi("Here", 30, 0), poi("Far", 150, 0)] }));
  // Next place in ~(60/1.4 - 25) ≈ 18 s.
  const tight = planSegment(input({ pois: [poi("Here", 30, 0), poi("Near", 60, 10)] }));
  assert.equal(roomy.kind, "poi");
  assert.equal(tight.kind, "poi");
  if (roomy.kind === "poi" && tight.kind === "poi") {
    assert.equal(roomy.budgetSec, 60);
    assert.ok(tight.budgetSec < 25, `got ${tight.budgetSec}`);
  }
});

test("places already behind us are skipped", () => {
  const plan = planSegment(input({ pois: [poi("Passed", -200, 0)], areaName: null }));
  assert.equal(plan.kind, "silence");
});

test("covered places aren't repeated; the area story comes next, then silence", () => {
  const pois = [poi("Church", 40, 0)];
  const first = planSegment(input({ pois, covered: new Map([["Church", 1]]) }));
  assert.equal(first.kind, "area");
  const second = planSegment(input({ pois, covered: new Map([["Church", 1]]), areasCovered: new Set(["Baixa, Lisbon"]) }));
  assert.equal(second.kind, "silence");
});

test("on foot, a notable place ahead is narrated while approaching", () => {
  const plan = planSegment(input({ pois: [poi("Cathedral", 250, 0, 3)] }));
  assert.equal(plan.kind, "poi");
  if (plan.kind === "poi") assert.equal(plan.phase, "approaching");
});

test("in a vehicle, a notable place ahead gets a look-ahead heads-up once", () => {
  const driving = { ...here, speed: 20 };
  const pois = [poi("Castle", 4000, 300, 3)];
  const plan = planSegment(input({ pos: driving, mode: "vehicle_fast", pois }));
  assert.equal(plan.kind, "lookahead");
  const again = planSegment(input({ pos: driving, mode: "vehicle_fast", pois, announced: new Set(["Castle"]) }));
  assert.notEqual(again.kind, "lookahead");
});

test("a tapped topic card takes priority and matches a nearby place by name", () => {
  const plan = planSegment(input({ pois: [poi("Sé Cathedral", 100, 0)], focus: "sé cathedral" }));
  assert.equal(plan.kind, "focus");
  if (plan.kind === "focus") assert.equal(plan.target?.poi.id, "Sé Cathedral");
});

test("standing still next to a well-covered place goes deeper", () => {
  const still = { ...here, heading: null, speed: 0 };
  const plan = planSegment(input({ pos: still, mode: "stationary", pois: [poi("Castle", 50, 50, 3)], covered: new Map([["Castle", 1]]) }));
  assert.equal(plan.kind, "poi");
  if (plan.kind === "poi") assert.equal(plan.phase, "deeper");
});
