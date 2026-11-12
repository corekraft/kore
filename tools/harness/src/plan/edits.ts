// Line-range edits to a Markdown file, and trimming them to the lines that differ.

export interface Edit {
  /** Zero-based index of the first line replaced. */
  start: number;
  /** Zero-based index one past the last line replaced. */
  end: number;
  lines: string[];
}

export function trimCommon(edit: Edit, lines: string[]): Edit | null {
  const before = lines.slice(edit.start, edit.end);
  let head = 0;
  while (
    head < before.length &&
    head < edit.lines.length &&
    before[head] === edit.lines[head]
  ) {
    head++;
  }
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < edit.lines.length - head &&
    before[before.length - 1 - tail] ===
      edit.lines[edit.lines.length - 1 - tail]
  ) {
    tail++;
  }
  const kept = { start: edit.start + head, end: edit.end - tail };
  const after = edit.lines.slice(head, edit.lines.length - tail);
  return kept.start === kept.end && after.length === 0
    ? null
    : { ...kept, lines: after };
}
