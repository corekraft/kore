import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, it } from "vitest";
import { cleanGitEnv } from "../src/testing/git-env.js";

// The guard as the host runs it: the committed bundle as a real process.
const here = dirname(fileURLToPath(import.meta.url));
const checkout = resolve(here, "../../..");
const bundle = resolve(checkout, "skills/bin/harness.mjs");

// A project directory in the environment would move the guard's root off the payload's cwd.
const { CLAUDE_PROJECT_DIR: _project, ...inherited } = cleanGitEnv();

const run = (payload: unknown, input = JSON.stringify(payload)) =>
  spawnSync("node", [bundle, "hook", "guard"], {
    input,
    encoding: "utf8",
    env: { ...inherited, KORE_ROOT: "/nonexistent" },
  });

it("cli: exits 2 and explains on stderr when blocking", () => {
  const result = run({
    tool_name: "Bash",
    tool_input: { command: "k3d cluster delete kore-local" },
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
    cwd: checkout,
    tool_input: {
      file_path: `${checkout}/apps/web/d.yaml`,
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
const elapsed = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

/** Median time of each function, sampled in turn so they all see the same host load. */
const timeInTurns = (fns: (() => void)[], rounds = 9): number[] => {
  const samples = fns.map((): number[] => []);
  for (let round = 0; round < rounds; round++) {
    fns.forEach((fn, i) => samples[i]?.push(elapsed(fn)));
  }
  return samples.map(median);
};

// The real path: a session id, no KORE_ROOT, so each recording asks git for the
// main checkout's root, as the host's hook does. The ledger lands in a temporary repository.
const project = mkdtempSync(join(tmpdir(), "guard-timing-"));
afterAll(() => rmSync(project, { recursive: true, force: true }));

const runRecording = (payload: unknown) => {
  const { KORE_ROOT: _root, ...env } = inherited;
  return spawnSync("node", [bundle, "hook", "guard"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...env, CLAUDE_PROJECT_DIR: project },
  });
};

it("cli: the guard adds at most 150 ms to the bare node startup, recording its events", () => {
  mkdirSync(join(project, "infra", "plans"), { recursive: true });
  execFileSync("git", ["-C", project, "init", "-q"], {
    env: cleanGitEnv(),
  });
  // Measured against the same node binary, sampled in turn with it, so a slow
  // or loaded machine raises the baseline instead of failing the guard's own budget.
  const call = (command: string) => ({
    session_id: "timing",
    tool_name: "Bash",
    tool_input: { command },
  });
  const [baseline = 0, allowed = 0, blocked = 0] = timeInTurns([
    () => spawnSync("node", ["-e", "0"]),
    () => runRecording(call("git status")),
    () => runRecording(call("k3d cluster delete kore-local")),
  ]);
  for (const [path, ms] of [
    ["an allowed call", allowed],
    ["a blocked call", blocked],
  ] as const) {
    assert.ok(
      ms <= baseline + 150,
      `${path}: guard median ${ms.toFixed(0)} ms exceeds node baseline ${baseline.toFixed(0)} ms + 150 ms`,
    );
  }
}, 30_000);
