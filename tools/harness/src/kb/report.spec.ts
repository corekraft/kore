// The report: warn and --strict exit codes, the skill audit and the flag audit.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

import assert from "node:assert/strict";
import { it } from "vitest";
import { run } from "./index.js";
import { cleanTree, fakeDeps, type Tree } from "./kb-support.js";

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

// Skill audit: kb-check prints the bundled audit's report, never fails on it.
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

const auditReport = [
  "NAME   DESC  BODY  VERDICT",
  "big      10    42  over-budget (body)",
  "",
].join("\n");

async function runAudited(
  tree: Tree,
  argv: string[],
  audit: () => Promise<string>,
) {
  const lines: string[] = [];
  const deps = { ...fakeDeps(tree), audit };
  const status = await run(argv, deps, (line) => lines.push(line));
  return { status, lines };
}

it("the skill audit report is printed after kb-check's own output", async () => {
  const { lines } = await runAudited(cleanTree(), [], () =>
    Promise.resolve(auditReport),
  );
  assert.deepEqual(lines, [
    "kb-check: clean",
    "skill audit:",
    "  NAME   DESC  BODY  VERDICT",
    "  big      10    42  over-budget (body)",
  ]);
});

it("a skill over budget leaves the exit code unchanged, strict mode included", async () => {
  for (const argv of [[], ["--strict"]]) {
    assert.equal(
      (await runAudited(cleanTree(), argv, () => Promise.resolve(auditReport)))
        .status,
      0,
    );
    assert.equal(
      (await runAudited(brokenTree(), argv, () => Promise.resolve(auditReport)))
        .status,
      argv.length ? 1 : 0,
    );
  }
});

it("an audit that fails to run is noted and does not change the exit code", async () => {
  for (const argv of [[], ["--strict"]]) {
    const { status, lines } = await runAudited(cleanTree(), argv, () => {
      return Promise.reject(new Error("spawn failed"));
    });
    assert.equal(status, 0);
    assert.deepEqual(lines, [
      "kb-check: clean",
      "skill audit: not run (spawn failed)",
    ]);
  }
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
        "flag audit could not run (spawn failed); run `mise run harness-build`",
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
