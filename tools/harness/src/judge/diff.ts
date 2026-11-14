/** One changed or context line of a hunk; `start` marks the first line of its hunk. */
export interface TrailLine {
  kind: "added" | "removed" | "context";
  text: string;
  start: boolean;
}

export interface ChangedFile {
  path: string;
  /** The path before a rename; the same as `path` for a file that kept its name. */
  previousPath: string;
  deleted: boolean;
  added: string[];
  removed: number;
  /** Lines removed with no line added in their place, summed over the hunks. */
  netRemoved: number;
  /** The new side of every hunk in order: added lines and unchanged context. */
  after: { added: boolean; text: string }[];
  /** Every added, removed and context line in diff order, so a change can be placed by what surrounds it. */
  trail: TrailLine[];
  /**
   * The file's full text at the merge base and at the head, when the precheck fetched it. A hunk shows
   * three lines of context, so a section header can be out of view; the whole file is what places a change.
   */
  sides?: { before: string | undefined; after: string | undefined };
}

/** Counts one hunk's added and removed lines and records each in the file's trail; ending it books the lines removed with no replacement. */
class Hunk {
  private added = 0;
  private removed = 0;
  private starting = false;

  begin(): void {
    this.starting = true;
  }

  plus(file: ChangedFile, text: string): void {
    this.added += 1;
    file.added.push(text);
    file.after.push({ added: true, text });
    this.record(file, "added", text);
  }

  minus(file: ChangedFile, text: string): void {
    this.removed += 1;
    file.removed += 1;
    this.record(file, "removed", text);
  }

  context(file: ChangedFile, text: string): void {
    file.after.push({ added: false, text });
    this.record(file, "context", text);
  }

  end(file: ChangedFile | undefined): void {
    if (file !== undefined) {
      file.netRemoved += Math.max(0, this.removed - this.added);
    }
    this.added = 0;
    this.removed = 0;
    this.starting = false;
  }

  private record(file: ChangedFile, kind: TrailLine["kind"], text: string) {
    file.trail.push({ kind, text, start: this.starting });
    this.starting = false;
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
        previousPath: header[1] ?? header[2],
        deleted: false,
        added: [],
        removed: 0,
        netRemoved: 0,
        after: [],
        trail: [],
      };
      files.push(current);
      inHunk = false;
    } else if (current === undefined) {
      continue;
    } else if (line.startsWith("@@")) {
      hunk.end(current);
      inHunk = true;
      hunk.begin();
    } else if (!inHunk && line.startsWith("deleted file mode")) {
      current.deleted = true;
    } else if (inHunk && line.startsWith("+")) {
      hunk.plus(current, line.slice(1));
    } else if (inHunk && line.startsWith("-")) {
      hunk.minus(current, line.slice(1));
    } else if (inHunk && line.startsWith(" ")) {
      hunk.context(current, line.slice(1));
    }
  }
  hunk.end(current);
  return files;
}
