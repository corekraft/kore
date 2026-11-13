import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it } from "vitest";
import { cleanGitEnv } from "../src/testing/git-env.js";

// The status line as the host runs it: the built bundle as a real process,
// in projects that are not this repository.
const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "../../../skills/bin/harness.mjs");

// A project directory in the environment would move the status line off the host's workspace.
const { CLAUDE_PROJECT_DIR: _project, ...inherited } = cleanGitEnv();

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const plan = `## Step 9: Operator Load

Next: wire the statusline.

- [ ] Statusline.
- [x] Brief.
`;

function project(withPlans: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "kore-status-"));
  temps.push(root);
  if (withPlans) {
    mkdirSync(join(root, "infra/plans"), { recursive: true });
    writeFileSync(join(root, "infra/plans/3-agent-harness.md"), plan);
  }
  return root;
}

const run = (input: string, env: Record<string, string> = {}) =>
  spawnSync("node", [bundle, "hook", "statusline"], {
    input,
    encoding: "utf8",
    env: { ...inherited, ...env },
  });

const session = (extra: object) =>
  JSON.stringify({ context_window: { used_percentage: 20 }, ...extra });

it("cli: reads the plans under the host's workspace.project_dir", () => {
  const result = run(session({ workspace: { project_dir: project(true) } }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "ctx 20% · 3-agent-harness · Step 9 · 1 open\n");
  assert.equal(result.stderr, "");
});

it("cli: CLAUDE_PROJECT_DIR wins over the workspace, and cwd is the last resort", () => {
  const withPlans = project(true);
  const without = project(false);
  assert.match(
    run(session({ workspace: { project_dir: without } }), {
      CLAUDE_PROJECT_DIR: withPlans,
    }).stdout,
    /3-agent-harness/,
  );
  assert.match(run(session({ cwd: withPlans })).stdout, /3-agent-harness/);
});

it("cli: a project without infra/plans still shows context use, quietly", () => {
  for (const env of [{}, { CLAUDE_PROJECT_DIR: project(false) }]) {
    const result = run(
      session({ workspace: { project_dir: project(false) } }),
      env,
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "ctx 20%\n");
    assert.equal(result.stderr, "");
  }
});

it("cli: malformed input prints nothing and exits cleanly", () => {
  const result = run("not json");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
