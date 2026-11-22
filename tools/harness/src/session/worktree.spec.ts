import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { mainRoot } from "../runtime/index.js";
import { failed, fakeRunner, ok } from "./close-support.js";
import { describeFailure } from "./equalize.js";
import type { SessionRecord } from "./registry.js";
import { closeHint, place, removeHint } from "./worktree.js";

vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
const open = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ SessionRegistry: { open } }));
vi.mock("./equalize.js", () => ({
  describeFailure: vi.fn(() => "npm said no"),
}));

const WORKTREE = {
  path: "/main/.claude/worktrees/x",
  branch: "feat/x",
};
/** The worktree `place` creates for session x, on the branch named after it. */
const CREATED = { path: "/main/.claude/worktrees/x", branch: "x" };
const HARNESS = "/main/.claude/worktrees/x/tools/harness";
const KORE = "/main/.claude/worktrees/x/tools/kore";

/** The one step that fails: its command line, and the directory it runs in when that matters. */
interface Failing {
  line: string;
  cwd?: string;
}

/** A runner whose steps all succeed, except the one `failing` names. */
function runnerFailing(failing?: Failing) {
  return fakeRunner((command, args, options) => {
    const line = `${command} ${args.join(" ")}`;
    const hit =
      failing !== undefined &&
      line === failing.line &&
      (failing.cwd === undefined || options?.cwd === failing.cwd);
    return hit ? failed("boom") : ok();
  });
}

/** The command lines a spawn runs, in order. */
const lines = (run: { mock: { calls: unknown[][] } }) =>
  run.mock.calls.map(
    (call) => `${String(call[0])} ${(call[1] as string[]).join(" ")}`,
  );

const ADD = "git worktree add -b x /main/.claude/worktrees/x HEAD";
const BUILD = "npm run build --silent";

const exists = vi.fn<(path: string) => Promise<boolean>>();
const read = vi.fn<(name: string) => Promise<SessionRecord | undefined>>();

function deps(runner: ReturnType<typeof runnerFailing>): CliDeps {
  return {
    runner: runner.runner,
    cwd: "/main/caller",
    fs: { exists },
  } as unknown as CliDeps;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(describeFailure).mockReturnValue("npm said no");
  exists.mockResolvedValue(false);
  open.mockResolvedValue({ read });
});

describe("closeHint and removeHint", () => {
  it("names the worktree removal and the branch delete once the branch is merged", () => {
    expect(closeHint(WORKTREE)).toBe(
      "Remove its worktree once its branch is merged: `git worktree remove /main/.claude/worktrees/x` and `git branch -D feat/x`.",
    );
  });

  it("says a failed spawn left the worktree behind, and names the same two commands", () => {
    expect(removeHint(WORKTREE)).toBe(
      "The worktree /main/.claude/worktrees/x was left behind; remove it with `git worktree remove /main/.claude/worktrees/x` and `git branch -D feat/x`.",
    );
  });
});

describe("place without --worktree", () => {
  it("runs the pane in the caller's directory and creates nothing", async () => {
    const fake = runnerFailing();
    expect(await place(deps(fake), {}, "x")).toEqual({
      cwd: "/main/caller",
      left: "",
    });
    expect(fake.run).not.toHaveBeenCalled();
  });
});

