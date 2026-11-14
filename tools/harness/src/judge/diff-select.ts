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

/** A glob as a regex: `**` crosses slashes, `*` and `?` stay inside one path part, anything else is literal. */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let at = 0; at < glob.length; at += 1) {
    const char = glob.charAt(at);
    if (char === "*" && glob.charAt(at + 1) === "*") {
      source += ".*";
      at += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
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
  const patterns = globs.map(globToRegExp);
  return sections(text).filter(
    (section) =>
      patterns.length === 0 ||
      patterns.some(
        (re) => re.test(section.path) || re.test(section.previousPath),
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
