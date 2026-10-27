import { PluginSettingTab, Setting, type App } from "obsidian";
import type AiContributionsPlugin from "./main";

export class AiContributionsSettingTab extends PluginSettingTab {
  private owner: AiContributionsPlugin;

  constructor(app: App, plugin: AiContributionsPlugin) {
    super(app, plugin);
    this.owner = plugin;
  }

  display(): void {
    this.containerEl.replaceChildren();
    let input: HTMLInputElement;
    const error = this.containerEl.ownerDocument.createElement("p");
    error.className = "ai-contributions-setting-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    new Setting(this.containerEl)
      .setName("Callout tag")
      .setDesc("Name inside [!…], without the brackets. Default: ai. Use letters, numbers, hyphens, or underscores. Apply to refresh open notes; existing note text is not renamed.")
      .addText((text) => {
        input = text.inputEl;
        text.setPlaceholder("ai").setValue(this.owner.settings.calloutTag);
        text.inputEl.setAttribute("aria-label", "Callout tag");
      })
      .addButton((button) => button.setButtonText("Apply").onClick(async () => {
        button.setDisabled(true);
        error.hidden = true;
        input.removeAttribute("aria-invalid");
        try {
          await this.owner.setCalloutTag(input.value);
          input.value = this.owner.settings.calloutTag;
        } catch (failure) {
          input.setAttribute("aria-invalid", "true");
          error.textContent = failure instanceof Error ? failure.message : "Could not save the callout tag.";
          error.hidden = false;
        } finally { button.setDisabled(false); }
      }));
    this.containerEl.append(error);
  }
}
