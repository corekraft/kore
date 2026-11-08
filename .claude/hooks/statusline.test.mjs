import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { contextPercent, statusLine } from "../statusline.mjs";

const script = fileURLToPath(new URL("../statusline.mjs", import.meta.url));
const AMBER = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const plan = `# Plan

## Step 8: Earlier

- [ ] Confirm live.

## Step 9: Operator Load

Next: wire the statusline.

- [ ] Statusline.
- [x] Brief.
`;

const plans = () => ({
  "3-agent-harness.md": plan,
  "1-old.md": "- [x] done\n",
});

test("contextPercent prefers the reported percentage and falls back to the current usage", () => {
  assert.equal(
    contextPercent({ context_window: { used_percentage: 41.6 } }),
    42,
  );
  assert.equal(
    contextPercent({
      context_window: {
        context_window_size: 200000,
        current_usage: {
          input_tokens: 50000,
          cache_creation_input_tokens: 10000,
          cache_read_input_tokens: 40000,
        },
      },
    }),
    50,
  );
  assert.equal(contextPercent({}), null);
});

test("statusLine shows context use, the active plan, its Next: step, and open items", () => {
  const line = statusLine(
    { context_window: { used_percentage: 12 } },
    { readPlans: plans },
  );
  assert.equal(line, "ctx 12% · 3-agent-harness · Step 9 · 2 open");
});

test("context use turns amber at 40% and red at 50%, and stays uncolored below", () => {
  const at = (used_percentage) =>
    statusLine(
      { context_window: { used_percentage } },
      { readPlans: () => ({}) },
    );
  assert.equal(at(39), "ctx 39%");
  assert.equal(at(40), `${AMBER}ctx 40%${RESET}`);
  assert.equal(at(50), `${RED}ctx 50%${RESET}`);
});

test("statusLine omits what it cannot know instead of guessing", () => {
  assert.equal(statusLine({}, { readPlans: () => ({}) }), "");
  assert.equal(
    statusLine(
      {},
      { readPlans: () => ({ "2-plan.md": "## Step 1: A\n\n- [ ] open\n" }) },
    ),
    "2-plan · 1 open",
  );
});

test("cli: prints one line from the session JSON and the plans under the project dir", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  writeFileSync(join(root, "infra/plans/3-agent-harness.md"), plan);

  const result = spawnSync("node", [script], {
    input: JSON.stringify({
      workspace: { project_dir: root },
      context_window: { used_percentage: 20 },
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "ctx 20% · 3-agent-harness · Step 9 · 2 open\n");
});

test("cli: malformed input prints nothing and exits cleanly", () => {
  const result = spawnSync("node", [script], {
    input: "not json",
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
