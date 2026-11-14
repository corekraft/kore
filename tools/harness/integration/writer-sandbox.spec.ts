import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv } from "../src/testing/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixture,
  removeFixture,
  runSandboxed,
  MARKER,
  type Fixture,
} from "../tests/writer-sandbox-support.js";

// Opt-in, macOS only: these run the real `sandbox-exec` (ADR 0095).
// KORE_SANDBOX_TESTS=1 npx vitest run --config vitest.integration.config.ts integration/writer-sandbox.spec.ts
const enabled =
  process.platform === "darwin" && process.env["KORE_SANDBOX_TESTS"] === "1";

// Home-relative credential files a writer must not read.
const READ_DENIED = [
  ".ssh/id_test",
  ".kube/config",
  ".config/gh/hosts.yml",
  ".aws/credentials",
  ".docker/config.json",
  ".netrc",
  ".npmrc",
  ".config/git/config",
  "Library/Keychains/login.keychain-db",
];

/** One fixture per describe; afterAll tolerates a failed createFixture. */
function useFixture(): () => Fixture {
  let f: Fixture | undefined;
  beforeAll(async () => {
    f = await createFixture();
  });
  afterAll(() => {
    if (f !== undefined) {
      removeFixture(f);
    }
  });
  return () => {
    if (f === undefined) {
      throw new Error("fixture was not created");
    }
    return f;
  };
}

describe.runIf(enabled)("writer sandbox: writes", () => {
  const fx = useFixture();

  it("writes inside its worktree and commits there", () => {
    const { profile, worktree, repo } = fx();
    const run = runSandboxed(profile, worktree, "sh", [
      "-c",
      "echo hi > f.txt && git add f.txt && git -c user.email=t@example.com -c user.name=t commit -q -m 'feat: x'",
    ]);
    expect(run.status, run.stderr).toBe(0);
    const log = execFileSync("git", ["log", "--oneline", "feat/w1"], {
      cwd: repo,
      encoding: "utf8",
      env: cleanGitEnv(),
    });
    expect(log).toContain("feat: x");
  });

  // Each target is writable unsandboxed (the control) and untouched under the sandbox.
  const writeTargets: [string, (x: Fixture) => string][] = [
    ["a file outside the worktree", (x) => join(x.root, "outside.txt")],
    [
      ".git/config of the shared repository",
      (x) => join(x.repo, ".git", "config"),
    ],
    [
      ".git/hooks of the shared repository",
      (x) => join(x.repo, ".git", "hooks", "pre-commit"),
    ],
    [
      "the worktree's own config.worktree",
      (x) => join(x.repo, ".git", "worktrees", "w1", "config.worktree"),
    ],
    [
      ".claude/settings.json in the worktree",
      (x) => join(x.worktree, ".claude", "settings.json"),
    ],
    [
      "the guard launcher .claude/hooks/harness.sh",
      (x) => join(x.worktree, ".claude", "hooks", "harness.sh"),
    ],
    [
      "the harness bundle skills/bin/harness.mjs",
      (x) => join(x.worktree, "skills", "bin", "harness.mjs"),
    ],
  ];
  it.each(writeTargets)("cannot write %s", (_name, pick) => {
    const x = fx();
    const target = pick(x);
    const append = `printf SBX >> ${JSON.stringify(target)}`;
    const before = existsSync(target)
      ? readFileSync(target, "utf8")
      : undefined;
    const control = spawnSync("sh", ["-c", append], { env: cleanGitEnv() });
    expect(control.status, "unsandboxed write is the control").toBe(0);
    writeFileSync(target, before ?? "");
    const run = runSandboxed(x.profile, x.worktree, "sh", ["-c", append]);
    expect(run.status).not.toBe(0);
    expect(readFileSync(target, "utf8")).toBe(before ?? "");
  });
});

describe.runIf(enabled)("writer sandbox: reads and services", () => {
  const fx = useFixture();

  it.each(READ_DENIED)("cannot read ~/%s", (rel) => {
    const x = fx();
    const file = join(x.home, rel);
    expect(execFileSync("cat", [file], { encoding: "utf8" })).toContain(MARKER);
    const run = runSandboxed(x.profile, x.worktree, "cat", [file]);
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain(MARKER);
  });

  it("cannot read a keychain item through the security service", () => {
    const { keychain, profile, worktree } = fx();
    const args = ["find-generic-password", "-s", "kore-sbx", "-w", keychain];
    expect(execFileSync("security", args, { encoding: "utf8" })).toContain(
      MARKER,
    );
    const run = runSandboxed(profile, worktree, "security", args);
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain(MARKER);
  });

  it("cannot message another pane through the herdr socket", async () => {
    const { sock, profile, worktree } = fx();
    const connect = `require("net").connect(${JSON.stringify(sock)}).on("data",d=>{console.log(String(d));process.exit(0)}).on("error",e=>{console.error(e.code);process.exit(3)})`;
    const control = await new Promise<number | null>((res) =>
      spawn(process.execPath, ["-e", connect]).on("close", res),
    );
    expect(control).toBe(0);
    const run = runSandboxed(profile, worktree, process.execPath, [
      "-e",
      connect,
    ]);
    expect(run.status).toBe(3);
    expect(run.stdout).not.toContain("pong");
  });
});
