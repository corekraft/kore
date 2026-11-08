// Skill links: `skills/` is the single source, linked into each harness
// directory by a relative path so the links resolve in any clone.
// Plan: infra/plans/3-agent-harness.md (Step 9).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { linkProblems } from "./skill-links.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kore-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [
    "skills/tdd",
    "skills/adr",
    ".claude/skills",
    ".codex/skills",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

test("every skill in the repository is linked by a relative path from every harness", () => {
  assert.deepEqual(linkProblems(repo), []);
});

test("a skill linked by an absolute path is reported with the fix", (t) => {
  const root = fixture(t);
  for (const harness of [".claude", ".codex"]) {
    symlinkSync("../../skills/tdd", join(root, harness, "skills/tdd"));
    symlinkSync("../../skills/adr", join(root, harness, "skills/adr"));
  }
  rmSync(join(root, ".codex/skills/adr"));
  symlinkSync(join(root, "skills/adr"), join(root, ".codex/skills/adr"));

  assert.deepEqual(linkProblems(root), [
    ".codex/skills/adr links to an absolute path; relink it to ../../skills/adr",
  ]);
});

test("a skill missing from a harness is reported, and a complete harness is not", (t) => {
  const root = fixture(t);
  symlinkSync("../../skills/tdd", join(root, ".claude/skills/tdd"));
  symlinkSync("../../skills/adr", join(root, ".claude/skills/adr"));
  symlinkSync("../../skills/tdd", join(root, ".codex/skills/tdd"));

  assert.deepEqual(linkProblems(root), [
    ".codex/skills/adr is missing; link it to ../../skills/adr",
  ]);
});

test("a link to the wrong skill is reported", (t) => {
  const root = fixture(t);
  for (const harness of [".claude", ".codex"]) {
    symlinkSync("../../skills/tdd", join(root, harness, "skills/tdd"));
  }
  symlinkSync("../../skills/adr", join(root, ".claude/skills/adr"));
  symlinkSync("../../skills/tdd", join(root, ".codex/skills/adr"));

  assert.deepEqual(linkProblems(root), [
    ".codex/skills/adr links to ../../skills/tdd; relink it to ../../skills/adr",
  ]);
});

test("a copied skill directory in place of a link is reported as not a link", (t) => {
  const root = fixture(t);
  for (const harness of [".claude", ".codex"]) {
    symlinkSync("../../skills/tdd", join(root, harness, "skills/tdd"));
  }
  symlinkSync("../../skills/adr", join(root, ".claude/skills/adr"));
  cpSync(join(root, "skills/adr"), join(root, ".codex/skills/adr"), {
    recursive: true,
  });

  assert.deepEqual(linkProblems(root), [
    ".codex/skills/adr is a directory or file, not a link; replace it with a link to ../../skills/adr",
  ]);
});
