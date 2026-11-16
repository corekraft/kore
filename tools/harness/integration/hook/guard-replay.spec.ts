// `guardrail replay` run as the built bundle runs it: the guard at each of two git refs is read
// through git and loaded by Node's module hooks, and the window's transcript is read from HOME.
// The fixture repository's guard uses only syntax Node's strip-only mode accepts.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../../src/testing/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "../../../../skills/bin/harness.mjs");
const GUARD = "tools/harness/src/hook/guard-evaluate.ts";
const BUNDLE_IN_REPO = "skills/bin/harness.mjs";
const INVENTORY = JSON.stringify({
  guardrails: [
    {
      rule: "unquoted-glob",
      kind: "bash",
      mode: "enforce",
      owner: GUARD,
    },
  ],
});
// The guard as it was: a glob in a command is refused.
const REFUSING = `export function evaluate(payload: { tool_input?: { command?: string } }) {
  const command = payload.tool_input?.command ?? "";
  return command.includes("*")
    ? { action: "block", rule: "unquoted-glob", message: "[guard:unquoted-glob] no globs" }
    : { action: "allow" };
}
`;
// The guard after the change: every command is allowed.
const ALLOWING = `export function evaluate() {
  return { action: "allow" };
}
`;

let repo = "";
let home = "";
let refused = "";
let allowed = "";

function git(...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=replay",
      "-c",
      "user.email=replay@example.invalid",
      ...args,
    ],
    { cwd: repo, encoding: "utf8", env: cleanGitEnv() },
  ).trim();
}

/** Commits the guard source at GUARD and returns the commit's sha. */
function commitGuard(source: string, message: string): string {
  mkdirSync(join(repo, dirname(GUARD)), { recursive: true });
  writeFileSync(join(repo, GUARD), source);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

/** One session's transcript, placed in HOME where the replay looks for it. */
function writeTranscript(command: string): void {
  const dir = join(home, ".claude", "projects", "fixture");
  mkdirSync(dir, { recursive: true });
  const event = {
    type: "assistant",
    timestamp: "2026-11-15T10:00:00.000Z",
    cwd: repo,
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command } },
      ],
    },
  };
  writeFileSync(join(dir, "s1.jsonl"), `${JSON.stringify(event)}\n`);
}

function replay(old: string, next: string): Record<string, unknown> {
  const out = execFileSync(
    process.execPath,
    [
      join(repo, BUNDLE_IN_REPO),
      "guardrail",
      "replay",
      "--rule",
      "unquoted-glob",
      "--old",
      old,
      "--new",
      next,
      "--since",
      "2026-11-15T00:00:00Z",
    ],
    {
      cwd: repo,
      env: { PATH: process.env["PATH"] ?? "", HOME: home },
      encoding: "utf8",
    },
  );
  return JSON.parse(out) as Record<string, unknown>;
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "replay-repo-")));
  home = mkdtempSync(join(tmpdir(), "replay-home-"));
  git("init", "-q");
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude", "guardrails.yaml"), INVENTORY);
  // The bundle takes its root from the repository that holds infra/plans.
  mkdirSync(join(repo, "infra", "plans"), { recursive: true });
  writeFileSync(join(repo, "infra", "plans", "fixture.md"), "# Fixture\n");
  refused = commitGuard(REFUSING, "guard refuses globs");
  allowed = commitGuard(ALLOWING, "guard allows everything");
  // The bundle finds its checkout from its own place, so it runs from a copy inside the fixture.
  mkdirSync(join(repo, dirname(BUNDLE_IN_REPO)), { recursive: true });
  copyFileSync(bundle, join(repo, BUNDLE_IN_REPO));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("guardrail replay, through the bundle, against a fixture guard", () => {
  it("lists a call the old guard refused and the new guard allows, with both commits", () => {
    writeTranscript("ls *.ts");

    const report = replay(refused, allowed);

    expect(report).toMatchObject({
      old: refused,
      new: allowed,
      rule: "unquoted-glob",
      examined: 1,
      empty: false,
      changed: [
        {
          session: "s1",
          line: 1,
          at: "2026-11-15T10:00:00.000Z",
          tool: "Bash",
          command: "ls *.ts",
        },
      ],
    });
  });

  it("never lists a call the old guard allowed, and says so as empty", () => {
    writeTranscript("ls *.ts");

    const report = replay(allowed, refused);

    expect(report).toMatchObject({ examined: 1, empty: true, changed: [] });
  });
});
