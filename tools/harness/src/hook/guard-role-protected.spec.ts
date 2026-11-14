import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runsInline } from "./guard-role-delivery.js";
import {
  isLinkOrFolder,
  isRegularFile,
  isSymlink,
} from "./guard-role-links.js";
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

vi.mock("node:path");
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
const WRITER = /^(cp|mv|rm|sed|tee|touch|chmod|mkdir|ln|install)$/;

/** Fakes for the shell and path helpers: a command splits on `&&` and whitespace; a path is taken from the root. */
const splitWords = (command: string) =>
  command.split("&&").map((s) => s.trim().split(/\s+/).filter(Boolean));
const words = (tokens: readonly string[]) => ({
  name: tokens[0] ?? "",
  args: tokens.slice(1),
});
const writesFake = (seg: readonly string[]) =>
  WRITER.test(seg[0] ?? "") ||
  (seg[0] === "git" && /^(mv|rm|checkout)$/.test(seg[1] ?? "")) ||
  seg.some((w) => REDIRECT.test(w));
const redirectsFake = (seg: readonly string[]) =>
  seg.flatMap((w, i) =>
    REDIRECT.test(w) && seg[i + 1] !== undefined ? [seg[i + 1] ?? ""] : [],
  );
const withoutFake = (seg: readonly string[]) =>
  seg.filter((w, i) => !REDIRECT.test(w) && !REDIRECT.test(seg[i - 1] ?? ""));
/** The sources and destination of git mv and git rm, or of rm without -f. */
function removalFake(line: readonly string[]) {
  const [name = "", verb = "", ...rest] = line;
  if (name === "rm") {
    return { sources: line.slice(1).filter((w) => w !== "-f") };
  }
  if (name !== "git" || !["mv", "rm"].includes(verb)) {
    return undefined;
  }
  return verb === "rm"
    ? { sources: rest }
    : { sources: rest.slice(0, -1), destination: rest.at(-1) ?? "-" };
}
const normalize = (path: string) =>
  path
    .split("/")
    .filter((p) => p !== "" && p !== ".")
    .join("/");
function relativeTo(from: string, to: string): string {
  if (to === from) {
    return "";
  }
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : "../outside";
}

const writer = (tool: string, input: Record<string, unknown>) =>
  checkProtected("writer", tool, input, ROOT);
const bash = (command: string) => writer("Bash", { command });
const guardRefusal = {
  action: "block",
  rule: "role-read-only",
  message: expect.stringContaining(
    "changes the guard bundle, a hook or the settings",
  ),
};
const refused = (rule: string) => ({
  action: "block",
  rule,
  message: expect.stringContaining(`[guard:${rule}]`),
});

/** Paths that are symlinks, folders or missing on disk; each test sets them up. */
let present: Set<string>;
let symlinks: Set<string>;
let missing: Set<string>;

beforeEach(() => {
  present = new Set();
  symlinks = new Set();
  missing = new Set();
  vi.mocked(isLinkOrFolder).mockImplementation(
    (p) => present.has(p) || symlinks.has(p),
  );
  vi.mocked(isSymlink).mockImplementation((p) => symlinks.has(p));
  vi.mocked(isRegularFile).mockImplementation(
    (p) => !present.has(p) && !symlinks.has(p) && !missing.has(p),
  );
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(withSubstitutions).mockImplementation(splitWords);
  vi.mocked(commandOf).mockImplementation(words);
  vi.mocked(expand).mockImplementation((segment) => [[...segment]]);
  vi.mocked(runsInline).mockReturnValue(false);
  vi.mocked(writes).mockImplementation(writesFake);
  vi.mocked(redirectTargets).mockImplementation(redirectsFake);
  vi.mocked(withoutRedirects).mockImplementation(withoutFake);
  vi.mocked(removal).mockImplementation(removalFake);
  vi.mocked(block).mockImplementation((rule, message) => ({
    action: "block",
    rule,
    message: `[guard:${rule}] ${message}`,
  }));
  vi.mocked(posix.normalize).mockImplementation(normalize);
  vi.mocked(join).mockImplementation((root, path) => `${root}/${path}`);
  vi.mocked(resolve).mockImplementation((root, path) =>
    path.startsWith("/") ? path : `${root}/${path}`,
  );
  vi.mocked(relative).mockImplementation(relativeTo);
  vi.mocked(isAbsolute).mockImplementation((path) => path.startsWith("/"));
});

describe("checkProtected: a writer may change hook test files", () => {
  it("allows the writer to create and edit a hook test file, and Bash to move one alone", () => {
    expect(
      writer("Write", {
        file_path: ".claude/hooks/guard-role.test.mjs",
        content: "x",
      }),
    ).toBeNull();
    expect(
      writer("Edit", {
        file_path: "/repo/.claude/hooks/g.test.mjs",
        old_string: "a",
        new_string: "b",
      }),
    ).toBeNull();
    expect(
      bash("git mv .claude/hooks/a.test.mjs tools/harness/integration/"),
    ).toBeNull();
  });

  it("refuses every other file under .claude/hooks", () => {
    expect(
      writer("Write", {
        file_path: ".claude/hooks/a.test.mjs.sh",
        content: "x",
      }),
    ).toEqual(guardRefusal);
  });
});

