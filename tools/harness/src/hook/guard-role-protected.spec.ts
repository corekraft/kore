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
    (segment[0] === "git" && ["mv", "checkout"].includes(segment[1] ?? "")) ||
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
const links = vi.hoisted(() => ({ present: new Set<string>() }));
vi.mock("./guard-role-links.js", () => ({
  isLinkOrFolder: (path: string) => links.present.has(path),
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
const refused = (rule: string) => ({
  action: "block",
  rule,
  message: expect.stringContaining(`[guard:${rule}]`),
});
/** The refusal for a file under the guard: the same message as before the test-file exception. */
const guardRefusal = {
  action: "block",
  rule: "role-read-only",
  message: expect.stringContaining(
    "changes the guard bundle, a hook or the settings",
  ),
};

describe("checkProtected: a writer may change hook test files", () => {
  it("allows the writer to create and edit a hook test file, by absolute or relative path", () => {
    for (const file of [
      "/repo/.claude/hooks/guard-role.test.mjs",
      ".claude/hooks/guard-role.test.mjs",
    ]) {
      expect(writer("Write", { file_path: file, content: "x" })).toBeNull();
      expect(
        writer("Edit", { file_path: file, old_string: "a", new_string: "b" }),
      ).toBeNull();
    }
  });

  it("allows Bash to move, delete, edit and redirect into a hook test file", () => {
    for (const command of [
      "mv .claude/hooks/a.test.mjs .claude/hooks/b.test.mjs",
      "rm .claude/hooks/a.test.mjs",
      "echo x > .claude/hooks/a.test.mjs",
      "sed -i s/a/b/ .claude/hooks/a.test.mjs",
      "cp tools/x.test.mjs .claude/hooks/a.test.mjs",
    ]) {
      expect(bash(command)).toBeNull();
    }
  });

  it("refuses every other file under .claude/hooks with the guard refusal", () => {
    for (const file of [
      ".claude/hooks/harness.sh",
      "/repo/.claude/hooks/harness.sh",
      ".claude/hooks/guard.mjs",
      ".claude/hooks/a.test.js",
      ".claude/hooks/a.test.mjs.sh",
      ".claude/hooks/nested/a.test.mjs",
      ".claude/hooks/.hidden.test.mjs",
    ]) {
      expect(writer("Write", { file_path: file, content: "x" })).toEqual(
        guardRefusal,
      );
    }
    expect(bash("rm .claude/hooks/harness.sh")).toEqual(guardRefusal);
  });
});

describe("checkProtected: the settings and the bundle stay protected", () => {
  it("keeps the settings, the bundle folder and the .claude folder protected", () => {
    for (const file of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      "skills/bin/harness.mjs",
    ]) {
      expect(writer("Write", { file_path: file, content: "x" })).toEqual(
        guardRefusal,
      );
    }
    expect(bash("rm -rf .claude")).toEqual(guardRefusal);
  });
});

describe("checkProtected: a hook test file cannot smuggle a protected file", () => {
  it("refuses a command that touches a hook test file and a protected file", () => {
    for (const command of [
      "cp .claude/hooks/a.test.mjs .claude/hooks/harness.sh",
      "mv .claude/hooks/harness.sh .claude/hooks/a.test.mjs",
      "rm .claude/hooks/a.test.mjs .claude/settings.json",
      "echo hi && cp .claude/hooks/a.test.mjs .claude/hooks/guard.sh",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses a glob, variable or substitution that could name a protected file", () => {
    for (const command of [
      "rm .claude/hooks/*",
      "rm .claude/hooks/*.test.mjs",
      "echo x > .claude/hooks/a?.test.mjs",
      "echo x > .claude/hooks/[ab].test.mjs",
      "echo x > .claude/hooks/$NAME.test.mjs",
      "echo x > .claude/hooks/$(id).test.mjs",
    ]) {
      expect(bash(command)).toEqual(guardRefusal);
    }
  });

  it("refuses copying into the hooks folder itself, which can name any file", () => {
    expect(bash("cp x.mjs .claude/hooks/")).toEqual(guardRefusal);
  });

  it("refuses a hook test file outside this worktree or reached by a path climb", () => {
    for (const file of [
      "/elsewhere/.claude/hooks/a.test.mjs",
      ".claude/hooks/../hooks/a.test.mjs",
      ".claude//hooks//a.test.mjs",
    ]) {
      expect(writer("Write", { file_path: file, content: "x" })).toEqual(
        guardRefusal,
      );
    }
  });
});

describe("checkProtected: the refusals that already held", () => {
  it("refuses a writer's flag activation and workflow dispatch", () => {
    expect(bash("node skills/bin/harness.mjs flag activate x")).toEqual(
      refused("role-no-merge"),
    );
    expect(bash("gh workflow run check.yml")).toEqual(refused("role-no-merge"));
  });

  it("refuses host credentials for every bound role", () => {
    expect(
      checkProtected(
        "reader",
        "Read",
        { file_path: "~/.ssh/id_ed25519" },
        ROOT,
      ),
    ).toEqual(refused("secret-path"));
    expect(bash("cat ~/.kube/config")).toEqual(refused("secret-path"));
  });

  it("lets ordinary work through, and binds only the writer to the guard files", () => {
    expect(writer("Write", { file_path: "src/a.ts", content: "x" })).toBeNull();
    expect(bash("ls docs")).toBeNull();
    expect(
      checkProtected(
        "reader",
        "Write",
        { file_path: ".claude/hooks/harness.sh", content: "x" },
        ROOT,
      ),
    ).toBeNull();
  });
});
