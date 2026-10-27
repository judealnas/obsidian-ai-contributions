import type { TextChange } from "./callouts";

export interface ReviewRecord {
  path: string;
  before: string;
  after: string;
  change: TextChange;
}

/** Session-only history. Exact snapshots prevent undo from overwriting edits. */
export class ReviewHistory {
  private entries: ReviewRecord[] = [];
  private readonly limit: number;

  constructor(limit = 20) { this.limit = limit; }

  push(record: ReviewRecord): void {
    this.entries.push(record);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  peek(): ReviewRecord | undefined { return this.entries[this.entries.length - 1]; }

  pop(): void { this.entries.pop(); }

  clear(): void { this.entries = []; }
}

export function undoChange(source: string, record: ReviewRecord): TextChange {
  if (source !== record.after) {
    throw new Error("The note changed after this review. Undo was stopped to preserve those edits. Use the editor's undo or File recovery instead.");
  }
  return {
    from: record.change.from,
    to: record.change.from + record.change.insert.length,
    insert: record.before.slice(record.change.from, record.change.to)
  };
}
