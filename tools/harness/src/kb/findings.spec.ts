// Knowledge health check: links, the index, frontmatter, upward `Docs:`
// markers, and README coverage of CLI commands.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import assert from "node:assert/strict";
import { it } from "vitest";
import { format, slug } from "./index.js";
import {
  adrFrontmatter,
  check,
  cleanTree,
  messages,
  planFrontmatter,
} from "../testing/index.js";

it("a clean tree reports nothing", () => {
  assert.deepEqual(messages(cleanTree()), []);
});

it("slug follows GitHub heading anchors", () => {
  assert.equal(
    slug("Step 3: Knowledge Health Check"),
    "step-3-knowledge-health-check",
  );
  assert.equal(
    slug("Step 9: Workload Identity, Application Image Trust, and Policy"),
    "step-9-workload-identity-application-image-trust-and-policy",
  );
  assert.equal(slug("Use `kore` as a CLI"), "use-kore-as-a-cli");
  assert.equal(slug("Read [the plan](x.md) first"), "read-the-plan-first");
  assert.equal(slug("snake_case and dash-ed"), "snake_case-and-dash-ed");
});

it("a relative link to a missing file is reported with file, line, and fix", () => {
  const tree = cleanTree({
    "skills/tdd/SKILL.md": "# TDD\n\nSee [rules](references/gone.md).\n",
  });
  assert.deepEqual(check(tree), [
    {
      file: "skills/tdd/SKILL.md",
      line: 3,
      message: "link target skills/tdd/references/gone.md does not exist",
      fix: "point the link at an existing file or remove it",
    },
  ]);
});

it("a link to a missing anchor is reported, but an existing anchor is not", () => {
  const tree = cleanTree({
    "README.md":
      "# Kore\n\n[a](docs/index.md#nowhere) and [b](#kore).\nkore doctor, kore cluster\n",
  });
  assert.deepEqual(messages(tree), [
    "README.md:3: link anchor #nowhere is not a heading in docs/index.md; use one of its heading slugs, e.g. #index",
  ]);
});

it("duplicate headings get numbered anchors", () => {
  const tree = cleanTree({
    "skills/tdd/references/rules.md":
      "# Rules\n\n## Work\n\n## Work\n\n[x](#work-1) [y](#work-2)\n",
  });
  assert.deepEqual(messages(tree), [
    "skills/tdd/references/rules.md:7: link anchor #work-2 is not a heading in skills/tdd/references/rules.md; use one of its heading slugs, e.g. #rules",
  ]);
});

it("external links, links in code, and links to tracked directories are not checked", () => {
  const tree = cleanTree({
    "skills/tdd/references/rules.md": [
      "# Rules",
      "",
      "[web](https://example.com/x.md) [mail](mailto:a@b.c) [dir](../)",
      "`[code](missing.md)`",
      "```markdown",
      "[fenced](missing.md)",
      "```",
      "",
    ].join("\n"),
  });
  assert.deepEqual(messages(tree), []);
});

it("an untracked index is reported once", () => {
  const tree = cleanTree({ "docs/index.md": null });
  tree["README.md"] = "# Kore\n\nkore doctor and kore cluster\n";
  assert.deepEqual(messages(tree), [
    "docs/index.md:1: the knowledge index is missing; create it with one entry per plan, ADR, and skill",
  ]);
});

it("an index entry whose file is missing is reported", () => {
  const tree = cleanTree();
  tree["docs/index.md"] +=
    "- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone. Read when …\n";
  const found = check(tree).filter((f) => f.file === "docs/index.md");
  assert.deepEqual(found.map(format), [
    "docs/index.md:18: link target infra/plans/9-gone.md does not exist; point the link at an existing file or remove it",
    "docs/index.md:18: index entry infra/plans/9-gone.md names a missing file; remove the entry or restore the file",
  ]);
});

it("plans, ADRs, and skills missing from the index are reported, other files are not", () => {
  const tree = cleanTree({
    "infra/plans/2-b.md": `${planFrontmatter}# Plan B\n`,
    "docs/decisions/0002-b.md": `${adrFrontmatter}# ADR 0002\n`,
    "skills/adr/SKILL.md": "# ADR\n",
    "infra/catalog/compatibility.md": "# Compatibility\n",
  });
  assert.deepEqual(messages(tree), [
    "docs/index.md:1: docs/decisions/0002-b.md is not in the index; add an entry under its ## heading",
    "docs/index.md:1: infra/plans/2-b.md is not in the index; add an entry under its ## heading",
    "docs/index.md:1: skills/adr/SKILL.md is not in the index; add an entry under its ## heading",
  ]);
});

