import assert from "node:assert/strict";
import { test } from "node:test";
import { factChips, factsText, formatWikidataTime } from "../../web/details.js";

test("Wikidata dates are worded by how precise they are", () => {
  assert.equal(formatWikidataTime("+1405-01-01T00:00:00Z", 9), "1405");
  assert.equal(formatWikidataTime("+1400-01-01T00:00:00Z", 8), "the 1400s");
  assert.equal(formatWikidataTime("+1401-01-01T00:00:00Z", 7), "the 15th century");
  assert.equal(formatWikidataTime("+1301-01-01T00:00:00Z", 7), "the 14th century");
  assert.equal(formatWikidataTime("-0044-03-15T00:00:00Z", 11), "44 BC");
});

const townHall = {
  built: "the 1400s", architects: [], styles: ["Weser Renaissance", "Brick Gothic"], unesco: true,
  heritage: ["World Heritage Site"], namedAfter: [], commissionedBy: [], dedicatedTo: [], religion: [], usedBy: [],
  partOf: ["Town Hall and Roland on the Marketplace of Bremen"],
};

test("fact chips pick the most telling facts, at most four", () => {
  assert.deepEqual(factChips(townHall), ["Built in the 1400s", "UNESCO World Heritage", "Weser Renaissance · Brick Gothic"]);
  const busy = { ...townHall, architects: ["A", "B", "C"], height: 30, dedicatedTo: ["Saint Peter"] };
  assert.equal(factChips(busy).length, 4);
});

test("facts for the narration list everything known", () => {
  const text = factsText(townHall);
  assert.match(text, /Built: the 1400s/);
  assert.match(text, /Style: Weser Renaissance, Brick Gothic/);
  assert.match(text, /Part of: Town Hall and Roland/);
  assert.equal(factsText({ ...townHall, built: undefined, styles: [], heritage: [], partOf: [], unesco: false }), "");
});