describe("place with --worktree", () => {
  it("creates the worktree on a branch named after the session, installs and builds, then runs the pane there", async () => {
    const fake = runnerFailing();
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      worktree: CREATED,
      cwd: CREATED.path,
      left: ` ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci", "npm ci", BUILD]);
    expect(fake.run.mock.calls.map((call) => call[2])).toEqual([
      { cwd: "/main/caller" },
      { cwd: KORE },
      { cwd: HARNESS },
      { cwd: HARNESS },
    ]);
  });

  it("names the branch given with --branch", async () => {
    const fake = runnerFailing();
    await place(deps(fake), { worktree: true, branch: "feat/y" }, "x");
    expect(lines(fake.run)[0]).toBe(
      "git worktree add -b feat/y /main/.claude/worktrees/x HEAD",
    );
  });

  it("refuses to place outside a repository, naming KORE_ROOT, and runs nothing", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    const fake = runnerFailing();
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: expect.stringContaining("KORE_ROOT") as string,
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("stops at a failed worktree add, with no pane split and a removal hint", async () => {
    const fake = runnerFailing({ line: ADD });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `git worktree add failed: npm said no. No pane was split. A previous spawn may have left the worktree or branch: run \`git worktree remove /main/.claude/worktrees/x\` and \`git branch -D x\`, or pass --branch <other>.`,
    });
    expect(lines(fake.run)).toEqual([ADD]);
  });

  it("stops at a failed npm ci in the worktree, leaving it behind with a removal hint", async () => {
    const fake = runnerFailing({ line: "npm ci", cwd: KORE });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `npm ci failed in the new worktree: npm said no. No pane was split. ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci"]);
  });

  it("stops at a failed harness install, since the pane needs the harness bundle", async () => {
    const fake = runnerFailing({ line: "npm ci", cwd: HARNESS });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `npm ci failed for the harness in the new worktree: npm said no. No pane was split. ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci", "npm ci"]);
  });

  it("stops at a failed harness build, since the guard hook would block every tool call", async () => {
    const fake = runnerFailing({ line: BUILD });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `Building the harness bundle failed in the new worktree: npm said no. The pane's guard hook would block every tool call. No pane was split. ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci", "npm ci", BUILD]);
  });
});

/** A session record for x, recorded lost with its parent in the worktree place makes for it. */
function lostRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    name: "x",
    paneId: "t7",
    model: "m",
    role: "writer",
    effort: "high",
    createdAt: "2026-11-22T09:00:00.000Z",
    worktree: CREATED,
    result: {
      outcome: "blocked",
      at: "2026-11-22T10:00:00.000Z",
      summary: "lost with its parent: terminal t7 has finished",
    },
    ...overrides,
  };
}

const HEAD = "git rev-parse --abbrev-ref HEAD";

/** A runner whose branch check answers with the branch the existing worktree is on. */
function runnerOnBranch(branch: string) {
  return fakeRunner((command, args) =>
    command === "git" && args[0] === "rev-parse" ? ok(`${branch}\n`) : ok(),
  );
}

describe("place with --worktree over an existing path", () => {
  beforeEach(() => {
    exists.mockResolvedValue(true);
  });

  it("reuses the worktree of a session recorded lost with its parent: no git worktree add, then installs and builds", async () => {
    read.mockResolvedValue(lostRecord());
    const fake = runnerOnBranch("x");
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      worktree: CREATED,
      cwd: CREATED.path,
      left: ` ${removeHint(CREATED)}`,
    });
    expect(read).toHaveBeenCalledWith("x");
    expect(lines(fake.run)).toEqual([HEAD, "npm ci", "npm ci", BUILD]);
    expect(fake.run.mock.calls[0]?.[2]).toEqual({ cwd: CREATED.path });
  });

  it("refuses a path that no record names, and touches nothing", async () => {
    read.mockResolvedValue(undefined);
    const fake = runnerOnBranch("x");
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: expect.stringContaining(
        "/main/.claude/worktrees/x already exists and is not the worktree of a session recorded lost with its parent",
      ) as string,
    });
    expect((result as { error: string }).error).toContain("No pane was split.");
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("refuses a session recorded blocked for another reason", async () => {
    read.mockResolvedValue(
      lostRecord({
        result: {
          outcome: "blocked",
          at: "2026-11-22T10:00:00.000Z",
          summary: "waiting on the owner",
        },
      }),
    );
    const fake = runnerOnBranch("x");
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      error: expect.stringContaining("already exists") as string,
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("refuses a session that finished done, even when its summary starts the same", async () => {
    read.mockResolvedValue(
      lostRecord({
        result: {
          outcome: "done",
          at: "2026-11-22T10:00:00.000Z",
          summary: "lost with its parent",
        },
      }),
    );
    const fake = runnerOnBranch("x");
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      error: expect.stringContaining("already exists") as string,
    });
    expect(fake.run).not.toHaveBeenCalled();
  });
});

describe("place with --worktree over a path another session owns", () => {
  beforeEach(() => {
    exists.mockResolvedValue(true);
  });

  it("refuses a lost session whose record names another worktree path", async () => {
    read.mockResolvedValue(
      lostRecord({ worktree: { path: "/elsewhere/x", branch: "x" } }),
    );
    const fake = runnerOnBranch("x");
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      error: expect.stringContaining("already exists") as string,
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("refuses a lost session recorded on a different branch than the one asked for", async () => {
    read.mockResolvedValue(lostRecord());
    const fake = runnerOnBranch("x");
    expect(
      await place(deps(fake), { worktree: true, branch: "feat/y" }, "x"),
    ).toEqual({ error: expect.stringContaining("already exists") as string });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("refuses when the existing worktree is on another branch than the record names, and resets nothing", async () => {
    read.mockResolvedValue(lostRecord());
    const fake = runnerOnBranch("other");
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: expect.stringContaining(
        "/main/.claude/worktrees/x is on other, not x",
      ) as string,
    });
    expect(lines(fake.run)).toEqual([HEAD]);
  });

  it("refuses when git cannot read the existing worktree's branch, saying why", async () => {
    read.mockResolvedValue(lostRecord());
    const fake = runnerFailing({ line: HEAD });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: expect.stringContaining("npm said no") as string,
    });
    expect(lines(fake.run)).toEqual([HEAD]);
  });

  it("stops at a failed install in a reused worktree, with the removal hint", async () => {
    read.mockResolvedValue(lostRecord());
    const fake = fakeRunner((command, args, options) => {
      if (command === "npm" && options?.cwd === KORE) {
        return failed("boom");
      }
      return args[0] === "rev-parse" ? ok("x\n") : ok();
    });
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      error: `npm ci failed in the new worktree: npm said no. No pane was split. ${removeHint(CREATED)}`,
    });
  });
});
