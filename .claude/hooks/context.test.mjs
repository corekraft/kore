import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { activePlan, openItems, restore, rules } from "./context.mjs";

const hook = fileURLToPath(new URL("./context.mjs", import.meta.url));

const agents = `# AGENTS.md

## Platform

- **One owner per resource.** Every resource has exactly one
  desired-state owner.
- **Deploy what was verified.** Images by digest. _Audited: \`image-digest\`._
- **Secrets never touch disk.** Encrypt at rest.
  _Enforced: \`secret-path\`._

## Code

- **Errors are actionable.** Say what's wrong and how to fix it.
`;

const plan = `# Plan

## Step 1: Done

- [x] Finished work.

## Step 2: Open

### Work

- [ ] **Bound output.** Cap hook output
  at 40 lines.
- [x] Done here.

### Exit Criteria

- [ ] A large report is bounded.
`;

test("rules keeps every AGENTS.md rule, joining wrapped lines and keeping enforcement markers", () => {
  assert.deepEqual(rules(agents), [
    "- **One owner per resource.** Every resource has exactly one desired-state owner.",
    "- **Deploy what was verified.** Images by digest. _Audited: `image-digest`._",
    "- **Secrets never touch disk.** Encrypt at rest. _Enforced: `secret-path`._",
    "- **Errors are actionable.** Say what's wrong and how to fix it.",
  ]);
});

test("openItems lists unchecked items with their step and joins wrapped lines", () => {
  assert.deepEqual(openItems(plan), [
    "Step 2: Open: - [ ] **Bound output.** Cap hook output at 40 lines.",
    "Step 2: Open: - [ ] A large report is bounded.",
  ]);
});

test("activePlan picks the highest-numbered plan that still has open items", () => {
  const plans = {
    "1-initialize.md": "## Step 1: A\n\n- [ ] old open item\n",
    "2-implementation.md": "## Step 1: B\n\n- [ ] newer open item\n",
    "3-agent-harness.md": "## Step 1: C\n\n- [x] all done\n",
  };
  assert.equal(activePlan(plans), "2-implementation.md");
  assert.equal(activePlan({ "1-a.md": "- [x] done\n" }), null);
});

test("restore says nothing on a normal session start", () => {
  const deps = {
    readAgents: () => agents,
    readPlans: () => ({ "3-agent-harness.md": plan }),
  };
  assert.equal(restore({ source: "startup" }, deps), "");
  assert.equal(restore({ source: "resume" }, deps), "");
});

test("restore after compaction states the rules and the active plan's open items", () => {
  const deps = {
    readAgents: () => agents,
    readPlans: () => ({ "3-agent-harness.md": plan }),
  };
  const context = restore({ source: "compact" }, deps);
  assert.match(context, /One owner per resource/);
  assert.match(context, /Errors are actionable/);
  assert.match(
    context,
    /Secrets never touch disk\.\*\* Encrypt at rest\. _Enforced/,
  );
  assert.match(context, /infra\/plans\/3-agent-harness\.md/);
  assert.match(context, /Bound output/);
  assert.doesNotMatch(context, /Done here/);
});

test("restore without an active plan still states the rules", () => {
  const deps = { readAgents: () => agents, readPlans: () => ({}) };
  const context = restore({ source: "compact" }, deps);
  assert.match(context, /One owner per resource/);
  assert.doesNotMatch(context, /Open plan items/);
});

test("cli: injects context after compaction and stays silent otherwise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), agents);
  writeFileSync(join(root, "infra/plans/3-agent-harness.md"), plan);
  const run = (call) =>
    spawnSync("node", [hook], {
      input: JSON.stringify(call),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });

  const compacted = run({ hook_event_name: "SessionStart", source: "compact" });
  assert.equal(compacted.status, 0);
  const output = JSON.parse(compacted.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "SessionStart");
  assert.match(output.additionalContext, /One owner per resource/);

  const started = run({ hook_event_name: "SessionStart", source: "startup" });
  assert.equal(started.status, 0);
  assert.equal(started.stdout, "");
});

test("cli: malformed input fails open", () => {
  const result = spawnSync("node", [hook], {
    input: "not json",
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("cli: without a plans directory the rules are still restored", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "AGENTS.md"), agents);
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({ source: "compact" }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.equal(result.status, 0);
  assert.match(
    JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    /One owner per resource/,
  );
});

test("cli: valid JSON that is not an object fails open", () => {
  for (const input of ["null", "42", "[]"]) {
    const result = spawnSync("node", [hook], { input, encoding: "utf8" });
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, "", input);
    assert.equal(result.stderr, "", input);
  }
});

test("cli: without AGENTS.md the hook fails open and prints nothing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({ source: "compact" }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