it("a plan without frontmatter is reported", () => {
  const tree = cleanTree({
    "infra/plans/1-a.md": "# Plan A\n\n## Step 1: Do It\n",
  });
  assert.deepEqual(messages(tree), [
    "infra/plans/1-a.md:1: frontmatter is missing; start the file with --- status, summary, and last-verified ---",
  ]);
});

it("invalid plan frontmatter reports each bad key", () => {
  const tree = cleanTree({
    "infra/plans/1-a.md": [
      "---",
      "status: accepted",
      "last-verified: yesterday",
      "tags: [a, b]",
      "---",
      "# Plan A",
      "## Step 1: Do It",
      "",
    ].join("\n"),
  });
  assert.deepEqual(messages(tree), [
    "infra/plans/1-a.md:2: frontmatter status is accepted; use one of active, done",
    "infra/plans/1-a.md:3: frontmatter last-verified is yesterday; use a YYYY-MM-DD date",
    "infra/plans/1-a.md:4: frontmatter tags is not a scalar string; use flat key: value lines only",
    "infra/plans/1-a.md:1: frontmatter summary is missing; add a summary: line",
  ]);
});

it("ADR frontmatter needs a date, and a superseded ADR needs a resolving superseded-by", () => {
  const tree = cleanTree({
    "docs/decisions/0001-a.md": [
      "---",
      "status: superseded",
      "summary: Decides the thing.",
      "last-verified: 2026-11-07",
      "superseded-by: docs/decisions/0009-none.md",
      "---",
      "# ADR 0001",
      "",
    ].join("\n"),
  });
  assert.deepEqual(messages(tree), [
    "docs/decisions/0001-a.md:5: frontmatter superseded-by docs/decisions/0009-none.md does not exist; use the replacing ADR's path from the repository root",
    "docs/decisions/0001-a.md:1: frontmatter date is missing; add a date: line",
  ]);
  tree["docs/decisions/0001-a.md"] = (tree["docs/decisions/0001-a.md"] ?? "")
    .replace("superseded-by: docs/decisions/0009-none.md\n", "")
    .replace("status: superseded\n", "status: superseded\ndate: 2026-09-13\n");
  assert.deepEqual(messages(tree), [
    "docs/decisions/0001-a.md:1: frontmatter superseded-by is missing; add a superseded-by: line",
  ]);
});

it("Docs:, Plan:, and ADR: markers whose path or anchor does not resolve are reported", () => {
  const tree = cleanTree({
    "tools/kore/src/a.ts": "// Docs: infra/plans/9-gone.md#x\n",
    "tools/kore/src/b.ts": "// ADR: docs/decisions/0001-a.md#no-such-heading\n",
    "infra/c.sh": "#!/bin/sh\n# Plan: infra/plans/1-a.md (Step 1).\n",
  });
  assert.deepEqual(messages(tree), [
    "tools/kore/src/a.ts:1: Docs: path infra/plans/9-gone.md does not exist; use a path from the repository root",
    "tools/kore/src/b.ts:1: ADR: anchor #no-such-heading is not a heading in docs/decisions/0001-a.md; use one of its heading slugs, e.g. #adr-0001-a",
  ]);
});

it("markers in Markdown prose are not treated as code comments", () => {
  const tree = cleanTree({
    "skills/tdd/references/rules.md":
      "# Rules\n\nPlan: infra/plans/9-gone.md\n",
  });
  assert.deepEqual(messages(tree), []);
});

it("a top-level kore command in the usage text that README.md does not mention is reported", () => {
  const tree = cleanTree({
    "README.md":
      "# Kore\n\nRun `kore -- doctor`. Read the [index](docs/index.md).\n",
  });
  assert.deepEqual(messages(tree), [
    "tools/kore/src/cli/cli.ts:6: kore cluster is in the CLI usage text but README.md does not mention it; document it in README.md",
  ]);
});
