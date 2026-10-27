import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createReviewExtension } from "../src/editor-extension.ts";
import { applyChange, reviewChange } from "../src/callouts.ts";

test("CodeMirror widgets review the document and refresh after edits", async () => {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ["window", "document", "MutationObserver", "HTMLElement", "Node", "Text", "Window"]) {
    globalThis[key] = key === "window" ? window : window[key];
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  let error;
  const source = "Human.\n\n> [!ai]+ Contribution\n> Keep me.\n\nAfter.\n";
  let userEvent;
  const extension = createReviewExtension({
    onReview: async (view, target, action) => {
      const change = reviewChange(view.state.doc.toString(), target, action);
      view.dispatch({ changes: change, annotations: Transaction.userEvent.of("input.ai-contributions") });
    },
    onError: (value) => { error = value; }
  });
  const view = new EditorView({
    state: EditorState.create({ doc: source, extensions: [extension, EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions) userEvent = transaction.annotation(Transaction.userEvent);
    })] }),
    parent: window.document.body
  });
  try {
    assert.equal(view.dom.querySelectorAll(".ai-contributions-actions").length, 1);
    view.dom.querySelector(".ai-contributions-accept").click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(view.state.doc.toString(), "Human.\n\nKeep me.\n\nAfter.\n");
    assert.equal(userEvent, "input.ai-contributions");
    assert.equal(view.dom.querySelectorAll(".ai-contributions-actions").length, 0);

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    const stale = view.dom.querySelector(".ai-contributions-reject");
    view.dispatch({ changes: { from: 0, insert: "New edit.\n\n" } });
    stale.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(error.message, /note changed/);
    assert.equal(view.state.doc.toString(), "New edit.\n\n" + source);
    view.dom.querySelector(".ai-contributions-reject").click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(view.state.doc.toString(), "New edit.\n\nHuman.\n\n\nAfter.\n");

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "```md\n> [!ai]\n> Example\n```\n" } });
    assert.equal(view.dom.querySelectorAll(".ai-contributions-actions").length, 0);
    assert.equal(applyChange("abc", { from: 1, to: 2, insert: "!" }), "a!c");
  } finally {
    view.destroy();
    dom.window.close();
  }
});
