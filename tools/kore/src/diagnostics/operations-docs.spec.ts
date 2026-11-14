import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { usage } from "../cli/index.js";

// Docs: docs/guides/operator.md
// Operations pages name only `kore` commands, flags, and repository paths that
// exist today. A step with no command is marked as a gap, never invented.

const root = new URL("../../../../", import.meta.url);

const pages = [
  "docs/operations/support-and-upgrades.md",
  "docs/operations/registry.md",
  "docs/operations/signing-and-keys.md",
  "docs/operations/trust-and-rotation.md",
  "docs/operations/policy-changes.md",
  "docs/operations/resource-budgets.md",
  "docs/guides/operator.md",
  "docs/guides/contributor.md",
  "docs/guides/troubleshooting.md",
  "docs/guides/application-onboarding.md",
];

const read = (path: string): string =>
  readFileSync(new URL(path, root), "utf8");

/** Build outputs are git-ignored and absent until built; no other missing path is excused. */
const buildOutputs = new Set(["skills/bin/harness.mjs"]);
const isBuildOutput = (path: string): boolean => buildOutputs.has(path);

/** Text inside fenced blocks and inline code spans. */
function codeText(markdown: string): string[] {
  const fenced = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    (m) => m[1] ?? "",
  );
  const inline = [
    ...markdown.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g),
  ].map((m) => m[1] ?? "");
  return [...fenced, ...inline].flatMap((block) => block.split("\n"));
}

const usageLines = usage.split("\n").filter((l) => l.startsWith("  kore "));
const topLevel = new Set(usageLines.map((l) => l.trim().split(/\s+/)[1]));

test("every operations page exists and is listed in the knowledge index", () => {
  const index = read("docs/index.md");
  for (const page of pages) {
    assert.ok(existsSync(new URL(page, root)), `${page} is missing`);
    assert.ok(index.includes(`](${page.slice(5)})`), `${page} not in index`);
  }
});

test("every kore command and subcommand the pages name appears in the usage text", () => {
  const problems: string[] = [];
  for (const page of pages) {
    for (const line of codeText(read(page))) {
      const match = /(?:^|[\s`])kore ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/.exec(
        line,
      );
      if (
        !match ||
        line.includes("kore.dev") ||
        match[1]!.startsWith("kore-")
      ) {
        continue;
      }
      const [, command, action] = match;
      if (!topLevel.has(command)) {
        problems.push(`${page}: unknown command "kore ${command}"`);
        continue;
      }
      const known = usageLines.filter((l) => l.includes(`kore ${command} `));
      if (
        action &&
        !known.some((l) => new RegExp(`\\b${action}\\b`).test(l)) &&
        /^[a-z-]+$/.test(action) &&
        !line.includes(`kore ${command} --`)
      ) {
        problems.push(`${page}: unknown "kore ${command} ${action}"`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every flag on a kore command line appears in the usage text", () => {
  const problems: string[] = [];
  for (const page of pages) {
    for (const line of codeText(read(page))) {
      if (!/\bkore (?:[a-z]+ )/.test(line)) {
        continue;
      }
      for (const [flag] of line.matchAll(/--[a-z][a-z-]*/g)) {
        if (flag !== "--prefix" && !usage.includes(flag)) {
          problems.push(`${page}: unknown flag ${flag} in "${line.trim()}"`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every repository path the pages name exists", () => {
  const problems: string[] = [];
  const path = /^(?:infra|docs|tools|\.github|\.claude|skills|apps)\/[\w./-]+$/;
  for (const page of pages) {
    const text = read(page);
    for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
      if (
        span &&
        path.test(span) &&
        !existsSync(new URL(span, root)) &&
        !isBuildOutput(span)
      ) {
        problems.push(`${page}: ${span} does not exist`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("a gap is marked in bold, so a missing command is never silently invented", () => {
  const withGaps = pages.filter((page) => /\*\*Gap:\*\*/.test(read(page)));
  assert.ok(withGaps.length >= 4, `only ${withGaps.length} pages mark a gap`);
  for (const page of pages) {
    assert.ok(
      !/\bkore (?:registry|secrets|trust) (?:backup|gc|rotate-keys|rotate-ca|restore)\b/.test(
        read(page).replace(/\*\*Gap:\*\*[^\n]*/g, ""),
      ),
      `${page} names a command that does not exist outside a Gap note`,
    );
  }
});

const mutatingVerb =
  "delete|apply|edit|patch|rollout|scale|replace|create|annotate|label|uninstall|upgrade|rollback|install|cordon|drain|restart|updatekeys";
const manualMutation = new RegExp(
  `\\bkubectl(?:\\s+--?[\\w-]+(?:[ =][^\\s-]\\S*)?)*\\s+(?:${mutatingVerb})\\b` +
    `|\\bhelm\\s+(?:${mutatingVerb})\\b|\\bsops\\s+updatekeys\\b` +
    `|\\bmkcert\\s+-(?:un)?install\\b` +
    `|\\bdelet(?:e|ing) (?:the|both|all) (?:\\S+ ){0,3}Secrets?\\b`,
  "i",
);

/** Blocks (blank-line or list-item separated) that tell a reader to mutate by hand but
 * carry no plan-referenced Gap marker. Read-only `kubectl get` is not a
 * mutation. */
function unmarkedManualSteps(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.) )/)
    .filter((block) => !block.trimStart().startsWith("|"))
    .map((block) => block.replace(/\s+/g, " "))
    .filter((block) => manualMutation.test(block))
    .filter((block) => !/\*\*Gap:\*\*[^]*\bplan Step \d+/.test(block));
}

const hiddenRemediationPages = [
  ...pages,
  "docs/operations/backups.md",
  "docs/release-signer-controls.md",
  "README.md",
];

test("a manual kubectl, helm, sops, or mkcert mutation is never hidden: it sits beside a Gap that names its plan step", () => {
  const problems = hiddenRemediationPages.flatMap((page) =>
    unmarkedManualSteps(read(page)).map((b) => `${page}: ${b.slice(0, 120)}`),
  );
  assert.deepEqual(problems, []);
});

test("the hidden-remediation check flags an unmarked mutation and accepts read-only and marked steps", () => {
  assert.equal(
    unmarkedManualSteps("Run `kubectl delete pod x` to recover.").length,
    1,
  );
  assert.equal(
    unmarkedManualSteps("Delete the `x` Secret and rerun.").length,
    1,
  );
  assert.equal(
    unmarkedManualSteps(
      "2. For a quicker cut-off, `kubectl --context kore-local --namespace <ns> delete\nserviceaccount <name>` first.\n3. Review.",
    ).length,
    1,
  );
  assert.equal(
    unmarkedManualSteps("Read it with `kubectl get pvc`.").length,
    0,
  );
  assert.equal(
    unmarkedManualSteps(
      "`kubectl rollout restart x`. **Gap:** no command (plan Step 15).",
    ).length,
    0,
  );
  assert.equal(
    unmarkedManualSteps("`kubectl rollout restart x`. **Gap:** no command.")
      .length,
    1,
  );
});

test("the budget page states the warning threshold the status check uses", async () => {
  const { capacityWarningPercent } = await import("../platform/index.js");
  assert.match(
    read("docs/operations/resource-budgets.md"),
    new RegExp(`${capacityWarningPercent}%`),
  );
});
