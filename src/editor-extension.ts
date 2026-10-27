import type { Extension } from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate
} from "@codemirror/view";
import { findAiCallouts, type ReviewAction, type ReviewTarget } from "./callouts";
import { createReviewControls } from "./controls";
import { RenderedEditorControls } from "./rendered-editor";

export interface EditorReviewOptions {
  onReview: (view: EditorView, target: ReviewTarget, action: ReviewAction) => Promise<void>;
  onError: (error: unknown) => void;
}

class ReviewWidget extends WidgetType {
  private target: ReviewTarget;
  private options: EditorReviewOptions;

  constructor(target: ReviewTarget, options: EditorReviewOptions) {
    super();
    this.target = target;
    this.options = options;
  }

  eq(other: ReviewWidget): boolean {
    return other.target.source === this.target.source
      && other.target.callout.from === this.target.callout.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = createReviewControls({
      document: view.dom.ownerDocument,
      onAction: (action) => this.options.onReview(view, this.target, action),
      onError: this.options.onError
    });
    root.classList.add("ai-contributions-editor-actions");
    return root;
  }

  ignoreEvent(): boolean { return true; }
}

export function createReviewExtension(options: EditorReviewOptions): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private targets: ReviewTarget[];
    private rendered: RenderedEditorControls;

    constructor(view: EditorView) {
      this.targets = this.parse(view);
      this.decorations = this.decorate(view);
      this.rendered = new RenderedEditorControls(view, options);
      this.rendered.update(this.targets);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.targets = this.parse(update.view);
      if (update.docChanged || update.viewportChanged) this.decorations = this.decorate(update.view);
      if (update.docChanged || update.viewportChanged || update.selectionSet) this.rendered.update(this.targets);
    }

    destroy(): void { this.rendered.destroy(); }

    private parse(view: EditorView): ReviewTarget[] {
      const source = view.state.doc.toString();
      return findAiCallouts(source).map((callout) => ({ source, callout }));
    }

    private decorate(view: EditorView): DecorationSet {
      return Decoration.set(this.targets
        .filter(({ callout }) => view.visibleRanges.some(({ from, to }) => callout.headerEnd >= from && callout.headerEnd <= to))
        .map((target) => Decoration.widget({
          widget: new ReviewWidget(target, options), side: 1
        }).range(target.callout.headerEnd)));
    }
  }, { decorations: (value) => value.decorations });
}
