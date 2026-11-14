import assert from "node:assert/strict";
import { test } from "node:test";
import { CardsSplitter, FirstLineSplitter, parseIntent } from "../server/parsers.ts";

function feed(splitter: CardsSplitter, chunks: string[]): string {
  return chunks.map((c) => splitter.push(c)).join("");
}

test("CardsSplitter strips the cards line even when the marker is split across chunks", () => {
  const s = new CardsSplitter();
  const spoken = feed(s, ["This is the Sé. It survived the earthquake.\nCA", "RDS: Sé Cathedral | 1755 ", "earthquake"]);
  const end = s.finish();
  assert.equal((spoken + end.text).trim(), "This is the Sé. It survived the earthquake.");
  assert.deepEqual(end.cards, ["Sé Cathedral", "1755 earthquake"]);
});

test("CardsSplitter passes everything through when there are no cards", () => {
  const s = new CardsSplitter();
  const spoken = feed(s, ["Hello ", "there."]);
  const end = s.finish();
  assert.equal(spoken + end.text, "Hello there.");
  assert.deepEqual(end.cards, []);
});

test("parseIntent understands the three intents", () => {
  assert.deepEqual(parseIntent("INTENT: question"), { type: "question" });
  assert.deepEqual(parseIntent("INTENT: steer | More about everyday life, less about kings."), {
    type: "steer",
    note: "More about everyday life, less about kings.",
  });
  assert.deepEqual(parseIntent("intent: control | Pause"), { type: "control", action: "pause" });
  assert.deepEqual(parseIntent("INTENT: control | dance"), { type: "question" });
  assert.deepEqual(parseIntent("Sure, here's the answer"), { type: "question" });
});

test("FirstLineSplitter holds text until the first newline", () => {
  const s = new FirstLineSplitter();
  assert.equal(s.push("INTENT: que"), "");
  assert.equal(s.push("stion\nThe tower"), "The tower");
  assert.equal(s.firstLine, "INTENT: question");
  assert.equal(s.push(" is old."), " is old.");
});
