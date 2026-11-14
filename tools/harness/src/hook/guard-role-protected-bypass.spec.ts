import { describe, expect, it, vi } from "vitest";
import { checkProtected } from "./guard-role-protected.js";

// The shell parser, the verdict and the other guard collaborators are units with their own
// specs, so this unit runs against small stand-ins. The stand-ins split a command on `&&`
// and on whitespace, and read `>`, `>>` and `>|` as redirects. The protected-path rules are
// what is under test here.
const shell = vi.hoisted(() => {
  const REDIRECT = /^(>>?|>\|)$/;
  const WRITERS = new Set([
    "cp",
    "mv",
    "rm",
    "sed",
    "tee",
    "touch",
    "chmod",
    "mkdir",
    "ln",
    "install",
  ]);
  const splitSegments = (command: string): string[][] =>
    command.split("&&").map((segment) =>
      segment
        .trim()
        .split(/\s+/)
        .filter((word) => word !== ""),
    );
  return { REDIRECT, WRITERS, splitSegments };
});

vi.mock("./guard-shell.js", () => ({
  splitSegments: shell.splitSegments,
  commandOf: (tokens: readonly string[]) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }),
}));

vi.mock("./guard-role-merge.js", () => ({
  expand: (segment: string[]) => [segment],
  withSubstitutions: shell.splitSegments,
}));

vi.mock("./guard-role-delivery.js", () => ({
  runsInline: () => false,
}));

vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  writes: (segment: readonly string[]) =>
    shell.WRITERS.has(segment[0] ?? "") ||
    (segment[0] === "git" &&
      ["mv", "rm", "checkout"].includes(segment[1] ?? "")) ||
    segment.some((word) => shell.REDIRECT.test(word)),
  redirectTargets: (segment: readonly string[]) =>
    segment.flatMap((word, i) =>
      shell.REDIRECT.test(word) && segment[i + 1] !== undefined
        ? [segment[i + 1] as string]
        : [],
    ),
  withoutRedirects: (segment: readonly string[]) =>
    segment.filter(
      (word, i) =>
        !shell.REDIRECT.test(word) &&
        !shell.REDIRECT.test(segment[i - 1] ?? ""),
    ),
}));

// Which paths are symlinks or folders on disk is the fs's to say; the integration spec
// runs the real check.
const links = vi.hoisted(() => ({
  present: new Set<string>(),
  symlinks: new Set<string>(),
  missing: new Set<string>(),
}));
vi.mock("./guard-role-links.js", () => ({
  isLinkOrFolder: (path: string) =>
    links.present.has(path) || links.symlinks.has(path),
  isSymlink: (path: string) => links.symlinks.has(path),
  isRegularFile: (path: string) =>
    !links.present.has(path) &&
    !links.symlinks.has(path) &&
    !links.missing.has(path),
}));

vi.mock("./guard-verdict.js", () => ({
  block: (rule: string, message: string) => ({
    action: "block",
    rule,
    message: `[guard:${rule}] ${message}`,
  }),
}));

const ROOT = "/repo";
const writer = (tool: string, input: Record<string, unknown>) =>
  checkProtected("writer", tool, input, ROOT);
const bash = (command: string) => writer("Bash", { command });
/** The refusal for a file under the guard: the same message as before the test-file exception. */
const guardRefusal = {
  action: "block",
  rule: "role-read-only",
  message: expect.stringContaining(
    "changes the guard bundle, a hook or the settings",
  ),
};

