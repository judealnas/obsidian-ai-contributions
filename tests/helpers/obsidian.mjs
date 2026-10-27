import { StateField } from "@codemirror/state";

export const editorInfoField = StateField.define({ create: () => ({}), update: (value) => value });

export class Plugin {
  constructor(app) { this.app = app; this.commands = []; this.settingTabs = []; }
  registerEditorExtension(extension) { this.extension = extension; }
  registerMarkdownPostProcessor(processor) { this.processor = processor; }
  addCommand(command) { this.commands.push(command); }
  addSettingTab(tab) { this.settingTabs.push(tab); }
  async loadData() { return this.app._savedData ?? null; }
  async saveData(data) {
    if (this.app._failSave) throw new Error("Settings write failed");
    this.app._savedData = structuredClone(data);
  }
}

export class PluginSettingTab {
  constructor(app) { this.containerEl = app._document.createElement("div"); }
}

export class Setting {
  constructor(container) {
    this.row = container.ownerDocument.createElement("div");
    container.append(this.row);
  }
  setName(name) { this.row.setAttribute("aria-label", name); return this; }
  setDesc(desc) { this.row.title = desc; return this; }
  addText(callback) {
    const input = this.row.ownerDocument.createElement("input"); this.row.append(input);
    const text = { inputEl: input,
      setPlaceholder(value) { input.placeholder = value; return this; },
      setValue(value) { input.value = value; return this; } };
    callback(text); return this;
  }
  addButton(callback) {
    const element = this.row.ownerDocument.createElement("button"); this.row.append(element);
    const button = { setButtonText(value) { element.textContent = value; return this; },
      setDisabled(value) { element.disabled = value; return this; },
      onClick(handler) { element.addEventListener("click", handler); return this; } };
    callback(button); return this;
  }
}

export class TFile {
  constructor(path) { this.path = path; this.extension = path.split(".").pop(); }
}

export class MarkdownView {
  constructor(file, editor, mode = "source") {
    this.file = file; this.editor = editor; this.mode = mode;
    this.rerenders = 0;
    this.previewMode = { rerender: () => this.rerenders++ };
  }
  getMode() { return this.mode; }
}

export class MarkdownRenderChild {
  constructor(container) { this.containerEl = container; }
}

export class Notice {
  static messages = [];
  constructor(message) { Notice.messages.push(message); }
}
