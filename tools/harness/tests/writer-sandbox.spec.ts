import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixture,
  removeFixture,
  runSandboxed,
  type Fixture,
} from "./writer-sandbox-support.js";

// Opt-in, macOS only: these run the real `sandbox-exec` (ADR 0094).
// KORE_SANDBOX_TESTS=1 npx vitest run tests/writer-sandbox.spec.ts
const enabled =
  process.platform === "darwin" && process.env["KORE_SANDBOX_TESTS"] === "1";

describe.runIf(enabled)("writer sandbox (macOS sandbox-exec)", () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8" });
  let f: Fixture;
  let root: string;
  let home: string;
  let repo: string;
  let worktree: string;
  let sock: string;
  let profile: string;

  beforeAll(async () => {
    f = await createFixture();
    ({ root, home, repo, worktree, sock, profile } = f);
  });

  afterAll(() => removeFixture(f));

  it("writes inside its worktree and commits there", () => {
    const run = runSandboxed(profile, worktree, "sh", [
      "-c",
      "echo hi > f.txt && git add f.txt && git -c user.email=t@example.com -c user.name=t commit -q -m 'feat: x'",
    ]);
    expect(run.status, run.stderr).toBe(0);
    expect(git(repo, "log", "--oneline", "feat/w1")).toContain("feat: x");
  });

  it("cannot write outside its worktree", () => {
    const target = join(root, "outside.txt");
    const run = runSandboxed(profile, worktree, "sh", [
      "-c",
      `echo x > ${target}`,
    ]);
    expect(run.status).not.toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it("cannot read ~/.ssh", () => {
    const key = join(home, ".ssh", "id_test");
    expect(execFileSync("cat", [key], { encoding: "utf8" })).toContain(
      "MARKER",
    );
    const run = runSandboxed(profile, worktree, "cat", [key]);
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain("MARKER");
  });

  it("cannot message another pane through the herdr socket", async () => {
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
