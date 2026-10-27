import type { ReviewAction } from "./callouts";

export interface ControlsOptions {
  document: Document;
  onAction: (action: ReviewAction) => Promise<void> | void;
  onError: (error: unknown) => void;
  unavailable?: string;
}

/** Shared UI for rendered callouts and CodeMirror widgets, including popouts. */
export function createReviewControls(options: ControlsOptions): HTMLSpanElement {
  const root = options.document.createElement("span");
  root.className = "ai-contributions-actions";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Review AI contribution");
  root.setAttribute("contenteditable", "false");
  const buttons: HTMLButtonElement[] = [];
  let busy = false;

  // Neither reviewing nor tabbing through buttons should fold the callout.
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("mousedown", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
  root.addEventListener("keydown", (event) => event.stopPropagation());
  root.addEventListener("click", (event) => event.stopPropagation());

  for (const action of ["accept", "reject"] as const) {
    const button = options.document.createElement("button");
    button.type = "button";
    button.className = `ai-contributions-button ai-contributions-${action}`;
    button.textContent = action === "accept" ? "Accept" : "Reject";
    button.setAttribute("aria-label", `${action === "accept" ? "Accept" : "Reject"} AI contribution`);
    button.title = options.unavailable ?? (action === "accept"
      ? "Keep the content and remove the AI callout wrapper"
      : "Remove this AI callout and its content");
    button.disabled = Boolean(options.unavailable);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy || options.unavailable) return;
      busy = true;
      root.setAttribute("aria-busy", "true");
      buttons.forEach((item) => { item.disabled = true; });
      try {
        await options.onAction(action);
        // Successful changes remove/re-render this callout. Keep this particular
        // snapshot disabled while Obsidian finishes that render.
      } catch (error) {
        busy = false;
        root.removeAttribute("aria-busy");
        buttons.forEach((item) => { item.disabled = false; });
        options.onError(error);
      }
    });
    buttons.push(button);
    root.append(button);
  }
  return root;
}
