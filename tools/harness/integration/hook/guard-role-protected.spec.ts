// The protected-path guard on a real worktree: the real shell parser, real write detection and
// a real file system, so a symlink or folder named like a hook test is refused (#440, ADR 0100).
// The unit spec (src/hook/guard-role-protected.spec.ts) proves each rule against stand-ins; these
// cases are the full set, run through the barrel. The cases name the repository as /repo, which
// the run replaces with its temporary root.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bash,
  guardRefusal,
  setUp,
  tearDown,
  write,
} from "./guard-role-protected-support.js";

beforeAll(setUp);
afterAll(tearDown);

describe("protected guard: hook test files a writer may change", () => {
  it.each([
    "/repo/.claude/hooks/guard-role.test.mjs",
    ".claude/hooks/guard-role.test.mjs",
  ])("allows the writer to create and edit the hook test %s", (file) => {
    expect(write(file)).toBeNull();
  });

  it.each([
    "git mv .claude/hooks/a.test.mjs tools/harness/integration/a.test.mjs",
    "git mv .claude/hooks/a.test.mjs tools/harness/integration/",
    "git mv .claude/hooks/a.test.mjs .claude/hooks/b.test.mjs /repo/tools/harness/integration",
    "git rm .claude/hooks/a.test.mjs .claude/hooks/b.test.mjs",
    "rm .claude/hooks/a.test.mjs",
    "rm -f .claude/hooks/a.test.mjs /repo/.claude/hooks/b.test.mjs",
  ])("allows Bash to move or remove a hook test alone: %s", (command) => {
    expect(bash(command)).toBeNull();
  });

  it.each([
    ".claude/hooks/harness.sh",
    "/repo/.claude/hooks/harness.sh",
    ".claude/hooks/guard.mjs",
    ".claude/hooks/a.test.js",
    ".claude/hooks/a.test.mjs.sh",
    ".claude/hooks/nested/a.test.mjs",
    ".claude/hooks/.hidden.test.mjs",
  ])("refuses every other file under .claude/hooks: %s", (file) => {
    expect(write(file)).toEqual(guardRefusal);
  });
});

describe("protected guard: the settings, the bundle and the hooks folder", () => {
  it.each([
    ".claude/settings.json",
    ".claude/settings.local.json",
    "skills/bin/harness.mjs",
  ])("keeps %s protected from a write", (file) => {
    expect(write(file)).toEqual(guardRefusal);
  });

  it.each([
    "rm -rf .claude",
    "rm -rf .claude/hooks",
    "rm .claude/hooks/harness.sh",
  ])(
    "keeps the guard folder and its non-test files protected from removal: %s",
    (command) => {
      expect(bash(command)).toEqual(guardRefusal);
    },
  );
});

describe("protected guard: a hook test cannot smuggle a protected file", () => {
  it.each([
    "cp .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
    "mv .claude/hooks/harness.sh .claude/hooks/a.test.mjs",
    "rm .claude/hooks/a.test.mjs .claude/settings.json",
    "echo hi && cp .claude/hooks/a.test.mjs .claude/hooks/guard.sh",
    "rm .claude/hooks/*",
    "rm .claude/hooks/*.test.mjs",
    "echo x > .claude/hooks/a?.test.mjs",
    "echo x > .claude/hooks/[ab].test.mjs",
    "echo x > .claude/hooks/$NAME.test.mjs",
    "echo x > .claude/hooks/$(id).test.mjs",
    "cp x.mjs .claude/hooks/",
  ])("refuses it: %s", (command) => {
    expect(bash(command)).toEqual(guardRefusal);
  });

  it.each([
    "/elsewhere/.claude/hooks/a.test.mjs",
    ".claude/hooks/../hooks/a.test.mjs",
    ".claude//hooks//a.test.mjs",
    ".claude/HOOKS/harness.sh",
    ".CLAUDE/hooks/harness.sh",
    ".claude/Settings.json",
  ])(
    "refuses a write to a path outside the worktree or a climb or case variant: %s",
    (file) => {
      expect(write(file)).toEqual(guardRefusal);
    },
  );
});

