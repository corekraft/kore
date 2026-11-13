// Integration: the real shell parser, the real write detection and a real filesystem in a
// temporary worktree. It lives outside src/ and tests/ so neither the unit run nor the commit
// hook's related tests include it; run it with `npm --prefix tools/harness run test:integration`
// (see vitest.integration.config.ts). It proves a symlink or folder named like a hook test
// is not exempt (#440, ADR 0100), which the unit spec can only prove against a mock.
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkProtected } from "../src/hook/guard-role-protected.js";

let root = "";
const bash = (command: string) =>
  checkProtected("writer", "Bash", { command }, root);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "guard-links-"));
  const hooks = join(root, ".claude", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "harness.sh"), "#!/bin/sh\n");
  writeFileSync(join(hooks, "plain.test.mjs"), "");
  symlinkSync("harness.sh", join(hooks, "linked.test.mjs"));
  mkdirSync(join(hooks, "folder.test.mjs"));
  mkdirSync(join(root, "scratch", "dir"), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkProtected with a real filesystem", () => {
  it("lets a writer remove or move a plain hook test file", () => {
    expect(bash("rm .claude/hooks/plain.test.mjs")).toBeNull();
    expect(bash("rm -f .claude/hooks/new.test.mjs")).toBeNull();
    expect(bash("git mv .claude/hooks/plain.test.mjs scratch/dir")).toBeNull();
  });

  it("refuses a write through a hook test name that is a symlink to a protected file", () => {
    expect(bash("echo x > .claude/hooks/linked.test.mjs")?.rule).toBe(
      "role-read-only",
    );
    expect(
      bash("cp scratch/harness.sh .claude/hooks/linked.test.mjs")?.rule,
    ).toBe("role-read-only");
  });

  it("refuses a write into a hook test name that is a folder", () => {
    expect(
      bash("cp scratch/harness.sh .claude/hooks/folder.test.mjs")?.rule,
    ).toBe("role-read-only");
  });

  it("refuses creating the link in the first place", () => {
    expect(bash("ln -s harness.sh .claude/hooks/made.test.mjs")?.rule).toBe(
      "role-read-only",
    );
  });

  it("refuses a link made and moved in under a test name within one call", () => {
    for (const command of [
      "ln -s harness.sh scratch/x.test.mjs && mv scratch/x.test.mjs .claude/hooks/x.test.mjs && echo x > .claude/hooks/x.test.mjs",
      "ln -s . scratch/d.test.mjs && mv scratch/d.test.mjs .claude/hooks/d.test.mjs && cp scratch/harness.sh .claude/hooks/d.test.mjs",
      "install -l s harness.sh .claude/hooks/x.test.mjs && echo x > .claude/hooks/x.test.mjs",
      "ln -s harness.sh scratch/x.test.mjs && mv scratch/x.test.mjs .claude/hooks/x.test.mjs && echo x > .claude/hooks/X.test.mjs",
      "git stash pop && echo x > .claude/hooks/x.test.mjs",
      "mkdir scratch/e && mv scratch/e .claude/hooks/e.test.mjs",
      "cp -r scratch/dir .claude/hooks/e.test.mjs",
    ]) {
      expect(bash(command)?.rule).toBe("role-read-only");
    }
  });

  it("refuses moving a folder onto a hook test name", () => {
    expect(bash("mv scratch/dir .claude/hooks/moved.test.mjs")?.rule).toBe(
      "role-read-only",
    );
  });
});
