import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it } from "vitest";
import { cleanGitEnv } from "../src/testing/index.js";

// The session brief as the host runs it: the built bundle as a real process.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context
const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "../../../skills/bin/harness.mjs");

// A project directory in the environment would point the hook at another tree than the one under test.
const { CLAUDE_PROJECT_DIR: _project, ...inherited } = cleanGitEnv();

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "kore-context-bundle-"));
  temps.push(root);
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  writeFileSync(
    join(root, "AGENTS.md"),
    "# AGENTS.md\n\n- **One owner per resource.** Exactly one.\n",
  );
  writeFileSync(
    join(root, "infra/plans/3-plan.md"),
    "## Step 1: Work\n\n- [ ] Build it.\n",
  );
  return root;
}

function run(root: string, input: string) {
  return spawnSync(process.execPath, [bundle, "hook", "context"], {
    input,
    encoding: "utf8",
    env: { ...inherited, CLAUDE_PROJECT_DIR: root, PATH: "" },
  });
}

it("cli: restores the rules after compaction, briefs a fresh session, and stays silent on resume", () => {
  const root = repository();
  const compacted = run(root, JSON.stringify({ source: "compact" }));
  assert.equal(compacted.status, 0, compacted.stderr);
  assert.match(compacted.stdout, /One owner per resource/);
  const fresh = run(
    root,
    JSON.stringify({ source: "startup", session_id: "s" }),
  );
  assert.match(fresh.stdout, /Open items: Step 1 \(1\)/);
  const resumed = run(root, JSON.stringify({ source: "resume" }));
  assert.equal(resumed.status, 0);
  assert.equal(resumed.stdout, "");
});

it("cli: input that is not a JSON object fails open", () => {
  const root = repository();
  for (const input of ["not json", "null", "42", "[]"]) {
    const result = run(root, input);
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, "", input);
    assert.equal(result.stderr, "", input);
  }
});

it("cli: a root without plans exits 1 and names the cause, never a silent pass", () => {
  const root = mkdtempSync(join(tmpdir(), "kore-context-bundle-"));
  temps.push(root);
  const result = run(root, JSON.stringify({ source: "startup" }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[hook:context\] failed: .*infra\/plans/);
});
