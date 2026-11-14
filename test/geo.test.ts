import assert from "node:assert/strict";
import { test } from "node:test";
import { angleDiff, bearingDeg, describeDistance, distanceM, relativePosition } from "../server/geo.ts";

const praca = { lat: 38.7075, lon: -9.1364 }; // Praça do Comércio
const se = { lat: 38.7098, lon: -9.1327 }; // Sé de Lisboa

test("distance between two Lisbon landmarks is about 400 m", () => {
  const d = distanceM(praca, se);
  assert.ok(d > 350 && d < 450, `got ${d}`);
});

test("bearing points north-east from the square to the cathedral", () => {
  const b = bearingDeg(praca, se);
  assert.ok(b > 30 && b < 70, `got ${b}`);
});

test("angleDiff wraps around and is negative to the left", () => {
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(350, 10), -20);
  assert.equal(angleDiff(180, 0), -180);
});

test("relativePosition classifies sides against the heading", () => {
  const north = { lat: praca.lat + 0.001, lon: praca.lon };
  const east = { lat: praca.lat, lon: praca.lon + 0.001 };
  assert.equal(relativePosition(praca, 0, north).side, "ahead");
  assert.equal(relativePosition(praca, 0, east).side, "right");
  assert.equal(relativePosition(praca, 180, east).side, "left");
  assert.equal(relativePosition(praca, 180, north).side, "behind");
  assert.equal(relativePosition(praca, null, north).side, "around");
});

test("describeDistance rounds to friendly numbers", () => {
  assert.equal(describeDistance(20), "right here");
  assert.equal(describeDistance(237), "about 250 metres");
  assert.equal(describeDistance(1540), "about 1.5 km");
  assert.equal(describeDistance(23400), "about 23 km");
});
