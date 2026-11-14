// The protected-path guard's removal rules and the refusals that already held, on the real
// worktree. Split from guard-role-protected.spec.ts to keep each spec under 300 lines.
import { checkProtected } from "../../src/hook/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bash,
  setUp,
  tearDown,
  guardRefusal,
  worktree,
  write,
} from "./guard-role-protected-support.js";

beforeAll(setUp);
afterAll(tearDown);

describe("protected guard: git mv, git rm and rm stand alone with plain hook tests", () => {
  it.each([
    "rm .claude/hooks/a.test.mjs && echo hi",
    "rm .claude/hooks/a.test.mjs ; echo hi",
    "rm .claude/hooks/a.test.mjs | cat",
    "rm .claude/hooks/a.test.mjs > out",
    "rm .claude/hooks/a.test.mjs $(id)",
    "rm .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
    "rm -rf .claude/hooks/a.test.mjs",
    "rm -r .claude/hooks/a.test.mjs",
    "git rm -r .claude/hooks/a.test.mjs",
    "git rm --cached .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
    "git mv .claude/hooks/a.test.mjs .claude/archive/a.test.mjs",
    "git mv .claude/hooks/a.test.mjs .claude",
    "git mv .claude/hooks/a.test.mjs .CLAUDE/hooks/",
    "git mv .claude/hooks/a.test.mjs scratch/../.claude/hooks/x.test.mjs",
    "git mv .claude/hooks/a.test.mjs skills/bin/x.mjs",
    "git mv .claude/hooks/a.test.mjs $DEST",
    "git mv .claude/hooks/a.test.mjs tools/{a,b}",
    "git mv .claude/hooks/harness.sh tools/harness.sh",
    "git mv .claude/hooks/a.test.mjs .claude/hooks/harness.sh tools/",
    "git mv -f .claude/hooks/a.test.mjs tools/",
    "git mv .claude/hooks/*.test.mjs tools/",
    "git mv .claude/hooks/a.test.mjs",
    "git -C scratch mv .claude/hooks/a.test.mjs dir",
    "git --git-dir=x rm .claude/hooks/a.test.mjs",
    "git mv .claude/hooks/a.test.mjs .claude/hooks/b.test.mjs #x",
    "rm .claude/hooks/a.test.mjs #x",
  ])("refuses it, since it is not one plain removal: %s", (command) => {
    expect(bash(command)).toEqual(guardRefusal);
  });

  it.each([
    "rm .claude/hooks/l.test.mjs",
    "rm -f .claude/hooks/gone.test.mjs",
    "git mv .claude/hooks/gone.test.mjs tools/",
    "git rm .claude/hooks/l.test.mjs",
    "git mv .claude/hooks/l.test.mjs tools/",
    "git mv .claude/hooks/a.test.mjs scratch/link",
  ])(
    "refuses a folder, a missing file or a move onto a symlink: %s",
    (command) => {
      expect(bash(command)).toEqual(guardRefusal);
    },
  );
});

describe("protected guard: the refusals that already held", () => {
  it.each([
    "node skills/bin/harness.mjs flag activate x",
    "gh workflow run check.yml",
  ])(
    "refuses a writer's flag activation or workflow dispatch: %s",
    (command) => {
      expect(bash(command)).toMatchObject({ rule: "role-no-merge" });
    },
  );

  it("refuses host credentials for every bound role, for a read as well as a command", () => {
    expect(
      checkProtected(
        "reader",
        "Read",
        { file_path: "~/.ssh/id_ed25519" },
        worktree.root,
      ),
    ).toMatchObject({ rule: "secret-path" });
    expect(bash("cat ~/.kube/config")).toMatchObject({ rule: "secret-path" });
  });

  it("lets ordinary work through, and binds only the writer to the guard files", () => {
    expect(write("src/a.ts")).toBeNull();
    expect(bash("ls docs")).toBeNull();
    expect(
      checkProtected(
        "reader",
        "Write",
        { file_path: ".claude/hooks/harness.sh", content: "x" },
        worktree.root,
      ),
    ).toBeNull();
  });
});
