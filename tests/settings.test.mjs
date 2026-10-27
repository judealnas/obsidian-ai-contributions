import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CALLOUT_TAG, normalizeCalloutTag, readSettings } from "../src/settings-model.ts";
import { applyChange, findAiCallouts, reviewChange } from "../src/callouts.ts";
import { resolveReadingTargets } from "../src/reading.ts";

test("saved settings retain ai as the default and reject malformed values", () => {
  for (const data of [null, undefined, {}, { calloutTag: 42 }, { calloutTag: "[!assistant]" }, { calloutTag: 'ai\"]' }]) {
    assert.deepEqual(readSettings(data), { calloutTag: DEFAULT_CALLOUT_TAG });
  }
  assert.deepEqual(readSettings({ calloutTag: " Assistant_Review-2 " }), { calloutTag: "assistant_review-2" });
  assert.equal(normalizeCalloutTag("  "), "ai");
  for (const value of ["[!ai]", "two words", "a.b", "a\nb", 'a"', "-ai"]) {
    assert.throws(() => normalizeCalloutTag(value), /Use only/);
  }
});

test("custom tags match exactly and are used for review validation", () => {
  const source = "> [!ai]+ Old\n> Leave AI alone\n\n> [!ASSISTANT_REVIEW-2]- Custom\n> Keep this\n\n> [!assistant_review-2-extra]\n> Leave this too\n";
  const callouts = findAiCallouts(source, "assistant_review-2");
  assert.equal(callouts.length, 1);
  const target = { source, callout: callouts[0] };
  assert.equal(applyChange(source, reviewChange(source, target, "accept", "assistant_review-2")),
    "> [!ai]+ Old\n> Leave AI alone\n\nKeep this\n\n> [!assistant_review-2-extra]\n> Leave this too\n");
  assert.throws(() => reviewChange(source, target, "reject"), /original position/);
  assert.equal(findAiCallouts("```md\n> [!assistant]\n> Example\n```", "assistant").length, 0);
});

test("Reading view maps only the configured custom type in a mixed section", () => {
  const source = "> [!ai]\n> Old\n\n> [!assistant]\n> New\n";
  const section = { text: source, lineStart: 0, lineEnd: 4 };
  const targets = resolveReadingTargets(source, section, 1, "assistant");
  assert.equal(targets[0].callout.startLine, 3);
  assert.equal(resolveReadingTargets(source, section, 1)[0].callout.startLine, 0);
});
