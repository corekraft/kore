import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMayRun } from "./guard-role-allow.js";
import {
  mergesPr,
  runsJudgeTool,
  withSubstitutions,
} from "./guard-role-merge.js";
import { pushesByTracking, pushesToMain } from "./guard-role-push.js";
import { takesRoute, takesWriterRoute } from "./guard-role-routes.js";
import {
  harnessAllowed,
  notifiesFinish,
  readOnly,
  sendsToPane,
  setsEnvironment,
  useNotify,
  writes,
  wrapsCommands,
} from "./guard-role-writes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { checkDeliveryBash, runsInline } from "./guard-role-delivery.js";
import { isAbsolute, relative, resolve } from "node:path";
import { block } from "./guard-verdict.js";
import { REPORTING_ROLES } from "./guard-roles.js";

vi.mock("node:path");
vi.mock("./guard-role-allow.js");
vi.mock("./guard-role-merge.js");
vi.mock("./guard-role-push.js");
vi.mock("./guard-role-routes.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  harnessAllowed: vi.fn(),
  notifiesFinish: vi.fn(),
  readOnly: vi.fn(),
  sendsToPane: vi.fn(),
  setsEnvironment: vi.fn(),
  useNotify: vi.fn(),
  writes: vi.fn(),
  wrapsCommands: vi.fn(),
}));
vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

const ROOT = "/repo";
const HARNESS_PATH = "skills/bin/harness.mjs";

const hit = (rule: string, message: string) => ({
  action: "block" as const,
  rule,
  message,
});

const splitWords = (command: string) =>
  command.split(" && ").map((s) => s.split(" "));
const words = (tokens: readonly string[]) => ({
  name: tokens[0] ?? "",
  args: tokens.slice(1),
});

const join = (root: string, path: string) =>
  path.startsWith("/") ? path : `${root}/${path}`;

/** Fake relative: the rest of `to` past `from`, else `../outside`. */
function relativeTo(from: string, to: string): string {
  if (to === from) {
    return "";
  }
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : "../outside";
}

const bash = (role: string, command: string) =>
  checkDeliveryBash(role, REPORTING_ROLES.includes(role), command, ROOT);

beforeEach(() => {
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(commandOf).mockImplementation(words);
  vi.mocked(withSubstitutions).mockImplementation(splitWords);
  vi.mocked(resolve).mockImplementation(join);
  vi.mocked(isAbsolute).mockImplementation((path) => path.startsWith("/"));
  vi.mocked(relative).mockImplementation(relativeTo);
  for (const check of [mergesPr, pushesToMain, takesRoute, takesWriterRoute]) {
    vi.mocked(check).mockReturnValue(false);
  }
  vi.mocked(pushesByTracking).mockReturnValue(false);
  vi.mocked(runsJudgeTool).mockReturnValue(false);
  vi.mocked(readMayRun).mockReturnValue(true);
  vi.mocked(harnessAllowed).mockReturnValue(true);
  vi.mocked(notifiesFinish).mockReturnValue(true);
  vi.mocked(sendsToPane).mockReturnValue(false);
  vi.mocked(setsEnvironment).mockReturnValue(false);
  vi.mocked(writes).mockReturnValue(false);
  vi.mocked(wrapsCommands).mockReturnValue(false);
  vi.mocked(readOnly).mockImplementation((what) =>
    hit("role-read-only", `${what} changes files`),
  );
  vi.mocked(useNotify).mockImplementation((what) =>
    hit("role-read-only", `${what} types into a pane; session notify`),
  );
  vi.mocked(block).mockImplementation(hit);
});

describe("runsInline: an interpreter given code, or an editor told to edit in place", () => {
  it.each([
    ["node -e", ["node", "-e", "x"]],
    ["python3 -c", ["python3", "-c", "x"]],
    ["perl -pi", ["perl", "-pi", "x"]],
    ["ruby -e", ["ruby", "-e", "x"]],
    ["awk -i inplace", ["awk", "-i", "inplace", "x"]],
  ])("is true for %s", (_name, segment) => {
    expect(runsInline(segment)).toBe(true);
  });

  it("is false for a script file run as a script", () => {
    expect(runsInline(["node", "build.mjs"])).toBe(false);
  });
});

