// Knowledge health check: links, the index, frontmatter, upward `Docs:`
// markers, and README coverage of CLI commands.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "./node-test-shim.mjs";
import { fileURLToPath } from "node:url";

import { findings, format, run, slug } from "./kb-check.mjs";

const hook = fileURLToPath(new URL("./kb-check.mjs", import.meta.url));

const planFrontmatter = [
  "---",
  "status: active",
  "summary: Delivers the thing.",
  "last-verified: 2026-11-07",
  "---",
  "",
].join("\n");

const adrFrontmatter = [
  "---",
  "status: accepted",
  "date: 2026-09-13",
  "summary: Decides the thing.",
  "last-verified: 2026-11-07",
  "---",
  "",
].join("\n");

const ideaFields = {
  summary: "Tries A.",
  hypothesis: "A makes B faster.",
  "expected-outcome": "B is 20 percent faster.",
  measurement: "Compare B duration before and after.",
  "safety-pattern": "feature-flagged",
  date: "2026-11-11",
};

/** An idea file; pass null to drop a field or a string to set it. */
function ideaFile(changes = {}, body = "# Idea 0001: A\n") {
  const fields = { ...ideaFields, ...changes };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`);
  return ["---", ...lines, "---", "", body].join("\n");
}

const usage = [
  "const usage = `kore",
  "",
  "Usage:",
  "  kore doctor [--json]",
  "  kore cluster up|stop --environment <name>",
  "  kore cluster status [--json]",
  "`;",
].join("\n");

