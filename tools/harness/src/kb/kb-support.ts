// Fakes shared by the kb domain's unit specs. A support file is not a unit, so
// it needs no spec of its own (ADR 0098).
import type { TreeDeps } from "./findings.js";
import type { Finding } from "./markdown.js";

/** The finding the real finding() builds, for a mocked module to return. */
export function fakeFinding(
  file: string,
  line: number,
  message: string,
  fix: string,
): Finding {
  return { file, line, message, fix };
}

/** A tree of files: a path maps to its text, or to null when it is not tracked. */
export function fakeTree(files: Record<string, string | null>): TreeDeps {
  const tracked = Object.keys(files).filter((path) => files[path] !== null);
  return {
    files: () => tracked,
    read: (path) => files[path] ?? null,
  };
}

/** Frontmatter keys as frontmatter() returns them: the first key sits on line 2, after the opening ---. */
export function keysOf(
  entries: Record<string, string>,
): Map<string, { value: string; line: number }> {
  return new Map(
    Object.entries(entries).map(([key, value], index) => [
      key,
      { value, line: index + 2 },
    ]),
  );
}

/** Prose lines as proseLines() returns them, without the code-fence handling (that is markdown.ts's own test). */
export function fakeProse(markdown: string): { line: number; text: string }[] {
  return markdown.split("\n").map((text, index) => ({ line: index + 1, text }));
}
