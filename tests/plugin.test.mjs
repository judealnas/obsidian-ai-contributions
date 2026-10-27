import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView, Notice, TFile, editorInfoField } from "obsidian";
import AiContributionsPlugin from "../src/main.ts";
import { findAiCallouts } from "../src/callouts.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const source = "Human.\n\n> [!ai]+ Contribution\n> Proposed text.\n\nAfter.\n";

function harness(text = source) {
  const dom = new JSDOM("<div id='root'></div>");
  const file = new TFile("Example.md");
  const files = new Map([[file.path, { file, text }]]);
  const leaves = [];
  let writes = 0;
  let failWrite = false;
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path)?.file,
      cachedRead: async (file) => files.get(file.path).text,
      process: async (file, transform) => {
        if (failWrite) throw new Error("Disk write failed");
        const next = transform(files.get(file.path).text);
        files.get(file.path).text = next;
        writes++;
        return next;
      }
    },
    workspace: { getLeavesOfType: () => leaves }
  };
  const plugin = new AiContributionsPlugin(app);
  plugin.onload();
  const root = dom.window.document.getElementById("root");
  const children = [];
  function callout(parent = root) {
    const el = dom.window.document.createElement("div");
    el.className = "callout";
    el.setAttribute("data-callout", "ai");
    el.innerHTML = "<div class='callout-title'><div class='callout-title-inner'>Contribution</div></div><div class='callout-content'><p>Proposed text.</p></div>";
    parent.append(el);
    return el;
  }
  function context(path = file.path, text = files.get(path).text, lineStart = 2, lineEnd = 3) {
    return { sourcePath: path, getSectionInfo: () => ({ text, lineStart, lineEnd }), addChild: (child) => children.push(child) };
  }
  function editor(initial) {
    return {
      text: initial,
      getValue() { return this.text; },
      offsetToPos(offset) { return offset; },
      replaceRange(insert, from, to) { this.text = this.text.slice(0, from) + insert + this.text.slice(to); }
    };
  }
  async function settle() { await tick(); await plugin.pending; await tick(); }
  function close() { plugin.onunload(); dom.window.close(); }
  Notice.messages = [];
  return { dom, plugin, root, callout, context, files, file, leaves, editor, children, settle, close,
    get writes() { return writes; }, set failWrite(value) { failWrite = value; } };
}

test("Reading view accepts one callout and command undo restores the note", async () => {
  const h = harness();
  try {
    const el = h.callout();
    await h.plugin.processor(h.root, h.context());
    el.querySelector(".ai-contributions-accept").click(); await h.settle();
    assert.equal(h.files.get(h.file.path).text, "Human.\n\nProposed text.\n\nAfter.\n");
    assert.equal(h.writes, 1);
    const undo = h.plugin.commands[0];
    assert.equal(undo.checkCallback(true), true);
    undo.checkCallback(false); await h.settle();
    assert.equal(h.files.get(h.file.path).text, source);
    assert.equal(undo.checkCallback(true), false);
  } finally { h.close(); }
});

test("reviews use unsaved editor contents instead of overwriting from disk", async () => {
  const h = harness();
  try {
    const dirty = source + "Unsaved change.\n";
    const editor = h.editor(dirty);
    h.leaves.push({ view: new MarkdownView(h.file, editor) });
    const el = h.callout();
    await h.plugin.processor(h.root, h.context(h.file.path, dirty));
    el.querySelector(".ai-contributions-reject").click(); await h.settle();
    assert.equal(editor.text, "Human.\n\n\nAfter.\nUnsaved change.\n");
    assert.equal(h.files.get(h.file.path).text, source);
    assert.equal(h.writes, 0);
    h.plugin.commands[0].checkCallback(false); await h.settle();
    assert.equal(editor.text, dirty);
  } finally { h.close(); }
});

test("Reading view stale controls fail and can be retried after a fresh render", async () => {
  const h = harness();
  try {
    const el = h.callout();
    await h.plugin.processor(h.root, h.context());
    h.files.get(h.file.path).text = source + "New change.\n";
    const reject = el.querySelector(".ai-contributions-reject");
    reject.click(); await h.settle();
    assert.equal(h.writes, 0);
    assert.match(Notice.messages.at(-1), /note changed/);
    assert.equal(reject.disabled, false);
    assert.equal(h.plugin.commands[0].checkCallback(true), false);
  } finally { h.close(); }
});

