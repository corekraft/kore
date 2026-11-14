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

/** The two paths a header names: the new path, and the path before a rename (equal when unchanged). */
interface HeaderPaths {
  path: string;
  previousPath: string;
}

/**
 * The old and new paths of an unquoted header. Git writes both sides bare, separated by a space, so a path
 * that contains " b/" gives several splits, and an equal-path split is not proof of the path: a
 * rename header can read the same. Only a header with exactly one " b/" is read; any other is
 * unreadable.
 */
function bareSplit(rest: string, line: string): HeaderPaths {
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
  return { path: only.b, previousPath: only.a };
}

/**
 * The old path of a quoted or bare a-side token, `a/` stripped. A quoted token decodes the same way
 * as a quoted new path, so an unknown escape or bytes that are not UTF-8 fail the read.
 */
function oldPath(token: string, line: string): string {
  if (token.startsWith('"')) {
    return unquote(token.slice(1, -1), line).slice(2);
  }
  return token.slice(2);
}

/** The old and new paths a `diff --git` header names, unquoted; a header that cannot be read fails the parse. */
function pathOf(line: string): HeaderPaths {
  if (!line.startsWith(GIT_PREFIX)) {
    throw unreadable(line);
  }
  const rest = line.slice(GIT_PREFIX.length);
  const quotedNew =
    /^("a\/(?:[^"\\]|\\.)*"|a\/.+?) "b\/((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (quotedNew !== null) {
    return {
      path: unquote(quotedNew[2] ?? "", line),
      previousPath: oldPath(quotedNew[1] ?? "", line),
    };
  }
  const quotedOld = /^"(a\/(?:[^"\\]|\\.)*)" b\/(.+)$/.exec(rest);
  if (quotedOld !== null) {
    return {
      path: quotedOld[2] ?? "",
      previousPath: unquote(quotedOld[1] ?? "", line).slice(2),
    };
  }
  return bareSplit(rest, line);
}

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
    if (line.startsWith("diff --")) {
      hunk.end(current);
      const { path, previousPath } = pathOf(line);
      current = {
        path,
        previousPath,
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