describe("protected guard: a hook test name is not a way into a protected file", () => {
  it.each([
    "ln -s harness.sh .claude/hooks/x.test.mjs",
    "ln -s ../settings.json .claude/hooks/x.test.mjs",
    "ln -s . .claude/hooks/d.test.mjs",
    "ln -sf /repo/.claude/hooks/harness.sh /repo/.claude/hooks/x.test.mjs",
    "ln .claude/hooks/harness.sh .claude/hooks/x.test.mjs",
    "cp x .claude/hooks/x.test.mjs/../harness.sh",
    "echo x > .claude/hooks/x.test.mjs/../harness.sh",
    "rm /repo/.claude/hooks/x.test.mjs/../harness.sh",
    "rm /repo/.claude/hooks/../hooks/a.test.mjs",
    "rm /repo/.claude/hooks/a.test.mjs/../b.test.mjs",
    "rm /repo/.claude/hooks/*.test.mjs",
    "rm /repo/.claude/hooks/$NAME.test.mjs",
    "rm /repo/.claude/hooks/{a,harness.sh}",
    "rm /repo/.claude/hooks/a.test.mjs{,.sh}",
    "rm /repo/.claude/hooks/${X}.test.mjs",
    "rm .claude/hooks/{a.test.mjs,harness.sh}",
    "cp x .claude/hooks/a.test.mjs{,.sh}",
    "cp x .claude/hooks/{a,b}.test.mjs",
    "cat .claude/hooks/a.test.mjs > .claude/hooks/harness.sh",
    "sed -i s/a/b/ .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
    "git mv .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
    "git checkout -- .claude/hooks",
    "git checkout HEAD -- .claude/hooks/harness.sh",
    "rm -rf /repo/.claude/hooks",
  ])("refuses it: %s", (command) => {
    expect(bash(command)).toEqual(guardRefusal);
  });
});

describe("protected guard: a hook test name that is a folder or link on disk", () => {
  it("refuses a write through a hook test name that is a folder on disk", () => {
    expect(bash("echo x > .claude/hooks/x.test.mjs")).toEqual(guardRefusal);
    expect(bash("cp scratch/harness.sh .claude/hooks/x.test.mjs")).toEqual(
      guardRefusal,
    );
    expect(write("/repo/.claude/hooks/x.test.mjs")).toEqual(guardRefusal);
    expect(write(".claude/hooks/x.test.mjs/../harness.sh")).toEqual(
      guardRefusal,
    );
    expect(bash("rm .claude/hooks/y.test.mjs")).toBeNull();
  });

  it.each([
    "/repo/.claude/hooks/../hooks/a.test.mjs",
    "/repo/.claude/hooks/a.test.mjs/../b.test.mjs",
    "/repo/.claude/hooks/*.test.mjs",
    "/repo/.claude/hooks/$NAME.test.mjs",
    "/repo/.claude/hooks/{a,harness.sh}",
    "/repo/.claude/hooks/a.test.mjs{,.sh}",
    "/repo/.claude/hooks/${X}.test.mjs",
  ])(
    "refuses an absolute path with a climb, glob, variable or brace, as a write: %s",
    (word) => {
      expect(write(word)).toEqual(guardRefusal);
    },
  );

  it.each([
    "ln -s harness.sh scratch/x.test.mjs && mv scratch/x.test.mjs .claude/hooks/x.test.mjs && echo x > .claude/hooks/x.test.mjs",
    "ln -s harness.sh scratch/x.test.mjs && mv scratch/x.test.mjs .claude/hooks/x.test.mjs && git stash -u",
    "git stash pop && echo x > .claude/hooks/x.test.mjs",
    "git restore .claude/hooks/x.test.mjs && echo x > .claude/hooks/x.test.mjs",
    "mkdir scratch/dir && mv scratch/dir .claude/hooks/d.test.mjs",
    "cp -r scratch/d .claude/hooks/d.test.mjs",
    "mv scratch/dir .claude/hooks/d.test.mjs",
    "mv scratch/file .claude/hooks/d.test.mjs",
    "cp scratch/a.test.mjs .claude/hooks/a.test.mjs",
    "mv .claude/hooks/a.test.mjs .claude/hooks/b.test.mjs",
    "install -l s harness.sh .claude/hooks/x.test.mjs",
    "cp -s harness.sh .claude/hooks/x.test.mjs",
    "git mv a .claude/hooks/x.test.mjs",
    "git checkout -- .claude/hooks/a.test.mjs",
    "echo x > .claude/hooks/a.test.mjs",
    "tee .claude/hooks/a.test.mjs",
    "sed -i s/a/b/ .claude/hooks/a.test.mjs",
  ])("refuses a link, file or folder put under a test name: %s", (command) => {
    expect(bash(command)).toEqual(guardRefusal);
  });
});
