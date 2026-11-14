import type { ChangedFile, TrailLine } from "./diff.js";

type Kind = TrailLine["kind"];
export type Line = [Kind, string];
export const add = (text: string): Line => ["added", text];
export const del = (text: string): Line => ["removed", text];
export const ctx = (text: string): Line => ["context", text];

/** The file's full text at the merge base and at the head, as the precheck fetches it. */
export const withSides = (
  changed: ChangedFile,
  before: string | undefined,
  after: string | undefined,
): ChangedFile => ({ ...changed, sides: { before, after } });

/** One file; each hunk is a list of lines, and the first line of a hunk starts it. */
export const file = (
  path: string,
  hunks: Line[][] = [],
  previousPath = path,
): ChangedFile => {
  const trail = hunks.flatMap((hunk) =>
    hunk.map(([kind, text], i) => ({ kind, text, start: i === 0 })),
  );
  const added = trail.filter((l) => l.kind === "added");
  const removed = trail.filter((l) => l.kind === "removed").length;
  return {
    path,
    previousPath,
    deleted: false,
    added: added.map((l) => l.text),
    removed,
    netRemoved: Math.max(0, removed - added.length),
    after: trail
      .filter((l) => l.kind !== "removed")
      .map((l) => ({ added: l.kind === "added", text: l.text })),
    trail,
  };
};
