export interface ChangedFile {
  path: string;
  deleted: boolean;
  added: string[];
  removed: number;
  /** Lines removed with no line added in their place, summed over the hunks. */
  netRemoved: number;
  /** The new side of every hunk in order: added lines and unchanged context. */
  after: { added: boolean; text: string }[];
}

/** Counts one hunk's added and removed lines; ending it books the lines removed with no replacement. */
class Hunk {
  private added = 0;
  private removed = 0;

  plus(): void {
    this.added += 1;
  }

  minus(): void {
    this.removed += 1;
  }

  end(file: ChangedFile | undefined): void {
    if (file !== undefined) {
      file.netRemoved += Math.max(0, this.removed - this.added);
    }
    this.added = 0;
    this.removed = 0;
  }
}

/** Splits a unified diff into the files it changes, with added lines and removed-line counts. */
export function parseDiff(text: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  let inHunk = false;
  const hunk = new Hunk();
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header?.[2] !== undefined) {
      hunk.end(current);
      current = {
        path: header[2],
        deleted: false,
        added: [],
        removed: 0,
        netRemoved: 0,
        after: [],
      };
      files.push(current);
      inHunk = false;
    } else if (current === undefined) {
      continue;
    } else if (line.startsWith("@@")) {
      hunk.end(current);
      inHunk = true;
    } else if (!inHunk && line.startsWith("deleted file mode")) {
      current.deleted = true;
    } else if (inHunk && line.startsWith("+")) {
      current.added.push(line.slice(1));
      current.after.push({ added: true, text: line.slice(1) });
      hunk.plus();
    } else if (inHunk && line.startsWith("-")) {
      current.removed += 1;
      hunk.minus();
    } else if (inHunk && line.startsWith(" ")) {
      current.after.push({ added: false, text: line.slice(1) });
    }
  }
  hunk.end(current);
  return files;
}