/** A tree that passes every check. Override or add files per test. */
function cleanTree(overrides = {}) {
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

function check(tree) {
  const files = Object.keys(tree).filter((path) => tree[path] !== null);
  return findings({
    files: () => files,
    read: (path) => tree[path] ?? null,
  });
}

function messages(tree) {
  return check(tree).map(format);
}

test("a clean tree reports nothing", () => {
  assert.deepEqual(messages(cleanTree()), []);
});

test("slug follows GitHub heading anchors", () => {
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

test("a relative link to a missing file is reported with file, line, and fix", () => {
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

test("a link to a missing anchor is reported, but an existing anchor is not", () => {
  const tree = cleanTree({
    "README.md":
      "# Kore\n\n[a](docs/index.md#nowhere) and [b](#kore).\nkore doctor, kore cluster\n",
  });
  assert.deepEqual(messages(tree), [
    "README.md:3: link anchor #nowhere is not a heading in docs/index.md; use one of its heading slugs, e.g. #index",
  ]);
});

test("duplicate headings get numbered anchors", () => {
  const tree = cleanTree({
    "skills/tdd/references/rules.md":
      "# Rules\n\n## Work\n\n## Work\n\n[x](#work-1) [y](#work-2)\n",
  });
  assert.deepEqual(messages(tree), [
    "skills/tdd/references/rules.md:7: link anchor #work-2 is not a heading in skills/tdd/references/rules.md; use one of its heading slugs, e.g. #rules",
  ]);
});

test("external links, links in code, and links to tracked directories are not checked", () => {
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

test("an untracked index is reported once", () => {
  const tree = cleanTree({ "docs/index.md": null });
  tree["README.md"] = "# Kore\n\nkore doctor and kore cluster\n";
  assert.deepEqual(messages(tree), [
    "docs/index.md:1: the knowledge index is missing; create it with one entry per plan, ADR, and skill",
  ]);
});

test("an index entry whose file is missing is reported", () => {
  const tree = cleanTree();
  tree["docs/index.md"] +=
    "- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone. Read when …\n";
  const found = check(tree).filter((f) => f.file === "docs/index.md");
  assert.deepEqual(found.map(format), [
    "docs/index.md:18: link target infra/plans/9-gone.md does not exist; point the link at an existing file or remove it",
    "docs/index.md:18: index entry infra/plans/9-gone.md names a missing file; remove the entry or restore the file",
  ]);
});

test("plans, ADRs, and skills missing from the index are reported, other files are not", () => {
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

test("a plan without frontmatter is reported", () => {
  const tree = cleanTree({
    "infra/plans/1-a.md": "# Plan A\n\n## Step 1: Do It\n",
  });
  assert.deepEqual(messages(tree), [
    "infra/plans/1-a.md:1: frontmatter is missing; start the file with --- status, summary, and last-verified ---",
  ]);
});

test("invalid plan frontmatter reports each bad key", () => {
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

test("ADR frontmatter needs a date, and a superseded ADR needs a resolving superseded-by", () => {
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
  tree["docs/decisions/0001-a.md"] = tree["docs/decisions/0001-a.md"]
    .replace("superseded-by: docs/decisions/0009-none.md\n", "")
    .replace("status: superseded\n", "status: superseded\ndate: 2026-09-13\n");
  assert.deepEqual(messages(tree), [
    "docs/decisions/0001-a.md:1: frontmatter superseded-by is missing; add a superseded-by: line",
  ]);
});

test("Docs:, Plan:, and ADR: markers whose path or anchor does not resolve are reported", () => {
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

test("markers in Markdown prose are not treated as code comments", () => {
  const tree = cleanTree({
    "skills/tdd/references/rules.md":
      "# Rules\n\nPlan: infra/plans/9-gone.md\n",
  });
  assert.deepEqual(messages(tree), []);
});

test("a top-level kore command in the usage text that README.md does not mention is reported", () => {
  const tree = cleanTree({
    "README.md":
      "# Kore\n\nRun `kore -- doctor`. Read the [index](docs/index.md).\n",
  });
  assert.deepEqual(messages(tree), [
    "tools/kore/src/cli/cli.ts:6: kore cluster is in the CLI usage text but README.md does not mention it; document it in README.md",
  ]);
});

function fakeDeps(tree) {
  const files = Object.keys(tree).filter((path) => tree[path] !== null);
  return { files: () => files, read: (path) => tree[path] ?? null };
}

function runWith(tree, argv) {
  const lines = [];
  const status = run(argv, fakeDeps(tree), (line) => lines.push(line));
  return { status, lines };
}

const brokenTree = () =>
  cleanTree({
    "README.md":
      "# Kore\n\nRun `kore -- doctor` and `kore cluster up`. Read the [index](docs/index.md) and [gone](missing.md).\n",
  });

test("warn mode prints each finding and a warn summary, and still exits 0", () => {
  const { status, lines } = runWith(brokenTree(), []);
  assert.equal(status, 0);
  assert.match(lines[0], /^README\.md:3: .*missing\.md/);
  assert.equal(
    lines.at(-1),
    "kb-check: 1 finding (warn mode; --strict fails on them)",
  );
});

test("--strict exits 1 when there are findings", () => {
  const { status, lines } = runWith(brokenTree(), ["--strict"]);
  assert.equal(status, 1);
  assert.equal(lines.at(-1), "kb-check: 1 finding");
});

test("a clean tree exits 0 in both modes and prints only the clean line", () => {
  for (const argv of [[], ["--strict"]]) {
    assert.deepEqual(runWith(cleanTree(), argv), {
      status: 0,
      lines: ["kb-check: clean"],
    });
  }
});

test("cli: runs against the repository and exits 0 in warn mode", () => {
  const warn = spawnSync(process.execPath, [hook], { encoding: "utf8" });
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(
    warn.stdout,
    /^kb-check: (clean|\d+ findings?|\d+ stale documents?)/m,
  );
});

// Skill audit: kb-check prints the bundled audit's report, never fails on it.
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

const auditReport = [
  "NAME   DESC  BODY  VERDICT",
  "big      10    42  over-budget (body)",
  "",
].join("\n");

function runAudited(tree, argv, audit) {
  const lines = [];
  const deps = { ...fakeDeps(tree), audit };
  const status = run(argv, deps, (line) => lines.push(line));
  return { status, lines };
}

test("the skill audit report is printed after kb-check's own output", () => {
  const { lines } = runAudited(cleanTree(), [], () => auditReport);
  assert.deepEqual(lines, [
    "kb-check: clean",
    "skill audit:",
    "  NAME   DESC  BODY  VERDICT",
    "  big      10    42  over-budget (body)",
  ]);
});

test("a skill over budget leaves the exit code unchanged, strict mode included", () => {
  for (const argv of [[], ["--strict"]]) {
    assert.equal(runAudited(cleanTree(), argv, () => auditReport).status, 0);
    assert.equal(
      runAudited(brokenTree(), argv, () => auditReport).status,
      argv.length ? 1 : 0,
    );
  }
});

test("an audit that fails to run is noted and does not change the exit code", () => {
  for (const argv of [[], ["--strict"]]) {
    const { status, lines } = runAudited(cleanTree(), argv, () => {
      throw new Error("spawn failed");
    });
    assert.equal(status, 0);
    assert.deepEqual(lines, [
      "kb-check: clean",
      "skill audit: not run (spawn failed)",
    ]);
  }
});

// Staleness: a document last verified before a file it depends on changed.
// Docs: infra/plans/5-self-maintenance.md#step-5-stale-documents

/** run() over a tree whose git history is a fixture: {path: "YYYY-MM-DD"}. */
function runWithHistory(tree, history, argv = []) {
  const lines = [];
  const asked = [];
  const deps = {
    ...fakeDeps(tree),
    commitDate: (path) => {
      asked.push(path);
      return history[path] ?? null;
    },
  };
  const status = run(argv, deps, (line) => lines.push(line));
  return { status, lines, asked };
}

test("a document verified after every file it depends on is current", () => {
  const { lines } = runWithHistory(cleanTree(), {
    "tools/kore/src/app/index.ts": "2026-11-06",
    "tools/kore/src/cli/cli.ts": "2026-11-07",
  });
  assert.deepEqual(lines, ["kb-check: clean"]);
});

test("a document older than a file it links to is stale, naming the document, its date, and the newest file and commit", () => {
  const { status, lines } = runWithHistory(
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

test("a document is stale through a file whose Docs, Plan, or ADR marker points back at it", () => {
  const { lines } = runWithHistory(cleanTree(), {
    "tools/kore/src/app/index.ts": "2026-12-01",
  });
  assert.ok(
    lines.includes(
      "stale: docs/decisions/0001-a.md was last verified 2026-11-07, but tools/kore/src/app/index.ts changed 2026-12-01; re-read it and update last-verified",
    ),
    lines.join("\n"),
  );
});

test("a document with no linked files, or whose files have no history, is never stale", () => {
  const tree = cleanTree({
    "infra/plans/1-a.md": `${planFrontmatter}# Plan A\n\n## Step 1: Do It\n\nNothing linked.\n`,
    "tools/kore/src/cli/cli.ts": `${usage}\n`,
    "tools/kore/src/app/index.ts": "export {};\n",
  });
  const { lines } = runWithHistory(tree, { "README.md": "2027-01-01" });
  assert.deepEqual(lines, ["kb-check: clean"]);
});

test("--strict ignores staleness: it neither fails nor counts it as a finding", () => {
  const { status, lines } = runWithHistory(
    cleanTree(),
    { "tools/kore/src/app/index.ts": "2026-12-01" },
    ["--strict"],
  );
  assert.equal(status, 0);
  assert.equal(lines.at(-1), "kb-check: 1 stale document (warn only)");
  assert.ok(lines.every((line) => !line.startsWith("kb-check: 1 finding")));
});

test("staleness is skipped for a document with no valid last-verified date, which is already a finding", () => {
  const tree = cleanTree({
    "infra/plans/1-a.md":
      "# Plan A\n\nSee [rules](../../skills/tdd/SKILL.md).\n",
  });
  const { lines } = runWithHistory(tree, {
    "skills/tdd/SKILL.md": "2026-12-01",
  });
  assert.ok(lines.every((line) => !line.startsWith("stale:")));
});

const idea = (changes, body) => ({
  "docs/ideas/0001-a.md": ideaFile(changes, body),
});

test("a valid idea, with or without an outcome, reports nothing", () => {
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

test("an outcome line without its Outcome section, and a section without its line, are reported", () => {
  assert.deepEqual(messages(cleanTree(idea({ outcome: "refuted" }))), [
    "docs/ideas/0001-a.md:8: frontmatter outcome has no ## Outcome section; run `harness outcome record --idea 1`, or remove the line",
  ]);
  const withSection = "# Idea 0001: A\n\n## Outcome\n\nNo.\n";
  const [problem] = messages(cleanTree(idea({}, withSection)));
  assert.match(
    problem,
    /^docs\/ideas\/0001-a\.md:\d+: ## Outcome section has no frontmatter outcome line; /,
  );
});

test("an idea missing a required field is reported with the field named", () => {
  for (const key of Object.keys(ideaFields)) {
    assert.deepEqual(messages(cleanTree(idea({ [key]: null }))), [
      `docs/ideas/0001-a.md:1: frontmatter ${key} is missing; add a ${key}: line`,
    ]);
  }
});

test("an idea with no frontmatter is reported", () => {
  const tree = cleanTree({ "docs/ideas/0001-a.md": "# Idea 0001: A\n" });
  assert.deepEqual(messages(tree), [
    "docs/ideas/0001-a.md:1: frontmatter is missing; start the file with --- and the idea fields (summary, hypothesis, expected-outcome, measurement, safety-pattern, date) ---",
  ]);
});

test("an idea with an unknown safety pattern, outcome, or date is reported", () => {
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

test("an idea's status is workflow state: the file has none, and a closed idea is one with an outcome", () => {
  const out = messages(cleanTree(idea({ status: "open" })));
  assert.equal(out.length, 1);
  assert.match(
    out[0],
    /frontmatter status is workflow state; the GitHub issue owns it, so remove the line/,
  );
});

test("an idea carrying workflow state is reported: approval, label, assignee", () => {
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
      out[0],
      new RegExp(
        `frontmatter ${key} is workflow state; the GitHub issue owns it, so remove the line`,
      ),
    );
  }
});

test("an idea's issue and parent links must be well formed, and a parent idea must exist", () => {
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

test("an idea file must be named NNNN-slug.md", () => {
  const tree = cleanTree({ "docs/ideas/a.md": ideaFile() });
  assert.ok(
    messages(tree).includes(
      "docs/ideas/a.md:1: idea file is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug",
    ),
  );
});

test("an idea missing from the index is reported", () => {
  const tree = cleanTree({
    "docs/ideas/0002-b.md": ideaFile({}, "# Idea 0002: B\n"),
  });
  assert.deepEqual(messages(tree), [
    "docs/index.md:1: docs/ideas/0002-b.md is not in the index; add an entry under its ## heading",
  ]);
});

test("an idea's frontmatter must be flat scalars", () => {
  const tree = cleanTree(idea({ hypothesis: "[a, b]" }));
  assert.match(
    messages(tree).join("\n"),
    /frontmatter hypothesis is not a scalar string/,
  );
});

test("two idea files sharing a number are reported on the later file, naming the earlier one", () => {
  const tree = cleanTree({
    "docs/ideas/0001-b.md": ideaFile({}, "# Idea 0001: B\n"),
    "docs/index.md": cleanTree()["docs/index.md"].replace(
      "- [`docs/ideas/0001-a.md`](ideas/0001-a.md) — tries A.",
      "- [`docs/ideas/0001-a.md`](ideas/0001-a.md) — tries A.\n- [`docs/ideas/0001-b.md`](ideas/0001-b.md) — tries B.",
    ),
  });
  assert.deepEqual(messages(tree), [
    "docs/ideas/0001-b.md:1: idea number 0001 is also used by docs/ideas/0001-a.md; renumber it to the next free number",
  ]);
});
