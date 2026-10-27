import test from "node:test";
import assert from "node:assert/strict";
import { resolveReadingTargets } from "../src/reading.ts";

const source = "Human\n\n> [!ai]+ A\n> Same\n\n> [!ai]+ B\n> Same\n";

test("maps each rendered callout using the actual source range", () => {
  const targets = resolveReadingTargets(source, { text: source, lineStart: 5, lineEnd: 6 }, 1);
  assert.equal(targets[0].callout.startLine, 5);
  assert.equal(targets[0].source, source);
});

test("supports section-only text and full-document text", () => {
  for (const text of [source, "> [!ai]+ A\n> Same", "> [!ai]+ A\r\n> Same\r\n"]) {
    const targets = resolveReadingTargets(source, { text, lineStart: 2, lineEnd: 3 }, 1);
    assert.equal(targets[0].callout.startLine, 2);
  }
});

test("maps multiple rendered callouts in source order", () => {
  const targets = resolveReadingTargets(source, { text: source, lineStart: 0, lineEnd: 7 }, 2);
  assert.deepEqual(targets.map((target) => target.callout.startLine), [2, 5]);
});

test("refuses stale sections, missing locations, and ambiguous counts", () => {
  assert.equal(resolveReadingTargets(source, null, 1), null);
  assert.equal(resolveReadingTargets(source, { text: source, lineStart: 0, lineEnd: 7 }, 1), null);
  assert.equal(resolveReadingTargets(source, { text: "old content", lineStart: 2, lineEnd: 3 }, 1), null);
  assert.equal(resolveReadingTargets(source, { text: source, lineStart: -1, lineEnd: 7 }, 2), null);
});
