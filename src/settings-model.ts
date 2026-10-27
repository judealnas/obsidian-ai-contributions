export const DEFAULT_CALLOUT_TAG = "ai";

export interface AiContributionsSettings {
  calloutTag: string;
}

export function normalizeCalloutTag(value: string): string {
  const tag = value.trim().toLowerCase() || DEFAULT_CALLOUT_TAG;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
    throw new Error("Use only letters, numbers, hyphens, or underscores, without [!…] or spaces.");
  }
  return tag;
}

export function readSettings(data: unknown): AiContributionsSettings {
  if (data && typeof data === "object" && "calloutTag" in data && typeof data.calloutTag === "string") {
    try { return { calloutTag: normalizeCalloutTag(data.calloutTag) }; }
    catch { /* Invalid saved settings fall back to the existing callout format. */ }
  }
  return { calloutTag: DEFAULT_CALLOUT_TAG };
}
