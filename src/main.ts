import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorInfoField, MarkdownRenderChild, MarkdownView, Notice, Plugin, TFile,
  type Editor, type MarkdownPostProcessorContext
} from "obsidian";
import {
  applyChange, reviewChange,
  type ReviewAction, type ReviewTarget, type TextChange
} from "./callouts";
import { createReviewControls } from "./controls";
import { createReviewExtension } from "./editor-extension";
import { ReviewHistory, undoChange, type ReviewRecord } from "./history";
import { resolveReadingTargets, type SectionInfo } from "./reading";

class ControlLifetime extends MarkdownRenderChild {
  private dispose: () => void;

  constructor(container: HTMLElement, dispose: () => void) {
    super(container);
    this.dispose = dispose;
  }

  onunload(): void { this.dispose(); }
}

export default class AiContributionsPlugin extends Plugin {
  private history = new ReviewHistory();
  private controls = new Set<HTMLElement>();
  private pending: Promise<unknown> = Promise.resolve();
  private active = false;

  onload(): void {
    this.active = true;
    this.registerEditorExtension(createReviewExtension({
      onReview: (view, target, action) => {
        const path = view.state.field(editorInfoField, false)?.file?.path;
        if (!path) return Promise.reject(new Error("Open this contribution in its source note to review it."));
        return this.review(path, target, action, view);
      },
      onError: (error) => this.reportError(error)
    }));
    this.registerMarkdownPostProcessor((element, context) => this.renderControls(element, context));
    this.addCommand({
      id: "undo-last-review",
      name: "Undo last review",
      checkCallback: (checking) => {
        if (!this.history.peek()) return false;
        if (!checking) void this.enqueue(() => this.undo()).catch((error) => this.reportError(error));
        return true;
      }
    });
  }

  onunload(): void {
    this.active = false;
    this.controls.forEach((control) => control.remove());
    this.controls.clear();
    this.history.clear();
  }

  private reportError(error: unknown): void {
    new Notice(error instanceof Error ? error.message : "The AI contribution could not be reviewed.", 8000);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(() => {
      if (!this.active) throw new Error("AI Contributions was disabled. Enable it to review callouts.");
      return work();
    });
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async review(path: string, target: ReviewTarget, action: ReviewAction, cm?: EditorView): Promise<void> {
    return this.enqueue(async () => {
      const record = await this.editNote(path, (source) => reviewChange(source, target, action), cm);
      this.history.push(record);
      new Notice(`AI contribution ${action === "accept" ? "accepted" : "rejected"}. Undo with “AI Contributions: Undo last review”.`, 6000);
    });
  }

  private async undo(): Promise<void> {
    const record = this.history.peek();
    if (!record) return;
    await this.editNote(record.path, (source) => undoChange(source, record));
    this.history.pop();
    new Notice("AI contribution review undone.");
  }

  private sourceEditor(path: string): Editor | undefined {
    const editors = this.app.workspace.getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source")
      .map((view) => view.editor);
    const first = editors[0];
    if (first && editors.some((editor) => editor.getValue() !== first.getValue())) {
      throw new Error("This note has different edits in multiple panes. Save or close those panes before reviewing.");
    }
    return first;
  }

  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") throw new Error("The source Markdown note is no longer available.");
    return file;
  }

  private async currentSource(path: string): Promise<string> {
    return this.sourceEditor(path)?.getValue() ?? this.app.vault.cachedRead(this.file(path));
  }

  private async editNote(path: string, transform: (source: string) => TextChange, cm?: EditorView): Promise<ReviewRecord> {
    this.file(path);
    if (cm) {
      if (cm.state.field(editorInfoField, false)?.file?.path !== path) throw new Error("The editor changed notes. Review this callout again.");
      if (cm.state.facet(EditorState.readOnly) || !cm.state.facet(EditorView.editable)) throw new Error("This editor is read-only.");
      const before = cm.state.doc.toString();
      const change = transform(before);
      cm.dispatch({ changes: change, annotations: Transaction.userEvent.of("input.ai-contributions") });
      return { path, before, after: applyChange(before, change), change };
    }
    const editor = this.sourceEditor(path);
    if (editor) {
      const before = editor.getValue();
      const change = transform(before);
      editor.replaceRange(change.insert, editor.offsetToPos(change.from), editor.offsetToPos(change.to), "ai-contributions");
      return { path, before, after: applyChange(before, change), change };
    }
    let record: ReviewRecord | undefined;
    await this.app.vault.process(this.file(path), (before) => {
      if (!this.active) throw new Error("AI Contributions was disabled before the review completed.");
      if (this.sourceEditor(path)) throw new Error("This note was opened for editing. Use its current callout controls to review it.");
      const change = transform(before);
      const after = applyChange(before, change);
      record = { path, before, after, change };
      return after;
    });
    if (!record) throw new Error("The note could not be updated.");
    return record;
  }

  private async renderControls(element: HTMLElement, context: MarkdownPostProcessorContext): Promise<void> {
    const callouts = [
      ...(element.matches('.callout[data-callout="ai" i]') ? [element] : []),
      ...element.querySelectorAll<HTMLElement>('.callout[data-callout="ai" i]')
    ].filter((callout) =>
      callout.closest(".markdown-embed") === element.closest(".markdown-embed")
      && !callout.parentElement?.closest(".callout")
      && !callout.querySelector(":scope > .callout-title > .ai-contributions-actions"));
    if (!callouts.length) return;
    let source: string;
    try { source = await this.currentSource(context.sourcePath); }
    catch { return; } // Synthetic renders without a source file are display only.
    if (!this.active) return;

    const groups = new Map<string, { section: SectionInfo | null; callouts: HTMLElement[] }>();
    for (const callout of callouts) {
      const section = context.getSectionInfo(callout);
      const key = section ? `${section.lineStart}:${section.lineEnd}` : "unavailable";
      const group = groups.get(key) ?? { section, callouts: [] };
      group.callouts.push(callout);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const targets = resolveReadingTargets(source, group.section, group.callouts.length);
      group.callouts.forEach((callout, index) => {
        const title = callout.querySelector<HTMLElement>(":scope > .callout-title");
        if (!title || title.querySelector(".ai-contributions-actions")) return;
        const target = targets?.[index];
        const controls = createReviewControls({
          document: title.ownerDocument,
          unavailable: target ? undefined : "Source position unavailable. Open the original note in the editor to review this callout.",
          onAction: (action) => target ? this.review(context.sourcePath, target, action) : undefined,
          onError: (error) => this.reportError(error)
        });
        title.append(controls);
        this.controls.add(controls);
        context.addChild(new ControlLifetime(controls, () => {
          controls.remove();
          this.controls.delete(controls);
        }));
      });
    }
  }
}
