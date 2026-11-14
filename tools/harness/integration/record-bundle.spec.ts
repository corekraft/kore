import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it } from "vitest";
import { cleanGitEnv } from "../src/testing/index.js";

// The session recorder as the host runs it: the built bundle as a real
// process, with the ledger under a project that has no infra/plans.
const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "../../../skills/bin/harness.mjs");

const { CLAUDE_PROJECT_DIR: _project, ...inherited } = cleanGitEnv();

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function record(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "kore-record-"));
  temps.push(dir);
  const result = spawnSync(
    "node",
    [bundle, "hook", "record", "session-start"],
    {
      input: JSON.stringify({ session_id: "s1", source }),
      encoding: "utf8",
      cwd: dir,
      env: { ...inherited, KORE_ROOT: dir, HERDR_PANE_ID: "w9:p9" },
    },
  );
  const file = join(dir, ".kore/state/ledger.jsonl");
  const events = existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
  return { result, events };
}

it("cli: a startup records a session start, with session and pane, before it exits", () => {
  const { result, events } = record("startup");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(
    events.map((e) => [e["kind"], e["session"], e["pane"]]),
    [["session.start", "s1", "w9:p9"]],
  );
});

it("cli: a compaction records nothing and exits quietly", () => {
  const { result, events } = record("compact");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(events, []);
});
