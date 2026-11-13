import { JudgeError } from "./errors.js";

/** A `diff --git` header: each side is either bare or a quoted path, which git writes for special bytes. */
const HEADER =
  /^diff --git (?:a\/.+?|"a\/(?:[^"\\]|\\.)*") (?:b\/(.+)|"b\/((?:[^"\\]|\\.)*)")$/;
/** One piece of a quoted path: an octal byte, a one-character escape, or literal text. */
const QUOTED_PIECE = /\\([0-3][0-7]{2})|\\(.)|([^\\]+)/gs;
const ESCAPES = new Map<string, number>([
  ["a", 7],
  ["b", 8],
  ["t", 9],
  ["n", 10],
  ["v", 11],
  ["f", 12],
  ["r", 13],
  ['"', 34],
  ["\\", 92],
]);

function unreadable(line: string): JudgeError {
  return new JudgeError(
    `Cannot read the diff header on this line, so the file it changes is unknown: ${line}. Check that header in the PR diff and rerun the precheck.`,
  );
}

/** Decodes a quoted git path to its UTF-8 text; an escape it does not know fails the read. */
function unquote(quoted: string, line: string): string {
  const bytes: Buffer[] = [];
  for (const [, octal, escape, literal] of quoted.matchAll(QUOTED_PIECE)) {
    if (octal !== undefined) {
      bytes.push(Buffer.from([Number.parseInt(octal, 8)]));
    } else if (escape !== undefined) {
      const code = ESCAPES.get(escape);
      if (code === undefined) {
        throw unreadable(line);
      }
      bytes.push(Buffer.from([code]));
    } else {
      bytes.push(Buffer.from(literal ?? "", "utf8"));
    }
  }
  return Buffer.concat(bytes).toString("utf8");
}

/** The path a `diff --git` header names, unquoted; a header that cannot be read fails the parse. */
function pathOf(line: string): string {
  const header = HEADER.exec(line);
  if (header === null) {
    throw unreadable(line);
  }
  return header[1] ?? unquote(header[2] ?? "", line);
}

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
    if (line.startsWith("diff --git")) {
      hunk.end(current);
      current = {
        path: pathOf(line),
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