describe("checkProtected: the settings, the bundle and the guard folder", () => {
  it("keeps the settings, the bundle and the .claude folder protected", () => {
    expect(
      writer("Write", {
        file_path: ".claude/settings.local.json",
        content: "x",
      }),
    ).toEqual(guardRefusal);
    expect(
      writer("Write", { file_path: "skills/bin/harness.mjs", content: "x" }),
    ).toEqual(guardRefusal);
    expect(bash("rm -rf .claude")).toEqual(guardRefusal);
  });
});

describe("checkProtected: a hook test cannot smuggle a protected file", () => {
  it("refuses a command that names a protected file, a glob or an unresolvable name", () => {
    expect(
      bash("echo hi && cp .claude/hooks/a.test.mjs .claude/hooks/guard.sh"),
    ).toEqual(guardRefusal);
    expect(bash("rm .claude/hooks/*")).toEqual(guardRefusal);
    expect(bash("echo x > .claude/hooks/$(id).test.mjs")).toEqual(guardRefusal);
    expect(bash("cp x.mjs .claude/hooks/")).toEqual(guardRefusal);
  });

  it("refuses a hook test outside this worktree, or reached by a climb", () => {
    expect(
      writer("Write", {
        file_path: "/elsewhere/.claude/hooks/a.test.mjs",
        content: "x",
      }),
    ).toEqual(guardRefusal);
    expect(
      writer("Write", {
        file_path: ".claude/hooks/../hooks/a.test.mjs",
        content: "x",
      }),
    ).toEqual(guardRefusal);
  });
});

describe("checkProtected: a hook test name is not a way into a protected file", () => {
  it("refuses a link to a protected file under a hook test name", () => {
    expect(
      bash(
        "ln -sf /repo/.claude/hooks/harness.sh /repo/.claude/hooks/x.test.mjs",
      ),
    ).toEqual(guardRefusal);
  });

  it("refuses a write through a hook test name that is already a symlink or folder", () => {
    present.add("/repo/.claude/hooks/x.test.mjs");

    expect(bash("echo x > .claude/hooks/x.test.mjs")).toEqual(guardRefusal);
    expect(bash("rm .claude/hooks/y.test.mjs")).toBeNull();
  });

  it("refuses a hook test name beside a protected name, a climb, a glob or a brace", () => {
    expect(bash("cp x .claude/hooks/x.test.mjs/../harness.sh")).toEqual(
      guardRefusal,
    );
    expect(bash("rm /repo/.claude/hooks/*.test.mjs")).toEqual(guardRefusal);
    expect(bash("rm /repo/.claude/hooks/{a,harness.sh}")).toEqual(guardRefusal);
    expect(
      bash("cat .claude/hooks/a.test.mjs > .claude/hooks/harness.sh"),
    ).toEqual(guardRefusal);
  });

  it("refuses a link, file or folder put under a test name by a second command", () => {
    expect(
      bash("mkdir scratch/dir && mv scratch/dir .claude/hooks/d.test.mjs"),
    ).toEqual(guardRefusal);
    expect(bash("sed -i s/a/b/ .claude/hooks/a.test.mjs")).toEqual(
      guardRefusal,
    );
  });

  it("refuses a protected path that differs only in case", () => {
    expect(
      writer("Write", { file_path: ".CLAUDE/hooks/harness.sh", content: "x" }),
    ).toEqual(guardRefusal);
  });
});

describe("checkProtected: git mv, git rm and rm stand alone with plain hook tests", () => {
  it("refuses a removal that is not one plain command with plain hook tests", () => {
    expect(bash("rm .claude/hooks/a.test.mjs && echo hi")).toEqual(
      guardRefusal,
    );
    expect(bash("git mv .claude/hooks/a.test.mjs .claude")).toEqual(
      guardRefusal,
    );
    expect(bash("git -C scratch mv .claude/hooks/a.test.mjs dir")).toEqual(
      guardRefusal,
    );
  });

  it("refuses a removal of a hook test that is a symlink or folder, missing, or moved onto a symlink", () => {
    present.add("/repo/.claude/hooks/l.test.mjs");
    missing.add("/repo/.claude/hooks/gone.test.mjs");
    symlinks.add("/repo/scratch/link");

    expect(bash("rm .claude/hooks/l.test.mjs")).toEqual(guardRefusal);
    expect(bash("rm -f .claude/hooks/gone.test.mjs")).toEqual(guardRefusal);
    expect(bash("git mv .claude/hooks/a.test.mjs scratch/link")).toEqual(
      guardRefusal,
    );
  });
});

describe("checkProtected: the refusals that already held", () => {
  it("refuses a writer's flag activation or workflow dispatch", () => {
    expect(bash("node skills/bin/harness.mjs flag activate x")).toEqual(
      refused("role-no-merge"),
    );
    expect(bash("gh workflow run check.yml")).toEqual(refused("role-no-merge"));
  });

  it("refuses host credentials for every bound role, and lets ordinary work through", () => {
    expect(
      checkProtected(
        "reader",
        "Read",
        { file_path: "~/.ssh/id_ed25519" },
        ROOT,
      ),
    ).toEqual(refused("secret-path"));
    expect(bash("cat ~/.kube/config")).toEqual(refused("secret-path"));
    expect(writer("Write", { file_path: "src/a.ts", content: "x" })).toBeNull();
    expect(bash("ls docs")).toBeNull();
  });
});