describe("checkDeliveryBash: the merge and push routes every role refuses", () => {
  it.each([
    ["a merge", mergesPr],
    ["a push to main", pushesToMain],
    ["a route past the ruleset", takesRoute],
  ])("blocks %s for the writer and every reporting role", (_name, check) => {
    vi.mocked(check).mockReturnValue(true);
    for (const role of ["writer", "orchestrator", "judge"]) {
      expect(bash(role, "gh pr merge 1")).toMatchObject({
        rule: "role-no-merge",
      });
    }
  });

  it("blocks a judge command by anyone but the judge", () => {
    vi.mocked(runsJudgeTool).mockReturnValue(true);

    expect(
      bash("orchestrator", "node skills/bin/harness.mjs judge merge 1"),
    ).toMatchObject({
      rule: "role-no-merge",
    });
    expect(
      bash("judge", "node skills/bin/harness.mjs judge merge 1"),
    ).toBeNull();
  });

  it("blocks a writer's route only the writer's shell reaches, but leaves a reporting role to its allowlist", () => {
    vi.mocked(takesWriterRoute).mockReturnValue(true);

    expect(bash("writer", "gh auth token")).toMatchObject({
      rule: "role-no-merge",
    });
    expect(bash("judge", "gh auth token")).toBeNull();
  });

  it("blocks a push that tracks main for the writer, which the reporting roles never make", () => {
    vi.mocked(pushesByTracking).mockReturnValue(true);

    expect(bash("writer", "git push")).toMatchObject({ rule: "role-no-merge" });
    expect(bash("judge", "git push")).toBeNull();
  });
});

describe("checkDeliveryBash: a reporting role's shell", () => {
  it("refuses a command or process substitution", () => {
    expect(bash("judge", "echo $(ls)")).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("refuses a command that wraps or launches others", () => {
    vi.mocked(wrapsCommands).mockReturnValue(true);

    expect(bash("orchestrator", "xargs cat")).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("refuses a segment that sets an environment variable or changes shell state", () => {
    vi.mocked(setsEnvironment).mockReturnValue(true);

    expect(bash("judge", "KORE_ROOT=/x cat f")).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("refuses a segment the read allowlist does not list, naming it in the finding", () => {
    vi.mocked(readMayRun).mockReturnValue(false);

    expect(bash("judge", "rm f")).toEqual(
      hit("role-read-only", "`rm f` changes files"),
    );
  });

  it("refuses a write, and a harness command the role does not list", () => {
    vi.mocked(writes).mockReturnValue(true);
    expect(bash("judge", "tee out")).toMatchObject({ rule: "role-read-only" });

    vi.mocked(writes).mockReturnValue(false);
    vi.mocked(harnessAllowed).mockReturnValue(false);
    expect(bash("judge", `node ${HARNESS_PATH} idea new`)).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("lists `judge diff` for the judge and for no other delivery role", () => {
    const listed = (role: string): readonly string[] => {
      vi.mocked(harnessAllowed).mockClear();
      bash(role, `node ${HARNESS_PATH} judge diff 1`);
      return vi.mocked(harnessAllowed).mock.calls[0]?.[2] ?? [];
    };

    expect(listed("judge")).toContain("judge diff");
    expect(listed("orchestrator")).not.toContain("judge diff");
    expect(listed("writer")).not.toContain("judge diff");
  });

  it("points raw pane input at the finish notice", () => {
    vi.mocked(sendsToPane).mockReturnValue(true);

    expect(bash("orchestrator", "herdr pane send-text w3:p1 x")).toMatchObject({
      message: expect.stringContaining("session notify"),
    });
  });

  it("refuses a session notify that is not the one finish notice", () => {
    vi.mocked(notifiesFinish).mockReturnValue(false);

    expect(
      bash(
        "orchestrator",
        `node ${HARNESS_PATH} session notify w3:p1 --outcome maybe`,
      ),
    ).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("allows a read the allowlist lists, and returns no finding", () => {
    expect(bash("judge", "git log -n 3")).toBeNull();
  });
});

describe("checkDeliveryBash: a writer's shell and the worktree", () => {
  it("refuses a cd or git -C that leaves the worktree", () => {
    expect(bash("writer", "cd /etc")).toMatchObject({ rule: "role-worktree" });
    expect(bash("writer", "git -C /other status")).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("refuses a write to an absolute path outside the worktree", () => {
    vi.mocked(writes).mockReturnValue(true);

    expect(bash("writer", "tee /etc/hosts")).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("allows a write inside the worktree or to scratch space in tmp", () => {
    vi.mocked(writes).mockReturnValue(true);

    expect(bash("writer", "tee docs/a.md")).toBeNull();
    expect(bash("writer", "tee /tmp/x")).toBeNull();
  });

  it("ignores a path inside a word with whitespace, such as a commit message", () => {
    vi.mocked(writes).mockReturnValue(true);
    const message = ["git", "commit", "-m", "see /etc/x"];
    vi.mocked(splitSegments).mockReturnValue([message]);
    vi.mocked(withSubstitutions).mockReturnValue([message]);

    expect(bash("writer", "git commit")).toBeNull();
  });
});