test("write failure leaves source and undo history unchanged", async () => {
  const h = harness();
  try {
    const el = h.callout();
    await h.plugin.processor(h.root, h.context());
    h.failWrite = true;
    el.querySelector(".ai-contributions-reject").click(); await h.settle();
    assert.equal(h.files.get(h.file.path).text, source);
    assert.equal(h.plugin.commands[0].checkCallback(true), false);
    assert.match(Notice.messages.at(-1), /Disk write failed/);
    assert.equal(el.querySelector("button").disabled, false);
  } finally { h.close(); }
});

test("embedded callouts use their own context's source file", async () => {
  const h = harness();
  try {
    const other = new TFile("Embedded.md");
    h.files.set(other.path, { file: other, text: "> [!ai]+ Contribution\n> Embedded body\n" });
    const embed = h.dom.window.document.createElement("div"); embed.className = "markdown-embed"; h.root.append(embed);
    const el = h.callout(embed);
    await h.plugin.processor(h.root, h.context());
    assert.equal(el.querySelector("button"), null);
    await h.plugin.processor(embed, h.context(other.path, h.files.get(other.path).text, 0, 1));
    el.querySelector(".ai-contributions-accept").click(); await h.settle();
    assert.equal(h.files.get(other.path).text, "Embedded body\n");
    assert.equal(h.files.get(h.file.path).text, source);
  } finally { h.close(); }
});

test("render lifetime and plugin unload remove controls", async () => {
  const h = harness();
  try {
    h.callout(); await h.plugin.processor(h.root, h.context());
    assert.equal(h.root.querySelectorAll(".ai-contributions-actions").length, 1);
    await h.plugin.processor(h.root, h.context());
    assert.equal(h.root.querySelectorAll(".ai-contributions-actions").length, 1);
    h.children[0].onunload();
    assert.equal(h.root.querySelectorAll(".ai-contributions-actions").length, 0);
    await h.plugin.processor(h.root, h.context());
    h.plugin.onunload();
    assert.equal(h.root.querySelectorAll(".ai-contributions-actions").length, 0);
  } finally { h.close(); }
});

test("simultaneous reviews cannot apply the same source snapshot twice", async () => {
  const text = "> [!ai]+ A\n> A\n\n> [!ai]+ B\n> B\n";
  const h = harness(text);
  try {
    h.callout(); h.callout();
    await h.plugin.processor(h.root, h.context(h.file.path, text, 0, 5));
    const buttons = h.root.querySelectorAll(".ai-contributions-accept");
    buttons[0].click(); buttons[1].click(); await h.settle();
    assert.equal(h.writes, 1);
    assert.equal(h.files.get(h.file.path).text, "A\n\n> [!ai]+ B\n> B\n");
    assert.match(Notice.messages.at(-1), /note changed/);
  } finally { h.close(); }
});

test("undo refuses to overwrite edits made after a review", async () => {
  const h = harness();
  try {
    h.callout(); await h.plugin.processor(h.root, h.context());
    h.root.querySelector(".ai-contributions-accept").click(); await h.settle();
    h.files.get(h.file.path).text += "New human text\n";
    const after = h.files.get(h.file.path).text;
    h.plugin.commands[0].checkCallback(false); await h.settle();
    assert.equal(h.files.get(h.file.path).text, after);
    assert.match(Notice.messages.at(-1), /note changed after this review/);
    assert.equal(h.plugin.commands[0].checkCallback(true), true);
  } finally { h.close(); }
});

test("CodeMirror reviews resolve the file from the clicked editor, with read-only protection", async () => {
  const h = harness();
  try {
    const state = EditorState.create({ doc: source, extensions: [editorInfoField.init(() => ({ file: h.file }))] });
    const fakeView = { state, dispatch(transaction) { this.state = this.state.update(transaction).state; } };
    const target = { source, callout: findAiCallouts(source)[0] };
    await h.plugin.review(h.file.path, target, "accept", fakeView);
    assert.equal(fakeView.state.doc.toString(), "Human.\n\nProposed text.\n\nAfter.\n");
    assert.equal(h.writes, 0);
    const locked = { state: EditorState.create({ doc: source, extensions: [editorInfoField.init(() => ({ file: h.file })), EditorState.readOnly.of(true), EditorView.editable.of(false)] }) };
    await assert.rejects(h.plugin.review(h.file.path, target, "reject", locked), /read-only/);
    await assert.rejects(h.plugin.review("Missing.md", target, "reject", fakeView), /no longer available/);
  } finally { h.close(); }
});
