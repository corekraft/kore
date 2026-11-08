import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  activePlan,
  activePlans,
  brief,
  lastRetrospective,
  nextStep,
  openItems,
  restore,
  rules,
  upcomingSteps,
} from "./context.mjs";

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

test("restore says nothing when a session resumes, since its context is intact", () => {
  const deps = {
    readAgents: () => agents,
    readPlans: () => ({ "3-agent-harness.md": plan }),
    sessionsSince: () => 9,
  };
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

test("cli: injects context after compaction and stays silent on resume", (t) => {
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

  const resumed = run({ hook_event_name: "SessionStart", source: "resume" });
  assert.equal(resumed.status, 0);
  assert.equal(resumed.stdout, "");
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

const handedOff = `# Plan

## Step 8: Earlier

- [ ] Confirm live.

## Step 9: Operator Load

Next: write the statusline tests, then
wire it into settings.

### Work

- [x] Brief.
- [ ] Statusline.

## Results

- Last retrospective: 2026-11-01
`;

test("nextStep returns the plan's Next: line with its step, joining wrapped lines", () => {
  assert.deepEqual(nextStep(handedOff), {
    step: "Step 9: Operator Load",
    text: "write the statusline tests, then wire it into settings.",
  });
  assert.equal(nextStep(plan), null);
});

test("lastRetrospective returns the latest marker across plans, or null", () => {
  assert.equal(
    lastRetrospective({
      "2-a.md": "Last retrospective: 2026-10-01\n",
      "3-b.md": handedOff,
    }),
    "2026-11-01",
  );
  assert.equal(lastRetrospective({ "3-b.md": plan }), null);
});

function briefDeps(sessions) {
  const calls = [];
  return {
    calls,
    readAgents: () => agents,
    readPlans: () => ({ "3-agent-harness.md": handedOff }),
    sessionsSince: (date, current) => {
      calls.push([date, current]);
      return sessions;
    },
  };
}

test("brief names the active plan, its open items per step, and the Next: line", () => {
  const context = brief({ source: "startup", session_id: "s1" }, briefDeps(0));
  assert.equal(
    context,
    [
      "Session brief from infra/plans/3-agent-harness.md:",
      "Open items: Step 8 (1), Step 9 (1).",
      "Next (Step 9: Operator Load): write the statusline tests, then wire it into settings.",
    ].join("\n"),
  );
});

test("brief reminds about a retrospective only once five sessions have passed since the marker", () => {
  const due = briefDeps(5);
  assert.match(
    brief({ source: "clear", session_id: "s1" }, due),
    /5 sessions since the last retrospective \(2026-11-01\); run \/retro\./,
  );
  assert.deepEqual(due.calls, [["2026-11-01", "s1"]]);
  assert.doesNotMatch(brief({ source: "clear" }, briefDeps(4)), /retro/);
});

test("brief without a marker counts every session as since the last retrospective", () => {
  const deps = {
    ...briefDeps(5),
    readPlans: () => ({ "3-agent-harness.md": plan }),
  };
  assert.match(
    brief({ source: "startup" }, deps),
    /5 sessions without a recorded retrospective; run \/retro\./,
  );
});

test("brief never restates the AGENTS.md rules, which a fresh session already loads", () => {
  const context = restore({ source: "startup" }, briefDeps(0));
  assert.match(context, /Session brief/);
  assert.doesNotMatch(context, /One owner per resource/);
});

test("brief is empty with no open plan and no retrospective due", () => {
  const deps = { ...briefDeps(0), readPlans: () => ({}) };
  assert.equal(restore({ source: "startup" }, deps), "");
  assert.equal(restore({ source: "clear" }, deps), "");
});

test("cli: a fresh session counts earlier transcripts but not its own", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-context-"));
  const config = mkdtempSync(join(tmpdir(), "kore-config-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), agents);
  writeFileSync(join(root, "infra/plans/3-agent-harness.md"), plan);
  const transcripts = join(
    config,
    "projects",
    root.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  mkdirSync(transcripts, { recursive: true });
  for (const id of ["a", "b", "c", "d", "e", "current"]) {
    writeFileSync(join(transcripts, `${id}.jsonl`), "{}\n");
  }
  writeFileSync(join(transcripts, "notes.txt"), "");

  const run = (sessionId) =>
    spawnSync("node", [hook], {
      input: JSON.stringify({ source: "startup", session_id: sessionId }),
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_CONFIG_DIR: config,
      },
    });
  const context = JSON.parse(run("current").stdout).hookSpecificOutput
    .additionalContext;
  assert.match(context, /Session brief from infra\/plans\/3-agent-harness\.md/);
  assert.match(context, /5 sessions without a recorded retrospective/);

  rmSync(join(transcripts, "e.jsonl"));
  assert.doesNotMatch(run("current").stdout, /retro/);
});

test("cli: sessions from the day of the last retrospective do not count toward the next one", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-context-"));
  const config = mkdtempSync(join(tmpdir(), "kore-config-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), agents);
  const today = new Date().toLocaleDateString("sv"); // local YYYY-MM-DD
  writeFileSync(
    join(root, "infra/plans/3-agent-harness.md"),
    `${plan}\nLast retrospective: ${today}\n`,
  );
  const transcripts = join(
    config,
    "projects",
    root.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  mkdirSync(transcripts, { recursive: true });
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    writeFileSync(join(transcripts, `${id}.jsonl`), "{}\n");
  }
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({ source: "startup", session_id: "current" }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CONFIG_DIR: config,
    },
  });
  assert.doesNotMatch(result.stdout, /retro/);
});

const fourSteps = `# Plan

## Step 1: Done

- [x] Finished.

## Step 2: Current

- [ ] Now.

## Step 3: Third

- [ ] Later.

## Step 4: Closed

- [x] Already done.

## Step 5: Fifth

- [ ] Later still.

## Step 6: Sixth

- [ ] Much later.

## Step 7: Seventh

- [ ] Beyond the horizon.
`;

test("upcomingSteps lists the next three open steps after the current one, skipping finished steps", () => {
  assert.deepEqual(upcomingSteps(fourSteps), [
    "Step 3: Third",
    "Step 5: Fifth",
    "Step 6: Sixth",
  ]);
});

test("upcomingSteps counts from the step holding the Next: line", () => {
  assert.deepEqual(upcomingSteps(handedOff), []);
  const nextInStep3 = fourSteps.replace(
    "- [ ] Later.",
    "Next: pick up here.\n\n- [ ] Later.",
  );
  assert.deepEqual(upcomingSteps(nextInStep3), [
    "Step 5: Fifth",
    "Step 6: Sixth",
    "Step 7: Seventh",
  ]);
});

test("upcomingSteps is empty when the current step is the last open one", () => {
  assert.deepEqual(upcomingSteps(plan), []);
});

test("brief lists upcoming step titles, and none after the last step", () => {
  const deps = (markdown) => ({
    ...briefDeps(0),
    readPlans: () => ({ "4-knowledge.md": markdown }),
  });
  assert.match(
    brief({ source: "startup" }, deps(fourSteps)),
    /^Upcoming: Step 3: Third; Step 5: Fifth; Step 6: Sixth\.$/m,
  );
  assert.doesNotMatch(brief({ source: "startup" }, deps(plan)), /Upcoming/);
});

const frontmatter = (status) =>
  `---\nstatus: ${status}\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n`;

test("activePlans covers every plan whose frontmatter is active, newest first, and never a done one", () => {
  const plans = {
    "1-initialize.md": `${frontmatter("done")}## Step 1: A\n\n- [ ] stale box\n`,
    "2-implementation.md": `${frontmatter("active")}## Step 9: B\n\n- [ ] open\n`,
    "3-agent-harness.md": `${frontmatter("done")}## Step 1: C\n\n- [x] done\n`,
    "4-knowledge.md": `${frontmatter("active")}## Step 1: D\n\n- [ ] open\n`,
  };
  assert.deepEqual(activePlans(plans), [
    "4-knowledge.md",
    "2-implementation.md",
  ]);
});

test("activePlans keeps the open-item rule for plans without frontmatter", () => {
  const plans = {
    "1-old.md": "## Step 1: A\n\n- [ ] open\n",
    "2-older.md": "## Step 1: B\n\n- [ ] open\n",
    "3-closed.md": "## Step 1: C\n\n- [x] done\n",
    "4-new.md": `${frontmatter("active")}## Step 1: D\n\n- [ ] open\n`,
  };
  assert.deepEqual(activePlans(plans), ["4-new.md", "2-older.md"]);
  assert.deepEqual(activePlans({ "1-a.md": "- [x] done\n" }), []);
});

test("brief and compaction context cover every active plan", () => {
  const plans = {
    "2-implementation.md": `${frontmatter("active")}## Step 9: Workload\n\n- [ ] Sign images.\n`,
    "3-agent-harness.md": `${frontmatter("done")}## Step 1: Hooks\n\n- [ ] Stale box.\n`,
    "4-knowledge.md": `${frontmatter("active")}## Step 1: ADRs\n\n- [ ] Extract decisions.\n`,
  };
  const deps = { ...briefDeps(0), readPlans: () => plans };
  const fresh = brief({ source: "startup" }, deps);
  assert.match(fresh, /Session brief from infra\/plans\/4-knowledge\.md/);
  assert.match(fresh, /Session brief from infra\/plans\/2-implementation\.md/);
  assert.doesNotMatch(fresh, /3-agent-harness/);
  const compacted = restore({ source: "compact" }, deps);
  assert.match(
    compacted,
    /Open plan items in infra\/plans\/4-knowledge\.md:\n.*Extract decisions/,
  );
  assert.match(
    compacted,
    /Open plan items in infra\/plans\/2-implementation\.md:\n.*Sign images/,
  );
  assert.doesNotMatch(compacted, /Stale box/);
});
