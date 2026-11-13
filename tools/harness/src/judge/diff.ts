import { JudgeError } from "./errors.js";

const GIT_PREFIX = "diff --git ";
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
    `Cannot read the diff header on this line, so the file it changes is unknown: ${line}. Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.`,
  );
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

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
  try {
    return UTF8.decode(Buffer.concat(bytes));
  } catch (error) {
    if (error instanceof TypeError) {
      throw unreadable(line);
    }
    throw error;
  }
}

/**
 * The new path of an unquoted header. Git writes both sides bare, separated by a space, so a path
 * that contains " b/" gives several splits, and an equal-path split is not proof of the path: a
 * rename header can read the same. Only a header with exactly one " b/" is read; any other is
 * unreadable.
 */
function bareSplit(rest: string, line: string): string {
  if (!rest.startsWith("a/")) {
    throw unreadable(line);
  }
  const splits: { a: string; b: string }[] = [];
  for (
    let at = rest.indexOf(" b/");
    at !== -1;
    at = rest.indexOf(" b/", at + 1)
  ) {
    splits.push({ a: rest.slice(2, at), b: rest.slice(at + 3) });
  }
  const [only] = splits;
  if (only === undefined || splits.length !== 1) {
    throw unreadable(line);
  }
  return only.b;
}

/** The new path a `diff --git` header names, unquoted; a header that cannot be read fails the parse. */
function pathOf(line: string): string {
  if (!line.startsWith(GIT_PREFIX)) {
    throw unreadable(line);
  }
  const rest = line.slice(GIT_PREFIX.length);
  const quotedNew =
    /^(?:"a\/(?:[^"\\]|\\.)*"|a\/.+?) "b\/((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (quotedNew !== null) {
    return unquote(quotedNew[1] ?? "", line);
  }
  const quotedOld = /^"a\/(?:[^"\\]|\\.)*" b\/(.+)$/.exec(rest);
  if (quotedOld !== null) {
    return quotedOld[1] ?? "";
  }
  return bareSplit(rest, line);
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
    if (line.startsWith("diff --")) {
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
