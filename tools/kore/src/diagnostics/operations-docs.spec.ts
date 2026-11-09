import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { usage } from "../cli/usage.js";

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
      if (span && path.test(span) && !existsSync(new URL(span, root))) {
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

test("the budget page states the warning threshold the status check uses", async () => {
  const { capacityWarningPercent } =
    await import("../platform/capacity-status.js");
  assert.match(
    read("docs/operations/resource-budgets.md"),
    new RegExp(`${capacityWarningPercent}%`),
  );
});
