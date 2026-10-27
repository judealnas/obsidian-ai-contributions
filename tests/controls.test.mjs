import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createReviewControls } from "../src/controls.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("buttons are labelled, keyboard reachable, and do not toggle the callout", async () => {
  const dom = new JSDOM("<div id='title'></div>");
  const title = dom.window.document.getElementById("title");
  let folded = 0;
  let reviewed = "";
  title.addEventListener("click", () => folded++);
  const controls = createReviewControls({ document: dom.window.document, onAction: (action) => { reviewed = action; }, onError: assert.fail });
  title.append(controls);
  const accept = controls.querySelector("button");
  assert.equal(accept.getAttribute("aria-label"), "Accept AI contribution");
  assert.equal(accept.tabIndex, 0);
  accept.click(); await tick();
  assert.equal(reviewed, "accept");
  assert.equal(folded, 0);
  assert.ok([...controls.querySelectorAll("button")].every((button) => button.disabled));
  dom.window.close();
});

test("reject fires once while a write is in progress", async () => {
  const dom = new JSDOM();
  let finish;
  let calls = 0;
  const controls = createReviewControls({
    document: dom.window.document,
    onAction: async (action) => { assert.equal(action, "reject"); calls++; await new Promise((resolve) => { finish = resolve; }); },
    onError: assert.fail
  });
  const reject = controls.querySelectorAll("button")[1];
  reject.click(); reject.click();
  assert.equal(calls, 1);
  finish(); await tick();
  dom.window.close();
});

test("write failures re-enable controls and surface the error", async () => {
  const dom = new JSDOM();
  const failure = new Error("Changed note");
  let error;
  const controls = createReviewControls({ document: dom.window.document, onAction: () => { throw failure; }, onError: (value) => { error = value; } });
  controls.querySelector("button").click(); await tick();
  assert.equal(error, failure);
  assert.ok([...controls.querySelectorAll("button")].every((button) => !button.disabled));
  dom.window.close();
});

test("unmapped previews display disabled controls with a useful explanation", () => {
  const dom = new JSDOM();
  const controls = createReviewControls({ document: dom.window.document, unavailable: "Open source note", onAction: assert.fail, onError: assert.fail });
  for (const button of controls.querySelectorAll("button")) {
    assert.equal(button.disabled, true);
    assert.equal(button.title, "Open source note");
    button.click();
  }
  dom.window.close();
});
