// The report: warn and --strict exit codes, the skill audit and the flag audit.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

import assert from "node:assert/strict";
import { it } from "vitest";
import { run } from "./index.js";
import { CommandError } from "../runtime/index.js";
import { cleanTree, fakeDeps, type Tree } from "../testing/index.js";

async function runWith(tree: Tree, argv: string[]) {
  const lines: string[] = [];
  const status = await run(argv, fakeDeps(tree), (line) => lines.push(line));
  return { status, lines };
}

const brokenTree = () =>
  cleanTree({
    "README.md":
      "# Kore\n\nRun `kore -- doctor` and `kore cluster up`. Read the [index](docs/index.md) and [gone](missing.md).\n",
  });

it("warn mode prints each finding and a warn summary, and still exits 0", async () => {
  const { status, lines } = await runWith(brokenTree(), []);
  assert.equal(status, 0);
  assert.match(lines[0] ?? "", /^README\.md:3: .*missing\.md/);
  assert.equal(
    lines.at(-1),
    "kb-check: 1 finding (warn mode; --strict fails on them)",
  );
});

it("--strict exits 1 when there are findings", async () => {
  const { status, lines } = await runWith(brokenTree(), ["--strict"]);
  assert.equal(status, 1);
  assert.equal(lines.at(-1), "kb-check: 1 finding");
});

it("a clean tree exits 0 in both modes and prints only the clean line", async () => {
  for (const argv of [[], ["--strict"]]) {
    assert.deepEqual(await runWith(cleanTree(), argv), {
      status: 0,
      lines: ["kb-check: clean"],
    });
  }
});

// Skill audit: kb-check prints the audit's report; --strict fails on a skill over budget (ADR 0080).
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

const auditText = [
  "NAME   DESC  BODY  VERDICT",
  "big      10    42  over-budget (body)",
  "",
].join("\n");
const overBudget = () => Promise.resolve({ text: auditText, failing: true });
const withinBudget = () => Promise.resolve({ text: auditText, failing: false });

async function runAudited(
  tree: Tree,
  argv: string[],
  audit: () => Promise<{ text: string; failing: boolean }>,
) {
  const lines: string[] = [];
  const deps = { ...fakeDeps(tree), audit };
  const status = await run(argv, deps, (line) => lines.push(line));
  return { status, lines };
}

it("the skill audit report is printed after kb-check's own output", async () => {
  const { lines } = await runAudited(cleanTree(), [], withinBudget);
  assert.deepEqual(lines, [
    "kb-check: clean",
    "skill audit:",
    "  NAME   DESC  BODY  VERDICT",
    "  big      10    42  over-budget (body)",
  ]);
});

it("a skill over budget fails --strict and only warns otherwise", async () => {
  const strict = await runAudited(cleanTree(), ["--strict"], overBudget);
  assert.equal(strict.status, 1);
  assert.ok(strict.lines.includes("kb-check: skill audit failed"));
  const warn = await runAudited(cleanTree(), [], overBudget);
  assert.equal(warn.status, 0);
  assert.ok(
    warn.lines.includes(
      "kb-check: skill audit failed (warn mode; --strict fails on it)",
    ),
  );
});

it("skills within budget leave the exit code to the other checks", async () => {
  for (const argv of [[], ["--strict"]]) {
    assert.equal((await runAudited(cleanTree(), argv, withinBudget)).status, 0);
    assert.equal(
      (await runAudited(brokenTree(), argv, withinBudget)).status,
      argv.length ? 1 : 0,
    );
  }
});

it("an audit that fails to run is noted, fails --strict (fail closed) and only warns otherwise", async () => {
  const run1 = (argv: string[]) =>
    runAudited(cleanTree(), argv, () =>
      Promise.reject(new CommandError("spawn failed")),
    );
  const warn = await run1([]);
  assert.equal(warn.status, 0);
  assert.deepEqual(warn.lines, [
    "kb-check: clean",
    "skill audit: not run (spawn failed); run `node skills/bin/harness.mjs skill audit` to see the cause",
    "kb-check: skill audit failed (warn mode; --strict fails on it)",
  ]);
  const strict = await run1(["--strict"]);
  assert.equal(strict.status, 1);
  assert.deepEqual(strict.lines, [
    "kb-check: clean",
    "skill audit: not run (spawn failed); run `node skills/bin/harness.mjs skill audit` to see the cause",
    "kb-check: skill audit failed",
  ]);
});

async function runFlagAudited(
  tree: Tree,
  argv: string[],
  flagAudit: () => Promise<string[]>,
) {
  const lines: string[] = [];
  const status = await run(argv, { ...fakeDeps(tree), flagAudit }, (l) =>
    lines.push(l),
  );
  return { status, lines };
}

it("a flag on without proof is reported as a warning that never fails --strict", async () => {
  const audit = () =>
    Promise.resolve([
      "Flag x is on in local (infra/environments/local/environment.yaml) with no verification outcome.",
    ]);
  for (const argv of [[], ["--strict"]]) {
    const { status, lines } = await runFlagAudited(cleanTree(), argv, audit);
    assert.equal(status, 0, argv.join(" "));
    assert.match(lines.join("\n"), /Flag x is on in local/);
    assert.match(lines.join("\n"), /warn only/);
    assert.doesNotMatch(lines.join("\n"), /kb-check: clean/);
  }
});

it("a flag audit that could not run is one warning line", async () => {
  const { status, lines } = await runFlagAudited(
    cleanTree(),
    ["--strict"],
    () =>
      Promise.resolve([
        "flag audit could not run (spawn failed); run `node skills/bin/harness.mjs flag audit` to see the cause",
      ]),
  );
  assert.equal(status, 0);
  assert.equal(lines.filter((l) => l.includes("could not run")).length, 1);
});

it("a clean flag audit leaves kb-check clean", async () => {
  const { status, lines } = await runFlagAudited(
    cleanTree(),
    ["--strict"],
    () => Promise.resolve([]),
  );
  assert.equal(status, 0);
  assert.deepEqual(lines, ["kb-check: clean"]);
});
