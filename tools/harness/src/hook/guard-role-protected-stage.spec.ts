import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRegularFile } from "./guard-role-links.js";
import { expand, withSubstitutions } from "./guard-role-merge.js";
import { checkProtected } from "./guard-role-protected.js";
import {
  redirectTargets,
  removal,
  withoutRedirects,
  writes,
} from "./guard-role-writes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { block } from "./guard-verdict.js";

vi.mock("./guard-role-delivery.js");
vi.mock("./guard-role-links.js");
vi.mock("./guard-role-merge.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  redirectTargets: vi.fn(),
  removal: vi.fn(),
  withoutRedirects: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

const ROOT = "/repo";
const REDIRECT = /^(>>?|>\|)$/;

/** Fakes for the shell: a command splits on `&&`, and a word is a run of text or a quoted string with its quotes taken off. */
const splitWords = (command: string): string[][] =>
  command
    .split("&&")
    .map((segment) =>
      [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
        (match) => match[1] ?? match[2] ?? match[3] ?? "",
      ),
    );
/** Git verbs that change files, the index or history; `git add` and `git commit` are the ones this spec stages with. */
const writesFake = (segment: readonly string[]): boolean =>
  /^(cp|mv|rm|sed|tee|touch)$/.test(segment[0] ?? "") ||
  (segment[0] === "git" &&
    /^(add|commit|mv|rm|restore)$/.test(segment[1] ?? "")) ||
  segment.some((word) => REDIRECT.test(word));

const writer = (tool: string, input: Record<string, unknown>) =>
  checkProtected("writer", tool, input, ROOT);
const bash = (command: string) => writer("Bash", { command });
const refusal = {
  action: "block",
  rule: "role-read-only",
  message: expect.stringContaining(
    "changes the guard bundle, a hook or the settings",
  ),
};

/** Hook test paths that are a symlink or a folder on disk: not a regular file, so no plain test. */
let notRegular: Set<string>;

beforeEach(() => {
  notRegular = new Set();
  vi.mocked(isRegularFile).mockImplementation((path) => !notRegular.has(path));
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(withSubstitutions).mockImplementation(splitWords);
  vi.mocked(expand).mockImplementation((segment) => [[...segment]]);
  vi.mocked(commandOf).mockImplementation((tokens) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }));
  vi.mocked(writes).mockImplementation(writesFake);
  vi.mocked(redirectTargets).mockImplementation((segment) =>
    segment.flatMap((word, index) =>
      REDIRECT.test(word) && segment[index + 1] !== undefined
        ? [segment[index + 1] ?? ""]
        : [],
    ),
  );
  vi.mocked(withoutRedirects).mockImplementation((segment) => [...segment]);
  vi.mocked(removal).mockReturnValue(undefined);
  vi.mocked(block).mockImplementation((rule, message) => ({
    action: "block",
    rule,
    message: `[guard:${rule}] ${message}`,
  }));
});

describe("checkProtected: a writer may stage one hook test with git add or git commit", () => {
  it("allows git add and git commit of one regular hook test file, and of an ordinary path", () => {
    expect(bash("git add .claude/hooks/workflow.test.mjs")).toBeNull();
    expect(
      bash(
        'git commit -m "test(hooks): cover the stage rule (#576)" -- .claude/hooks/workflow.test.mjs',
      ),
    ).toBeNull();
    expect(
      bash("git commit -m fix .claude/hooks/workflow.test.mjs"),
    ).toBeNull();
    expect(bash("git add src/app.ts")).toBeNull();
  });

  it("refuses staging any hook file that is not a test, the settings, the bundle or the folder", () => {
    expect(bash("git add .claude/hooks/guard.sh")).toEqual(refusal);
    expect(bash("git add .claude/settings.json")).toEqual(refusal);
    expect(bash("git add .claude/settings.local.json")).toEqual(refusal);
    expect(bash("git add skills/bin/harness.mjs")).toEqual(refusal);
    expect(bash("git add .claude")).toEqual(refusal);
  });

  it("refuses staging a glob, a climb, a symlink, a folder or a missing name under a test name", () => {
    notRegular.add("/repo/.claude/hooks/link.test.mjs");
    notRegular.add("/repo/.claude/hooks/dir.test.mjs");
    expect(bash("git add .claude/hooks/*.test.mjs")).toEqual(refusal);
    expect(bash("git add .claude/hooks/../hooks/workflow.test.mjs")).toEqual(
      refusal,
    );
    expect(bash("git add .claude/hooks/x.test.mjs/../harness.sh")).toEqual(
      refusal,
    );
    expect(bash("git add .claude/hooks/link.test.mjs")).toEqual(refusal);
    expect(bash("git commit -m fix -- .claude/hooks/dir.test.mjs")).toEqual(
      refusal,
    );
  });

  it("refuses a stage that names two paths, a flag, a second command or a substitution", () => {
    expect(
      bash("git add .claude/hooks/a.test.mjs .claude/hooks/b.test.mjs"),
    ).toEqual(refusal);
    expect(bash("git add -f .claude/hooks/a.test.mjs")).toEqual(refusal);
    expect(bash("git add -A .claude/hooks/a.test.mjs")).toEqual(refusal);
    expect(
      bash(
        "git add .claude/hooks/a.test.mjs && git commit -m fix -- .claude/hooks/b.test.mjs",
      ),
    ).toEqual(refusal);
    expect(
      bash('git commit -m "$(echo hi)" -- .claude/hooks/a.test.mjs'),
    ).toEqual(refusal);
  });

  it("refuses another verb that writes a hook test, such as git restore", () => {
    expect(bash("git restore .claude/hooks/a.test.mjs")).toEqual(refusal);
  });
});
