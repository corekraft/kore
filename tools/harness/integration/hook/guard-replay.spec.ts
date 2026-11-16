// `guardrail replay` run as the built bundle runs it, on a fixture repository. The fixture holds a
// copy of the harness sources, two commits of the inventory (the rule enforced, then in audit), and
// the built bundle. Each ref's guard is built in a worktree the replay makes and removes.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../../src/testing/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(here, "../..");
const builtBundle = resolve(harnessRoot, "../../skills/bin/harness.mjs");
const RULE = "unquoted-glob";
const ENFORCED = JSON.stringify({
  guardrails: [
    {
      rule: RULE,
      kind: "bash",
      mode: "enforce",
      owner: "tools/harness/src/hook/guard-bash.ts",
    },
  ],
});
const AUDITED = ENFORCED.replace('"mode":"enforce"', '"mode":"audit"');
const KNOWN_BAD = "ls *(e:'touch p':)";

let repo = "";
let home = "";
let enforced = "";
let audited = "";

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

/** Commits everything in the fixture and returns the commit's sha. */
function commit(message: string): string {
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

/** One session's transcript in HOME: a known-bad command and an ordinary one, both in the window. */
function writeTranscript(): void {
  const dir = join(home, ".claude", "projects", "fixture");
  mkdirSync(dir, { recursive: true });
  const at = (line: number, command: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-15T10:00:00.000Z",
      cwd: repo,
      line,
      message: {
        content: [
          {
            type: "tool_use",
            id: `t${line}`,
            name: "Bash",
            input: { command },
          },
        ],
      },
    });
  writeFileSync(
    join(dir, "s1.jsonl"),
    `${at(1, KNOWN_BAD)}\n${at(2, "ls -la")}\n`,
  );
}

/** Runs the replay from the fixture's own bundle, and returns its JSON report. */
function replay(old: string, next: string): Record<string, unknown> {
  const out = execFileSync(
    process.execPath,
    [
      join(repo, "skills", "bin", "harness.mjs"),
      "guardrail",
      "replay",
      "--rule",
      RULE,
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
  // The harness sources, as the fixture's own checkout of the harness.
  cpSync(join(harnessRoot, "src"), join(repo, "tools", "harness", "src"), {
    recursive: true,
  });
  cpSync(
    join(harnessRoot, "build.mjs"),
    join(repo, "tools", "harness", "build.mjs"),
  );
  cpSync(
    join(harnessRoot, "package.json"),
    join(repo, "tools", "harness", "package.json"),
  );
  mkdirSync(join(repo, "infra", "plans"), { recursive: true });
  writeFileSync(join(repo, "infra", "plans", "fixture.md"), "# Fixture\n");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "guardrails.yaml"), ENFORCED);
  enforced = commit("the rule is enforced");
  writeFileSync(join(repo, ".claude", "guardrails.yaml"), AUDITED);
  audited = commit("the rule moves to audit");
  // Untracked, as in a real checkout: the built bundle that runs the replay, and the installed
  // dependencies the worktrees' builds link to.
  mkdirSync(join(repo, "skills", "bin"), { recursive: true });
  cpSync(builtBundle, join(repo, "skills", "bin", "harness.mjs"));
  symlinkSync(
    join(harnessRoot, "node_modules"),
    join(repo, "tools", "harness", "node_modules"),
  );
  writeTranscript();
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("guardrail replay, through the bundle, against the fixture's guard at two refs", () => {
  it("lists the command the enforced guard refused and the audited guard allows, and nothing else", () => {
    const report = replay(enforced, audited);

    expect(report).toMatchObject({
      old: enforced,
      new: audited,
      rule: RULE,
      examined: 2,
      empty: false,
      changed: [
        {
          session: "s1",
          line: 1,
          at: "2026-11-15T10:00:00.000Z",
          tool: "Bash",
          command: KNOWN_BAD,
        },
      ],
    });
  });

  it("never lists a command the old guard allowed, and says so as empty", () => {
    expect(replay(audited, enforced)).toMatchObject({
      examined: 2,
      empty: true,
      changed: [],
    });
  });

  it("leaves no worktree, no inventory change and no dependency link removed", () => {
    replay(enforced, audited);

    expect(
      git("worktree", "list", "--porcelain")
        .split("\n")
        .filter((l) => l.startsWith("worktree ")),
    ).toEqual([`worktree ${repo}`]);
    expect(readdirSync(join(repo, ".claude", "worktrees"))).toEqual([]);
    expect(readFileSync(join(repo, ".claude", "guardrails.yaml"), "utf8")).toBe(
      AUDITED,
    );
    expect(existsSync(join(repo, "tools", "harness", "node_modules"))).toBe(
      true,
    );
  });
});
