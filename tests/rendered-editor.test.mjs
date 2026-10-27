import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { RenderedEditorControls } from "../src/rendered-editor.ts";
import { findAiCallouts } from "../src/callouts.ts";

test("Live Preview rendered titles bind to the owning editor's source position", async () => {
  const dom = new JSDOM("<div id='editor'><div id='content'></div></div>");
  const source = "Human\n\n> [!ai]+ Contribution\n> Body\n";
  const callout = findAiCallouts(source)[0];
  const content = dom.window.document.getElementById("content");
  content.innerHTML = "<div class='callout' data-callout='ai'><div class='callout-title'><div class='callout-title-inner'>Contribution</div></div></div>";
  const measures = [];
  const view = { dom: dom.window.document.getElementById("editor"), contentDOM: content,
    posAtDOM: () => callout.from, requestMeasure: (measure) => measures.push(measure) };
  let reviewed;
  const binder = new RenderedEditorControls(view, { onReview: async (editor, target, action) => { reviewed = { editor, target, action }; }, onError: assert.fail });
  function flush() {
    for (const measure of measures.splice(0)) measure.write(measure.read());
  }
  try {
    binder.update([{ source, callout }]); flush();
    assert.equal(content.querySelectorAll(".ai-contributions-actions").length, 1);
    view.posAtDOM = () => callout.to;
    binder.update([{ source, callout }]); flush();
    assert.equal(content.querySelectorAll(".ai-contributions-actions").length, 1);
    content.querySelector(".ai-contributions-accept").click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reviewed.editor, view);
    assert.equal(reviewed.action, "accept");
    assert.equal(reviewed.target.callout.from, callout.from);
    binder.update([]); flush();
    assert.equal(content.querySelectorAll(".ai-contributions-actions").length, 0);
  } finally { binder.destroy(); dom.window.close(); }
});

test("Live Preview ignores ambiguous mappings, mismatched titles, and embedded source files", () => {
  const dom = new JSDOM("<div id='editor'><div id='content'></div></div>");
  const source = "> [!ai]+ Actual title\n> Body\n";
  const target = { source, callout: findAiCallouts(source)[0] };
  const content = dom.window.document.getElementById("content");
  const view = { dom: dom.window.document.getElementById("editor"), contentDOM: content, posAtDOM: () => 0, requestMeasure: (measure) => measure.write(measure.read()) };
  const binder = new RenderedEditorControls(view, { onReview: assert.fail, onError: assert.fail });
  try {
    content.innerHTML = "<div class='callout' data-callout='ai'><div class='callout-title'><div class='callout-title-inner'>Different title</div></div></div>";
    binder.update([target]);
    assert.equal(content.querySelector("button"), null);
    content.querySelector(".callout-title-inner").textContent = "Actual title";
    binder.update([target, target]);
    assert.equal(content.querySelector("button"), null);
    content.innerHTML = "<div class='markdown-embed'><div class='callout' data-callout='ai'><div class='callout-title'><div class='callout-title-inner'>Actual title</div></div></div></div>";
    binder.update([target]);
    assert.equal(content.querySelector("button"), null);
  } finally { binder.destroy(); dom.window.close(); }
});
