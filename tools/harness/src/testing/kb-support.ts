// Shared fixtures for the knowledge health check specs.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { findings, format, type TreeDeps } from "../kb/index.js";

export type Tree = Record<string, string | null>;

export function fakeDeps(tree: Tree): TreeDeps {
  const files = Object.keys(tree).filter((path) => tree[path] !== null);
  return { files: () => files, read: (path) => tree[path] ?? null };
}

export const planFrontmatter = [
  "---",
  "status: active",
  "summary: Delivers the thing.",
  "last-verified: 2026-11-07",
  "---",
  "",
].join("\n");

export const adrFrontmatter = [
  "---",
  "status: accepted",
  "date: 2026-09-13",
  "summary: Decides the thing.",
  "last-verified: 2026-11-07",
  "---",
  "",
].join("\n");

export const ideaFields = {
  summary: "Tries A.",
  hypothesis: "A makes B faster.",
  "expected-outcome": "B is 20 percent faster.",
  measurement: "Compare B duration before and after.",
  "safety-pattern": "feature-flagged",
  date: "2026-11-11",
};

/** An idea file; pass null to drop a field or a string to set it. */
export function ideaFile(
  changes: Record<string, string | null> = {},
  body = "# Idea 0001: A\n",
) {
  const fields = { ...ideaFields, ...changes };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`);
  return ["---", ...lines, "---", "", body].join("\n");
}

export const usage = [
  "const usage = `kore",
  "",
  "Usage:",
  "  kore doctor [--json]",
  "  kore cluster up|stop --environment <name>",
  "  kore cluster status [--json]",
  "`;",
].join("\n");

/** A tree that passes every check. Override or add files per test. */
export function cleanTree(
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
  return {
    "README.md": [
      "# Kore",
      "",
      "See the [index](docs/index.md#plans).",
      "Run `kore -- doctor` and `kore cluster up`.",
      "",
    ].join("\n"),
    "docs/index.md": [
      "# Index",
      "",
      "## Plans",
      "",
      "- [`infra/plans/1-a.md`](../infra/plans/1-a.md) — delivers A. Read when changing A.",
      "",
      "## Decisions",
      "",
      "- [`docs/decisions/0001-a.md`](decisions/0001-a.md) — decides A. Read when …",
      "",
      "## Ideas",
      "",
      "- [`docs/ideas/0001-a.md`](ideas/0001-a.md) — tries A.",
      "",
      "## Skills",
      "",
      "- [`skills/tdd/SKILL.md`](../skills/tdd/SKILL.md) — test first. Read when coding.",
      "",
    ].join("\n"),
    "infra/plans/1-a.md": `${planFrontmatter}# Plan A\n\n## Step 1: Do It\n\n- [x] done\n`,
    "docs/decisions/0001-a.md": `${adrFrontmatter}# ADR 0001: A\n\nFrom [Step 1](../../infra/plans/1-a.md#step-1-do-it).\n`,
    "docs/ideas/0001-a.md": ideaFile(),
    "skills/tdd/SKILL.md": "# TDD\n\nSee [rules](references/rules.md).\n",
    "skills/tdd/references/rules.md": "# Rules\n",
    "tools/kore/src/cli/cli.ts": `// Docs: infra/plans/1-a.md#step-1-do-it\n${usage}\n`,
    "tools/kore/src/app/index.ts":
      "// Plan: docs/decisions/0001-a.md. Main module.\nexport {};\n",
    ...overrides,
  };
}

export function check(tree: Tree) {
  return findings(fakeDeps(tree));
}

export function messages(tree: Tree) {
  return check(tree).map(format);
}
