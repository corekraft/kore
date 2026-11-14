// Idea records get their own frontmatter checks (ADR 0079).
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import assert from "node:assert/strict";
import { it } from "vitest";
import {
  cleanTree,
  ideaFields,
  ideaFile,
  messages,
  type Tree,
} from "../testing/index.js";

const idea = (changes: Record<string, string | null>, body?: string): Tree => ({
  "docs/ideas/0001-a.md": ideaFile(changes, body),
});

it("a valid idea, with or without an outcome, reports nothing", () => {
  assert.deepEqual(
    messages(cleanTree(idea({ issue: "185", parent: "#127" }))),
    [],
  );
  assert.deepEqual(
    messages(
      cleanTree(
        idea({ outcome: "refuted" }, "# Idea 0001: A\n\n## Outcome\n\nNo.\n"),
      ),
    ),
    [],
  );
});

it("an outcome line without its Outcome section, and a section without its line, are reported", () => {
  assert.deepEqual(messages(cleanTree(idea({ outcome: "refuted" }))), [
    "docs/ideas/0001-a.md:8: frontmatter outcome has no ## Outcome section; run `harness outcome record --idea 1`, or remove the line",
  ]);
  const withSection = "# Idea 0001: A\n\n## Outcome\n\nNo.\n";
  const problem = messages(cleanTree(idea({}, withSection)))[0] ?? "";
  assert.match(
    problem,
    /^docs\/ideas\/0001-a\.md:\d+: ## Outcome section has no frontmatter outcome line; /,
  );
});

it("an idea missing a required field is reported with the field named", () => {
  for (const key of Object.keys(ideaFields)) {
    assert.deepEqual(messages(cleanTree(idea({ [key]: null }))), [
      `docs/ideas/0001-a.md:1: frontmatter ${key} is missing; add a ${key}: line`,
    ]);
  }
});

it("an idea with no frontmatter is reported", () => {
  const tree = cleanTree({ "docs/ideas/0001-a.md": "# Idea 0001: A\n" });
  assert.deepEqual(messages(tree), [
    "docs/ideas/0001-a.md:1: frontmatter is missing; start the file with --- and the idea fields (summary, hypothesis, expected-outcome, measurement, safety-pattern, date) ---",
  ]);
});

it("an idea with an unknown safety pattern, outcome, or date is reported", () => {
  const out = messages(
    cleanTree(
      idea({
        "safety-pattern": "yolo",
        outcome: "great",
        date: "yesterday",
      }),
    ),
  ).join("\n");
  assert.match(
    out,
    /frontmatter safety-pattern is yolo; use one of no-behaviour-change, feature-flagged, dark-launched, branch-by-abstraction, expand-contract/,
  );
  assert.match(
    out,
    /frontmatter outcome is great; use one of confirmed, refuted, inconclusive/,
  );
  assert.match(out, /frontmatter date is yesterday; use a YYYY-MM-DD date/);
});

it("an idea's status is workflow state: the file has none, and a closed idea is one with an outcome", () => {
  const out = messages(cleanTree(idea({ status: "open" })));
  assert.equal(out.length, 1);
  assert.match(
    out[0] ?? "",
    /frontmatter status is workflow state; the GitHub issue owns it, so remove the line/,
  );
});

it("an idea carrying workflow state is reported: approval, label, assignee", () => {
  for (const key of [
    "status",
    "approval",
    "approved",
    "label",
    "labels",
    "assignee",
    "assignees",
    "state",
  ]) {
    const out = messages(cleanTree(idea({ [key]: "x" })));
    assert.equal(out.length, 1, key);
    assert.match(
      out[0] ?? "",
      new RegExp(
        `frontmatter ${key} is workflow state; the GitHub issue owns it, so remove the line`,
      ),
    );
  }
});

it("an idea's issue and parent links must be well formed, and a parent idea must exist", () => {
  const out = messages(cleanTree(idea({ issue: "soon", parent: "0042" }))).join(
    "\n",
  );
  assert.match(
    out,
    /frontmatter issue is soon; use an issue number such as 185 or #185/,
  );
  assert.match(out, /frontmatter parent is 0042; idea 0042 does not exist/);
  assert.deepEqual(
    messages(
      cleanTree(
        idea({
          parent: "0001-a",
          issue: "https://github.com/corekraft/kore/issues/1",
        }),
      ),
    ),
    [],
  );
});

it("an idea file must be named NNNN-slug.md", () => {
  const tree = cleanTree({ "docs/ideas/a.md": ideaFile() });
  assert.ok(
    messages(tree).includes(
      "docs/ideas/a.md:1: idea file is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug",
    ),
  );
});

it("an idea missing from the index is reported", () => {
  const tree = cleanTree({
    "docs/ideas/0002-b.md": ideaFile({}, "# Idea 0002: B\n"),
  });
  assert.deepEqual(messages(tree), [
    "docs/index.md:1: docs/ideas/0002-b.md is not in the index; add an entry under its ## heading",
  ]);
});

it("an idea's frontmatter must be flat scalars", () => {
  const tree = cleanTree(idea({ hypothesis: "[a, b]" }));
  assert.match(
    messages(tree).join("\n"),
    /frontmatter hypothesis is not a scalar string/,
  );
});

it("two idea files sharing a number are reported on the later file, naming the earlier one", () => {
  const tree = cleanTree({
    "docs/ideas/0001-b.md": ideaFile({}, "# Idea 0001: B\n"),
    "docs/index.md": (cleanTree()["docs/index.md"] ?? "").replace(
      "- [`docs/ideas/0001-a.md`](ideas/0001-a.md) — tries A.",
      "- [`docs/ideas/0001-a.md`](ideas/0001-a.md) — tries A.\n- [`docs/ideas/0001-b.md`](ideas/0001-b.md) — tries B.",
    ),
  });
  assert.deepEqual(messages(tree), [
    "docs/ideas/0001-b.md:1: idea number 0001 is also used by docs/ideas/0001-a.md; renumber it to the next free number",
  ]);
});
