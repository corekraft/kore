import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

// The guard as the host runs it: the committed bundle as a real process.
const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "../../../skills/bin/harness.mjs");

// A project directory in the environment would move the guard's root off the payload's cwd.
const { CLAUDE_PROJECT_DIR: _project, ...inherited } = process.env;

const run = (payload: unknown, input = JSON.stringify(payload)) =>
  spawnSync("node", [bundle, "hook", "guard"], {
    input,
    encoding: "utf8",
    env: { ...inherited, KORE_ROOT: "/nonexistent" },
  });

it("cli: exits 2 and explains on stderr when blocking", () => {
  const result = run({
    tool_name: "Bash",
    tool_input: { command: "minikube delete" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /destructive/);
});

it("cli: exits 0 silently when allowing", () => {
  const result = run({
    tool_name: "Bash",
    tool_input: { command: "git status" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

it("cli: warns through additionalContext without blocking", () => {
  const result = run({
    tool_name: "Write",
    cwd: "/repo",
    tool_input: {
      file_path: "/repo/apps/web/d.yaml",
      content: "image: web:1\n",
    },
  });
  assert.equal(result.status, 0);
  assert.match(
    JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    /image-digest/,
  );
});

it("cli: malformed input fails open", () => {
  const result = run(undefined, "not json");
  assert.equal(result.status, 0);
});

const median = (xs: number[]) =>
  [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] as number;
const timeMs = (fn: () => void, runs = 5) =>
  median(
    Array.from({ length: runs }, () => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    }),
  );

it("cli: the guard adds at most 150 ms to the bare node startup", () => {
  // Measured against the same node binary, so a slow or loaded machine
  // raises the baseline instead of failing the guard's own budget.
  const baseline = timeMs(() => spawnSync("node", ["-e", "0"]));
  const guard = timeMs(() =>
    run({ tool_name: "Bash", tool_input: { command: "git status" } }),
  );
  assert.ok(
    guard <= baseline + 150,
    `guard median ${guard.toFixed(0)} ms exceeds node baseline ${baseline.toFixed(0)} ms + 150 ms`,
  );
}, 15_000);
