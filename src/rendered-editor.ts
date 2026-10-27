import type { EditorView } from "@codemirror/view";
import type { ReviewTarget } from "./callouts";
import { createReviewControls } from "./controls";
import type { EditorReviewOptions } from "./editor-extension";

interface Binding {
  title: HTMLElement;
  target: ReviewTarget;
}

/**
 * Live Preview can render a whole callout as an Obsidian block widget, hiding
 * ordinary inline decorations. Bind its title through CodeMirror's public DOM
 * position mapping instead of depending on Obsidian's private widget classes.
 */
export class RenderedEditorControls {
  private view: EditorView;
  private options: EditorReviewOptions;
  private targets: ReviewTarget[] = [];
  private observer: MutationObserver | undefined;
  private owned = new Map<HTMLElement, { controls: HTMLElement; target: ReviewTarget }>();
  private destroyed = false;

  constructor(view: EditorView, options: EditorReviewOptions) {
    this.view = view;
    this.options = options;
    const Observer = view.dom.ownerDocument.defaultView?.MutationObserver;
    if (Observer) {
      this.observer = new Observer(() => this.schedule());
      this.observer.observe(view.contentDOM, { childList: true, subtree: true });
    }
  }

  update(targets: ReviewTarget[]): void {
    this.targets = targets;
    this.schedule();
  }

  private schedule(): void {
    if (this.destroyed) return;
    this.view.requestMeasure({
      key: this,
      read: () => this.bindings(),
      write: (bindings) => this.render(bindings)
    });
  }

  private bindings(): Binding[] {
    if (this.destroyed) return [];
    const result: Binding[] = [];
    for (const callout of this.view.contentDOM.querySelectorAll<HTMLElement>('.callout[data-callout="ai" i]')) {
      if (callout.closest(".markdown-embed") || callout.parentElement?.closest(".callout")) continue;
      const title = callout.querySelector<HTMLElement>(":scope > .callout-title");
      const inner = title?.querySelector(":scope > .callout-title-inner");
      if (!title || !inner) continue;
      let position: number;
      try { position = this.view.posAtDOM(callout, 0); }
      catch { continue; }
      const candidates = this.targets.filter(({ callout: source }) => position >= source.from && position <= source.to);
      if (candidates.length !== 1) continue;
      const target = candidates[0]!;
      const header = target.source.slice(target.callout.from, target.callout.headerEnd);
      const expectedTitle = header.replace(/^>[ \t]?\[!ai\][+-]?[ \t]*/i, "").trim() || "ai";
      // Plain titles cover the vault's contribution/date format. Formatted titles
      // remain reviewable through the source editor and Reading view.
      if (inner.textContent?.trim().toLowerCase() !== expectedTitle.toLowerCase()) continue;
      result.push({ title, target });
    }
    return result;
  }

  private render(bindings: Binding[]): void {
    if (this.destroyed) return;
    const keep = new Set(bindings.map(({ title }) => title));
    for (const [title, owned] of this.owned) {
      if (!keep.has(title) || !title.contains(owned.controls)) {
        owned.controls.remove();
        this.owned.delete(title);
      }
    }
    for (const { title, target } of bindings) {
      const previous = this.owned.get(title);
      if (previous?.target.source === target.source && previous.target.callout.from === target.callout.from) continue;
      previous?.controls.remove();
      // The Markdown renderer may already have added controls with no reliable
      // source section. The owning editor provides a stronger position mapping.
      title.querySelector(":scope > .ai-contributions-actions")?.remove();
      const controls = createReviewControls({
        document: title.ownerDocument,
        onAction: (action) => this.options.onReview(this.view, target, action),
        onError: this.options.onError
      });
      controls.classList.add("ai-contributions-rendered-editor-actions");
      title.append(controls);
      this.owned.set(title, { controls, target });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.owned.forEach(({ controls }) => controls.remove());
    this.owned.clear();
  }
}
