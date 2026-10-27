import { StateField } from "@codemirror/state";

export const editorInfoField = StateField.define({ create: () => ({}), update: (value) => value });

export class Plugin {
  constructor(app) { this.app = app; this.commands = []; }
  registerEditorExtension(extension) { this.extension = extension; }
  registerMarkdownPostProcessor(processor) { this.processor = processor; }
  addCommand(command) { this.commands.push(command); }
}

export class TFile {
  constructor(path) { this.path = path; this.extension = path.split(".").pop(); }
}

export class MarkdownView {
  constructor(file, editor, mode = "source") { this.file = file; this.editor = editor; this.mode = mode; }
  getMode() { return this.mode; }
}

export class MarkdownRenderChild {
  constructor(container) { this.containerEl = container; }
}

export class Notice {
  static messages = [];
  constructor(message) { Notice.messages.push(message); }
}
