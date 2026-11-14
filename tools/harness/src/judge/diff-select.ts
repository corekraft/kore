import { parseDiff } from "./diff.js";

/** One file's section of a unified diff: its text and the counts the stat reports. */
interface Section {
  text: string;
  path: string;
  previousPath: string;
  added: number;
  removed: number;
}

/** The per-file line counts `--stat` prints. */
export interface FileStat {
  path: string;
  added: number;
  removed: number;
}

/** Whether a glob matches a whole path: `**` crosses slashes, `*` and `?` stay inside one path part, anything else is literal. */
function matches(glob: string, path: string): boolean {
  if (glob === "") {
    return path === "";
  }
  if (glob.startsWith("**")) {
    const rest = glob.slice(2);
    return Array.from({ length: path.length + 1 }, (_, at) => at).some((at) =>
      matches(rest, path.slice(at)),
    );
  }
  if (glob.startsWith("*")) {
    const rest = glob.slice(1);
    const part = path.indexOf("/");
    const reach = part === -1 ? path.length : part;
    return Array.from({ length: reach + 1 }, (_, at) => at).some((at) =>
      matches(rest, path.slice(at)),
    );
  }
  const next = path.charAt(0);
  const same = glob.startsWith("?") ? next !== "/" : next === glob.charAt(0);
  return path !== "" && same && matches(glob.slice(1), path.slice(1));
}

/** The diff cut at each `diff --git` header, one section per file, in order. */
function sections(text: string): Section[] {
  return text
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .flatMap((part) =>
      parseDiff(part).map((file) => ({
        text: part,
        path: file.path,
        previousPath: file.previousPath,
        added: file.added.length,
        removed: file.removed,
      })),
    );
}

/** The sections a glob list keeps: all of them for an empty list, else those whose new or old path matches a glob. */
function chosen(text: string, globs: readonly string[]): Section[] {
  return sections(text).filter(
    (section) =>
      globs.length === 0 ||
      globs.some(
        (glob) =>
          matches(glob, section.path) || matches(glob, section.previousPath),
      ),
  );
}

/** The diff limited to the files the globs match, each file's text unchanged; the whole diff when no glob is given. */
export function selectDiff(text: string, globs: readonly string[]): string {
  return globs.length === 0
    ? text
    : chosen(text, globs)
        .map((section) => section.text)
        .join("");
}

/** The added and removed line counts of each file the globs match, in diff order. */
export function diffStat(text: string, globs: readonly string[]): FileStat[] {
  return chosen(text, globs).map(({ path, added, removed }) => ({
    path,
    added,
    removed,
  }));
}
