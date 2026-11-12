// Markdown helpers for the knowledge health check: heading anchors, links, and
// flat frontmatter.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { posix } from "node:path";

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** One knowledge-base problem: where it is, what is wrong, and how to fix it. */
export interface Finding {
  file: string;
  line: number;
  message: string;
  fix: string;
}

export function finding(
  file: string,
  line: number,
  message: string,
  fix: string,
): Finding {
  return { file, line, message, fix };
}

/** The GitHub anchor slug of a heading's text. */
export function slug(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Lines outside fenced code blocks, with inline code removed. */
export function proseLines(markdown: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let fence: string | null = null;
  markdown.split("\n").forEach((text, index) => {
    const opener = /^\s*(```|~~~)/.exec(text);
    if (fence) {
      if (opener && opener[1] === fence) {
        fence = null;
      }
      return;
    }
    if (opener) {
      fence = opener[1] ?? null;
      return;
    }
    lines.push({ line: index + 1, text: text.replace(/`[^`]*`/g, "") });
  });
  return lines;
}

/** Every heading anchor in a Markdown file, numbering duplicates as GitHub does. */
export function anchors(markdown: string): string[] {
  const seen = new Map<string, number>();
  const result: string[] = [];
  for (const { text } of proseLines(markdown)) {
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (!match) {
      continue;
    }
    const base = slug(match[1] ?? "");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.push(count ? `${base}-${count}` : base);
  }
  return result;
}

/** Resolve a link target against the directory of `from`; null when it leaves the repository. */
export function resolve(from: string, target: string): string | null {
  const joined = posix.normalize(posix.join(posix.dirname(from), target));
  if (joined === ".." || joined.startsWith("../")) {
    return null;
  }
  return joined.replace(/\/$/, "") || ".";
}

export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

export interface Frontmatter {
  keys: Map<string, { value: string; line: number }>;
  errors: Finding[];
}

/** Parse flat frontmatter, or null when absent. */
export function frontmatter(
  file: string,
  markdown: string,
): Frontmatter | null {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") {
    return null;
  }
  const keys = new Map<string, { value: string; line: number }>();
  const errors: Finding[] = [];
  for (let index = 1; index < lines.length; index++) {
    const text = lines[index] ?? "";
    if (text === "---") {
      return { keys, errors };
    }
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(text);
    if (match?.[2] && !/^[[{|>&*!-]/.test(match[2])) {
      keys.set(match[1] ?? "", { value: match[2].trim(), line: index + 1 });
    } else {
      const key = match ? match[1] : text.trim();
      errors.push(
        finding(
          file,
          index + 1,
          `frontmatter ${key} is not a scalar string`,
          "use flat key: value lines only",
        ),
      );
    }
  }
  return null;
}