describe("checkProtected: a hook test name cannot be a way into a protected file", () => {
  it("refuses a command that links a protected file or folder under a hook test name", () => {
    for (const command of [
      "ln -s harness.sh .claude/hooks/x.test.mjs",
      "ln -s ../settings.json .claude/hooks/x.test.mjs",
      "ln -s . .claude/hooks/d.test.mjs",
      "ln -sf /repo/.claude/hooks/harness.sh /repo/.claude/hooks/x.test.mjs",
      "ln .claude/hooks/harness.sh .claude/hooks/x.test.mjs",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses a write through a hook test name that is already a symlink or folder", () => {
    links.present.add("/repo/.claude/hooks/x.test.mjs");
    try {
      expect(bash("echo x > .claude/hooks/x.test.mjs")).toEqual(guardRefusal);
      expect(bash("cp scratch/harness.sh .claude/hooks/x.test.mjs")).toEqual(
        guardRefusal,
      );
      expect(
        writer("Write", {
          file_path: "/repo/.claude/hooks/x.test.mjs",
          content: "x",
        }),
      ).toEqual(guardRefusal);
      expect(bash("rm .claude/hooks/y.test.mjs")).toBeNull();
    } finally {
      links.present.clear();
    }
  });

  it("refuses a hook test name used as a folder to reach a protected file", () => {
    for (const command of [
      "cp x .claude/hooks/x.test.mjs/../harness.sh",
      "echo x > .claude/hooks/x.test.mjs/../harness.sh",
      "rm /repo/.claude/hooks/x.test.mjs/../harness.sh",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
    for (const file of [
      ".claude/hooks/x.test.mjs/../harness.sh",
      "/repo/.claude/hooks/x.test.mjs/../harness.sh",
    ]) {
      expect(writer("Write", { file_path: file, content: "x" })).toEqual(
        guardRefusal,
      );
    }
  });

  it("refuses an absolute path with a climb, glob, variable or brace", () => {
    for (const word of [
      "/repo/.claude/hooks/../hooks/a.test.mjs",
      "/repo/.claude/hooks/a.test.mjs/../b.test.mjs",
      "/repo/.claude/hooks/*.test.mjs",
      "/repo/.claude/hooks/$NAME.test.mjs",
      "/repo/.claude/hooks/{a,harness.sh}",
      "/repo/.claude/hooks/a.test.mjs{,.sh}",
      "/repo/.claude/hooks/${X}.test.mjs",
    ]) {
      expect(bash(`rm ${word}`)).toEqual(guardRefusal);
      expect(writer("Write", { file_path: word, content: "x" })).toEqual(
        guardRefusal,
      );
    }
  });
});

describe("checkProtected: a hook test name beside other words", () => {
  it("refuses brace expansion that reaches a protected file beside a test name", () => {
    for (const command of [
      "rm .claude/hooks/{a.test.mjs,harness.sh}",
      "cp x .claude/hooks/a.test.mjs{,.sh}",
      "cp x .claude/hooks/{a,b}.test.mjs",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses a redirect or an in-place edit that also names a protected file", () => {
    for (const command of [
      "cat .claude/hooks/a.test.mjs > .claude/hooks/harness.sh",
      "sed -i s/a/b/ .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses git moving a hook test onto a protected name, and git restoring or removing the hooks", () => {
    for (const command of [
      "git mv .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
      "git checkout -- .claude/hooks",
      "git checkout HEAD -- .claude/hooks/harness.sh",
      "rm -rf .claude/hooks",
      "rm -rf /repo/.claude/hooks",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses a hook test name that differs only in case from a protected folder", () => {
    for (const file of [
      ".claude/HOOKS/harness.sh",
      ".CLAUDE/hooks/harness.sh",
      ".claude/Settings.json",
    ]) {
      expect(writer("Write", { file_path: file, content: "x" })).toEqual(
        guardRefusal,
      );
    }
  });
});

describe("checkProtected: Bash gets no exemption beyond git mv out, git rm and rm", () => {
  it("refuses a link, folder or file put under a test name, in one call or across two", () => {
    for (const command of [
      "ln -s harness.sh scratch/x.test.mjs && mv scratch/x.test.mjs .claude/hooks/x.test.mjs && echo x > .claude/hooks/x.test.mjs",
      "ln -s harness.sh scratch/x.test.mjs && mv scratch/x.test.mjs .claude/hooks/x.test.mjs && echo x > .claude/hooks/X.test.mjs",
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
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses the other writing commands into a hook test name", () => {
    for (const command of [
      "cp -s harness.sh .claude/hooks/x.test.mjs",
      "git mv a .claude/hooks/x.test.mjs",
      "git checkout -- .claude/hooks/a.test.mjs",
      "echo x > .claude/hooks/a.test.mjs",
      "tee .claude/hooks/a.test.mjs",
      "sed -i s/a/b/ .claude/hooks/a.test.mjs",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });
});

describe("checkProtected: the git mv, git rm and rm allowlist is narrow", () => {
  it("refuses git mv, git rm and rm unless they stand alone with plain hook tests", () => {
    for (const command of [
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
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses git mv, git rm and rm of a hook test that is a symlink or folder, or onto a symlink", () => {
    links.present.add("/repo/.claude/hooks/l.test.mjs");
    links.missing.add("/repo/.claude/hooks/gone.test.mjs");
    links.symlinks.add("/repo/scratch/link");
    try {
      for (const command of [
        "rm .claude/hooks/l.test.mjs",
        "rm -f .claude/hooks/gone.test.mjs",
        "git mv .claude/hooks/gone.test.mjs tools/",
        "git rm .claude/hooks/l.test.mjs",
        "git mv .claude/hooks/l.test.mjs tools/",
        "git mv .claude/hooks/a.test.mjs scratch/link",
      ]) {
        expect(bash(command)).toEqual(guardRefusal);
      }
    } finally {
      links.present.clear();
      links.symlinks.clear();
      links.missing.clear();
    }
  });
});
