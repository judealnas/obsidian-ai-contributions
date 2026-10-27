import test from "node:test";
import assert from "node:assert/strict";
import { findAiCallouts, reviewChange, applyChange } from "../src/callouts.ts";
import { ReviewHistory, undoChange } from "../src/history.ts";

function review(source, action = "accept", index = 0) {
  const callout = findAiCallouts(source)[index];
  assert.ok(callout, "Expected a reviewable callout");
  const change = reviewChange(source, { source, callout }, action);
  return { result: applyChange(source, change), change };
}

test("accept removes just the header and outer quote markers", () => {
  const source = "Human before.\n\n> [!ai]+ AI Contribution — 2026-10-27\n> ## Heading\n>\n> - Item with [[wikilink]] and $x^2$\n> > Nested quotation\n>     indented code\n\nHuman after.\n";
  assert.equal(review(source).result, "Human before.\n\n## Heading\n\n- Item with [[wikilink]] and $x^2$\n> Nested quotation\n    indented code\n\nHuman after.\n");
});

test("reject removes only the targeted callout, preserving adjacent human content", () => {
  const source = "Human.\n\n> [!ai]+ Contribution\n> Remove me.\n\nHuman stays.\n\n> [!ai]+ Sources\n> [[Keep me]]\n";
  assert.equal(review(source, "reject").result, "Human.\n\n\nHuman stays.\n\n> [!ai]+ Sources\n> [[Keep me]]\n");
});

test("duplicate bodies are selected by their exact positions", () => {
  const source = "> [!ai]+ First\n> Same\n\n> [!ai]+ Second\n> Same\n";
  assert.equal(review(source, "accept", 1).result, "> [!ai]+ First\n> Same\n\nSame\n");
});

test("preserves CRLF, whitespace, and missing final newline", () => {
  assert.equal(review("Before\r\n\r\n> [!AI]- Title\r\n> a  \r\n>\r\n> b").result, "Before\r\n\r\na  \r\n\r\nb");
  assert.equal(review("> [!ai]\n>\ttext\n>  space\n").result, "text\n space\n");
  assert.equal(review("> [!ai]+ Empty").result, "");
  assert.equal(review("> [!ai]\n", "reject").result, "");
});

test("preserves inner fenced code, tables, maths, and block IDs", () => {
  const body = ["```ts", "const value = '> [!ai]';", "```", "", "| A | B |", "| - | - |", "| 1 | 2 |", "$$", "x + y", "$$", "^my-block"].join("\n");
  const source = "> [!ai]+ Contribution\n" + body.split("\n").map((line) => "> " + line).join("\n");
  assert.equal(review(source).result, body);
});

test("all supported header variants, with exact AI type only", () => {
  for (const marker of ["[!ai]", "[!ai]+", "[!ai]-", "[!AI]+ Title", "[!Ai] Sources"]) {
    assert.equal(findAiCallouts("> " + marker + "\n> Content\n").length, 1);
  }
  for (const marker of ["[!note]", "[!ai-other]", "[!ai]oops", "[!ai]++", "[! ai]"]) {
    assert.equal(findAiCallouts("> " + marker + "\n> Content\n").length, 0);
  }
});

test("skips YAML and code examples, including list fences", () => {
  for (const source of [
    "---\nexample: |\n> [!ai]\n> Not real\n---\n",
    "```md\n> [!ai]+ Example\n> Not real\n```\n",
    "~~~~md\n> [!ai]\n> Not real\n~~~\n> [!ai]\n~~~~\n",
    "- ```md\n  > [!ai]\n  > Not real\n  ```\n",
    "    > [!ai]\n    > Indented code\n",
    "> [!quote]\n> > [!ai]\n> > Nested\n"
  ]) assert.equal(findAiCallouts(source).length, 0, source);
});

test("skips comments and raw HTML blocks", () => {
  for (const source of [
    "<!--\n> [!ai]\n> Not real\n-->\n",
    "%%\n> [!ai]\n> Not real\n%%\n",
    "Text %% hidden\n> [!ai]\n> Not real\n%%\n",
    "<div>\n> [!ai]\n> Not real\n</div>\n\n",
    "<script>\n> [!ai]\n> Not real\n</script>\n",
    "<![CDATA[\n> [!ai]\n> Not real\n]]>\n",
    "<?instruction\n> [!ai]\n> Not real\n?>\n",
    "  <?instruction\n> [!ai]\n> Not real\n?>\n",
    "<custom-element>\n> [!ai]\n> Not real\n</custom-element>\n"
  ]) assert.equal(findAiCallouts(source).length, 0, source);
  assert.equal(findAiCallouts("Literal `%%` and `<!--`.\n\n> [!ai]\n> Real\n").length, 1);
});

test("refuses ambiguous lazy continuations and unseparated callout headers", () => {
  assert.equal(findAiCallouts("> [!ai]\n> AI paragraph\nLazy continuation of that paragraph\n").length, 0);
  assert.equal(findAiCallouts("> [!ai]\n> AI\n> [!note]\n> Human?\n").length, 0);
  assert.equal(findAiCallouts("> [!ai]\n> AI\n## Human heading\n").length, 1);
});

test("accept and reject preserve AI note filename metadata content", () => {
  const source = "---\n_AI_Generated: true\nagent: Hermes\n---\n\n> [!ai]+ Contribution\n> Text\n";
  assert.ok(review(source).result.startsWith("---\n_AI_Generated: true\nagent: Hermes\n---\n"));
});

test("stale and forged targets fail without changing the note", () => {
  const source = "> [!ai]\n> Body\n";
  const target = { source, callout: findAiCallouts(source)[0] };
  assert.throws(() => reviewChange("New edits\n" + source, target, "reject"), /note changed/);
  assert.throws(() => reviewChange(source, { source, callout: { ...target.callout, to: 1 } }, "reject"), /original position/);
});

test("undo restores exact original bytes and refuses subsequent edits", () => {
  const source = "Human\r\n\r\n> [!ai]+ Contribution\r\n> Body\r\n";
  for (const action of ["accept", "reject"]) {
    const { result, change } = review(source, action);
    const record = { path: "Example.md", before: source, after: result, change };
    assert.equal(applyChange(result, undoChange(result, record)), source);
    assert.throws(() => undoChange(result + "New text", record), /note changed/);
  }
});

test("session history has a limit and supports ordered undo", () => {
  const history = new ReviewHistory(2);
  history.push({ path: "1" }); history.push({ path: "2" }); history.push({ path: "3" });
  assert.equal(history.peek().path, "3");
  history.pop(); assert.equal(history.peek().path, "2");
  history.pop(); assert.equal(history.peek(), undefined);
  history.push({ path: "4" }); history.clear(); assert.equal(history.peek(), undefined);
});
