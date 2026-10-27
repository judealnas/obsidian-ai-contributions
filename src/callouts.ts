export type ReviewAction = "accept" | "reject";

export interface AiCallout {
  from: number;
  to: number;
  headerEnd: number;
  startLine: number;
  endLine: number;
  raw: string;
  body: string;
}

export interface ReviewTarget {
  source: string;
  callout: AiCallout;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

interface Line {
  text: string;
  eol: string;
  from: number;
  to: number;
}

function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[0].length === 0) break;
    lines.push({
      text: match[1]!, eol: match[2]!,
      from: match.index, to: match.index + match[0].length
    });
  }
  return lines;
}

const aiHeader = /^>\s?\[!ai\](?:[+-])?(?:[ \t]+.*)?$/i;
const anotherHeader = /^>[ \t]?\[![^\]]+\]/;
const paragraphBoundary = /^(?: {0,3}(?:#{1,6}(?:[ \t]|$)|(?:[-+*]|\d+[.)])[ \t]|(?:`{3,}|~{3,})|(?:[-*_][ \t]*){3,}$)|\s*<|\s*%%)/;

/**
 * Recognize the vault's explicit, top-level callouts. Each body line must carry
 * its own `>` marker. Ambiguous lazy continuations are deliberately not editable.
 * Offsets include the last line ending, so no neighbouring text is re-formatted.
 */
export function findAiCallouts(source: string): AiCallout[] {
  const lines = linesOf(source);
  const callouts: AiCallout[] = [];
  let fence: { marker: string; length: number } | undefined;
  let comment: "obsidian" | "html" | undefined;
  let htmlEnd: RegExp | undefined;
  let htmlBlock = false;
  let frontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text;
    if (i === 0 && /^\uFEFF?---[ \t]*$/.test(text)) {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) frontmatter = false;
      continue;
    }
    if (fence) {
      const close = text.match(/^\s*(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1]![0] === fence.marker && close[1]!.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (htmlEnd) {
      if (htmlEnd.test(text)) htmlEnd = undefined;
      continue;
    }
    if (htmlBlock) {
      if (!text.trim()) htmlBlock = false;
      continue;
    }

    // Strip inline code before looking for comment delimiters. This prevents
    // literal `%%` or `<!--` in an explanation from hiding later real callouts.
    const prose = text.replace(/(`+)[\s\S]*?\1(?!`)/g, "");
    let at = 0;
    let commented = comment !== undefined;
    while (at < prose.length) {
      if (comment) {
        const end = prose.indexOf(comment === "html" ? "-->" : "%%", at);
        if (end < 0) break;
        at = end + (comment === "html" ? 3 : 2);
        comment = undefined;
      } else {
        const html = prose.indexOf("<!--", at);
        const obsidian = prose.indexOf("%%", at);
        if (html < 0 && obsidian < 0) break;
        const isHtml = html >= 0 && (obsidian < 0 || html < obsidian);
        comment = isHtml ? "html" : "obsidian";
        at = (isHtml ? html : obsidian) + (isHtml ? 4 : 2);
        commented = true;
      }
    }
    if (commented) continue;

    const htmlLiteral = text.match(/^ {0,3}(?:<\?|(<!\[CDATA\[)|<![A-Z])/);
    if (htmlLiteral) {
      const end = text.trimStart().startsWith("<?") ? /\?>/ : htmlLiteral[1] ? /\]\]>/ : />/;
      if (!end.test(text)) htmlEnd = end;
      continue;
    }

    // A fence can start inside a list item; its contents are examples too.
    const open = text.match(/^\s*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { marker: open[1]![0]!, length: open[1]!.length };
      continue;
    }
    const rawHtml = text.match(/^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i);
    if (rawHtml) {
      const end = new RegExp(`</${rawHtml[1]}>`, "i");
      if (!end.test(text)) htmlEnd = end;
      continue;
    }
    if (/^ {0,3}<(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i.test(text)) {
      htmlBlock = true;
      continue;
    }
    if (/^ {0,3}<\/?[A-Za-z][A-Za-z\d-]*(?:[ \t]+[^<>]*)?\/?>[ \t]*$/.test(text)) {
      htmlBlock = true;
      continue;
    }

    if (!text.startsWith(">")) continue;
    let end = i + 1;
    while (end < lines.length && lines[end]!.text.startsWith(">")) end++;
    const bodyLines = lines.slice(i + 1, end);
    const next = lines[end]?.text;
    const ambiguous = next !== undefined && next.trim() !== "" && !paragraphBoundary.test(next);
    if (aiHeader.test(text) && !ambiguous && !bodyLines.some((body) => anotherHeader.test(body.text))) {
      const last = lines[end - 1]!;
      callouts.push({
        from: line.from, to: last.to,
        headerEnd: line.from + text.length,
        startLine: i, endLine: end - 1,
        raw: source.slice(line.from, last.to),
        body: bodyLines.map((body) => body.text.replace(/^>[ \t]?/, "") + body.eol).join("")
      });
    }
    i = end - 1;
  }
  return callouts;
}

export function reviewChange(source: string, target: ReviewTarget, action: ReviewAction): TextChange {
  if (source !== target.source) {
    throw new Error("This note changed. Refresh the callout or reopen the note, then try again.");
  }
  const current = findAiCallouts(source).find((item) => item.from === target.callout.from);
  if (!current || current.raw !== target.callout.raw || current.to !== target.callout.to) {
    throw new Error("This AI callout is no longer at its original position. Reopen the note to review it.");
  }
  return { from: current.from, to: current.to, insert: action === "accept" ? current.body : "" };
}

export function applyChange(source: string, change: TextChange): string {
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}
