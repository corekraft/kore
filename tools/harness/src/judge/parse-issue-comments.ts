import type { ExpandComment } from "./expand-step-check.js";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function commentOf(c: Record<string, unknown>): ExpandComment {
  const author = (c["author"] as Record<string, unknown> | null)?.["login"];
  return {
    body: text(c["body"]),
    author: text(author),
    createdAt: text(c["createdAt"]),
  };
}

/** The comments of an issue from `gh issue view --json comments`; undefined when the output is not JSON. */
export function parseIssueComments(
  stdout: string,
): ExpandComment[] | undefined {
  try {
    const view = JSON.parse(stdout) as { comments?: unknown };
    return Array.isArray(view.comments)
      ? (view.comments as Record<string, unknown>[]).map(commentOf)
      : [];
  } catch {
    return undefined;
  }
}
