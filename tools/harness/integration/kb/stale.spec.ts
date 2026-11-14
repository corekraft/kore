// Staleness: a document last verified before a file it depends on changed.
// Docs: infra/plans/5-self-maintenance.md#step-5-stale-documents

import assert from "node:assert/strict";
import { it } from "vitest";
import { run } from "../../src/kb/index.js";
import {
  cleanTree,
  fakeDeps,
  planFrontmatter,
  usage,
  type Tree,
} from "../../src/testing/index.js";

/** run() over a tree whose git history is a fixture: {path: "YYYY-MM-DD"}. */
async function runWithHistory(
  tree: Tree,
  history: Record<string, string>,
  argv: string[] = [],
) {
  const lines: string[] = [];
  const asked: string[] = [];
  const deps = {
    ...fakeDeps(tree),
    commitDate: (path: string) => {
      asked.push(path);
      return Promise.resolve(history[path] ?? null);
    },
  };
  const status = await run(argv, deps, (line) => lines.push(line));
  return { status, lines, asked };
}

it("a document verified after every file it depends on is current", async () => {
  const { lines } = await runWithHistory(cleanTree(), {
    "tools/kore/src/app/index.ts": "2026-11-06",
    "tools/kore/src/cli/cli.ts": "2026-11-07",
  });
  assert.deepEqual(lines, ["kb-check: clean"]);
});

it("a document older than a file it links to is stale, naming the document, its date, and the newest file and commit", async () => {
  const { status, lines } = await runWithHistory(
    cleanTree({
      "infra/plans/1-a.md": `${planFrontmatter}# Plan A\n\n## Step 1: Do It\n\nSee [the rules](../../skills/tdd/references/rules.md) and [the skill](../../skills/tdd/SKILL.md).\n`,
    }),
    {
      "skills/tdd/references/rules.md": "2026-11-09",
      "skills/tdd/SKILL.md": "2026-11-12",
    },
  );
  assert.equal(status, 0);
  assert.ok(
    lines.includes(
      "stale: infra/plans/1-a.md was last verified 2026-11-07, but skills/tdd/SKILL.md changed 2026-11-12; re-read it and update last-verified",
    ),
    lines.join("\n"),
  );
  assert.equal(lines.at(-1), "kb-check: 1 stale document (warn only)");
});

it("a document is stale through a file whose Docs, Plan, or ADR marker points back at it", async () => {
  const { lines } = await runWithHistory(cleanTree(), {
    "tools/kore/src/app/index.ts": "2026-12-01",
  });
  assert.ok(
    lines.includes(
      "stale: docs/decisions/0001-a.md was last verified 2026-11-07, but tools/kore/src/app/index.ts changed 2026-12-01; re-read it and update last-verified",
    ),
    lines.join("\n"),
  );
});

it("a document with no linked files, or whose files have no history, is never stale", async () => {
  const tree = cleanTree({
    "infra/plans/1-a.md": `${planFrontmatter}# Plan A\n\n## Step 1: Do It\n\nNothing linked.\n`,
    "tools/kore/src/cli/cli.ts": `${usage}\n`,
    "tools/kore/src/app/index.ts": "export {};\n",
  });
  const { lines } = await runWithHistory(tree, { "README.md": "2027-01-01" });
  assert.deepEqual(lines, ["kb-check: clean"]);
});

it("--strict ignores staleness: it neither fails nor counts it as a finding", async () => {
  const { status, lines } = await runWithHistory(
    cleanTree(),
    { "tools/kore/src/app/index.ts": "2026-12-01" },
    ["--strict"],
  );
  assert.equal(status, 0);
  assert.equal(lines.at(-1), "kb-check: 1 stale document (warn only)");
  assert.ok(lines.every((line) => !line.startsWith("kb-check: 1 finding")));
});

it("staleness is skipped for a document with no valid last-verified date, which is already a finding", async () => {
  const tree = cleanTree({
    "infra/plans/1-a.md":
      "# Plan A\n\nSee [rules](../../skills/tdd/SKILL.md).\n",
  });
  const { lines } = await runWithHistory(tree, {
    "skills/tdd/SKILL.md": "2026-12-01",
  });
  assert.ok(lines.every((line) => !line.startsWith("stale:")));
});
