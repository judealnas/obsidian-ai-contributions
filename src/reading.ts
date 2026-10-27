import { findAiCallouts, type ReviewTarget } from "./callouts";

export interface SectionInfo {
  text: string;
  lineStart: number;
  lineEnd: number;
}

/**
 * Bind rendered controls only when Obsidian's source range unambiguously maps
 * the rendered group to actual callouts. Never choose a match by body text.
 */
export function resolveReadingTargets(
  source: string, section: SectionInfo | null, renderedCount: number
): ReviewTarget[] | null {
  if (!section || renderedCount < 1 || section.lineStart < 0 || section.lineEnd < section.lineStart) return null;
  const normalize = (text: string): string => text.replace(/\r\n?/g, "\n").trim();
  const sectionSource = source.split(/\r\n|\n|\r/).slice(section.lineStart, section.lineEnd + 1).join("\n");
  // Obsidian renderers may supply the section text or the complete document.
  // Line positions alone are insufficient for stale or synthetic renderers.
  if (normalize(section.text) !== normalize(source) && normalize(section.text) !== normalize(sectionSource)) return null;
  const candidates = findAiCallouts(source).filter((callout) =>
    callout.startLine >= section.lineStart && callout.endLine <= section.lineEnd);
  if (candidates.length !== renderedCount) return null;
  return candidates.map((callout) => ({ source, callout }));
}
