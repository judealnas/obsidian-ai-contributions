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

async function harness(text = source, savedData = null) {
  const dom = new JSDOM("<div id='root'></div>");
  const file = new TFile("Example.md");
  const files = new Map([[file.path, { file, text }]]);
  const leaves = [];
  let writes = 0;
  let failWrite = false;
  const app = {
    _document: dom.window.document,
    _savedData: savedData,
    optionsUpdated: 0,
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
    workspace: { getLeavesOfType: () => leaves, updateOptions: () => { app.optionsUpdated++; } }
  };
  const plugin = new AiContributionsPlugin(app);
  await plugin.onload();
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
  return { app, dom, plugin, root, callout, context, files, file, leaves, editor, children, settle, close,
    get writes() { return writes; }, set failWrite(value) { failWrite = value; } };
}

test("Reading view accepts one callout and command undo restores the note", async () => {
  const h = await harness();
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
  const h = await harness();
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
  const h = await harness();
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
  const h = await harness();
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
  const h = await harness();
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
  const h = await harness();
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
  const h = await harness(text);
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
  const h = await harness();
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
  const h = await harness();
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

test("custom saved tags work in Reading view and leave default AI callouts alone", async () => {
  const customSource = source + "\n> [!assistant]+ Contribution\n> Custom body.\n";
  const h = await harness(customSource, { calloutTag: "ASSISTANT" });
  try {
    const old = h.callout();
    const custom = h.callout(); custom.setAttribute("data-callout", "assistant");
    const callout = findAiCallouts(customSource, "assistant")[0];
    await h.plugin.processor(h.root, h.context(h.file.path, customSource, callout.startLine, callout.endLine));
    assert.equal(old.querySelector("button"), null);
    custom.querySelector(".ai-contributions-accept").click(); await h.settle();
    assert.equal(h.files.get(h.file.path).text, source + "\nCustom body.\n");
  } finally { h.close(); }
});

test("applying a tag persists it, refreshes controls, and invalidates old buttons", async () => {
  const h = await harness();
  try {
    const preview = new MarkdownView(h.file, h.editor(source), "preview"); h.leaves.push({ view: preview });
    h.callout(); await h.plugin.processor(h.root, h.context());
    const oldButton = h.root.querySelector(".ai-contributions-reject");
    const extensions = h.plugin.extension;
    const oldExtension = extensions[0];
    await h.plugin.setCalloutTag(" Assistant ");
    assert.deepEqual(h.app._savedData, { calloutTag: "assistant" });
    assert.equal(h.plugin.extension, extensions);
    assert.notEqual(extensions[0], oldExtension);
    assert.equal(h.app.optionsUpdated, 1);
    assert.equal(preview.rerenders, 1);
    assert.equal(h.root.querySelector("button"), null);
    assert.equal(h.files.get(h.file.path).text, source);
    oldButton.click(); await h.settle();
    assert.equal(h.writes, 0);
    assert.match(Notice.messages.at(-1), /original position/);

    const reloaded = await harness(source, JSON.parse(JSON.stringify(h.app._savedData)));
    try { assert.equal(reloaded.plugin.settings.calloutTag, "assistant"); }
    finally { reloaded.close(); }
    await h.plugin.setCalloutTag("");
    assert.deepEqual(h.app._savedData, { calloutTag: "ai" });
  } finally { h.close(); }
});

test("settings UI reports invalid input and failed saves, then allows a retry", async () => {
  const h = await harness();
  try {
    const tab = h.plugin.settingTabs[0]; tab.display();
    const input = tab.containerEl.querySelector("input");
    const button = tab.containerEl.querySelector("button");
    const error = tab.containerEl.querySelector('[role="alert"]');
    assert.equal(input.value, "ai");
    input.value = "[!assistant]"; button.click(); await h.settle();
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /Use only/);
    assert.equal(h.plugin.settings.calloutTag, "ai");
    assert.equal(h.app.optionsUpdated, 0);

    h.app._failSave = true; input.value = "assistant"; button.click(); await h.settle();
    assert.match(error.textContent, /Settings write failed/);
    assert.equal(h.plugin.settings.calloutTag, "ai");
    assert.equal(h.app._savedData, null);
    assert.equal(button.disabled, false);

    h.app._failSave = false; button.click(); await h.settle();
    assert.equal(error.hidden, true);
    assert.equal(input.getAttribute("aria-invalid"), null);
    assert.equal(h.plugin.settings.calloutTag, "assistant");
    assert.deepEqual(h.app._savedData, { calloutTag: "assistant" });
  } finally { h.close(); }
});

test("undo history remains usable after changing the tag", async () => {
  const h = await harness();
  try {
    h.callout(); await h.plugin.processor(h.root, h.context());
    h.root.querySelector(".ai-contributions-accept").click(); await h.settle();
    await h.plugin.setCalloutTag("assistant");
    h.plugin.commands[0].checkCallback(false); await h.settle();
    assert.equal(h.files.get(h.file.path).text, source);
  } finally { h.close(); }
});
