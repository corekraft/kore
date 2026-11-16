// `guardrail replay`: flags in, the two refs' worktrees, the built guards, the transcripts and the
// runner faked, one JSON report out. It reads transcripts and the inventory, writes nothing, never
// reads the ledger, and removes both worktrees it opened.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDirs, readTranscripts } from "../hook/index.js";
import type { CliDeps, Runner, RunResult } from "../runtime/index.js";
import { fakeContext } from "./command-support.js";
import { guardrailReplay } from "./guardrail-replay-commands.js";

vi.mock("../hook/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hook/index.js")>()),
  defaultDirs: vi.fn(),
  readTranscripts: vi.fn(),
}));

const OLD = "old-ref";
const NEW = "new-ref";
const SHAS: Record<string, string> = { [OLD]: "aaaaaaa", [NEW]: "bbbbbbb" };
const ROOT = "/repo";
const INVENTORY = JSON.stringify({
  guardrails: [
    {
      rule: "unquoted-glob",
      kind: "bash",
      mode: "enforce",
      owner: "tools/harness/src/hook/guard-bash.ts",
    },
  ],
});
const SESSION = JSON.stringify({
  type: "assistant",
  timestamp: "2026-11-15T10:00:00.000Z",
  cwd: ROOT,
  message: {
    content: [
      {
        type: "tool_use",
        id: "t1",
        name: "Bash",
        input: { command: "ls *.ts" },
      },
    ],
  },
});

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
const refusal = (): RunResult => ({
  stdout: "",
  stderr: "[guard:unquoted-glob] no globs\n",
  code: 2,
});

interface Options {
  /** Whether the old ref's guard refuses the recorded command. */
  oldRefuses?: boolean;
  /** Whether the new ref's guard refuses it. */
  newRefuses?: boolean;
  /** When set, the named ref's worktree fails to build. */
  unbuildable?: string;
}

/** The command's context with the runner routed by the git, build and hook calls it makes. */
function setUp({
  oldRefuses = true,
  newRefuses = false,
  unbuildable,
}: Options = {}) {
  const reads: string[] = [];
  const removed: string[] = [];
  const opened: string[] = [];
  const runs: string[][] = [];
  let names = 0;
  const answer = (
    command: string,
    args: readonly string[],
    options?: { cwd?: string; input?: string },
  ): RunResult => {
    runs.push([command, ...args]);
    if (command === "git") {
      return gitAnswer(args, removed, opened);
    }
    if (args[0] === "build.mjs") {
      return buildAnswer(options?.cwd, unbuildable);
    }
    if (args[1] === "hook" && args[2] === "guard") {
      const refuses = options?.cwd?.includes("replay-a")
        ? oldRefuses
        : newRefuses;
      return hookAnswer(options?.input ?? "{}", refuses);
    }
    return ok();
  };
  const runner = {
    run: vi.fn(
      async (
        command: string,
        args: readonly string[],
        options?: { cwd?: string; input?: string },
      ) => answer(command, args, options),
    ),
  };
  const fs = {
    readFile: vi.fn(async (path: string) => {
      reads.push(path);
      if (path === `${ROOT}/.claude/guardrails.yaml`) {
        return INVENTORY;
      }
      throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
    }),
  };
  vi.mocked(defaultDirs).mockResolvedValue(["/home/.claude/projects/repo"]);
  vi.mocked(readTranscripts).mockResolvedValue([{ id: "s1", text: SESSION }]);
  const made = fakeContext();
  made.deps.runner = runner as unknown as Runner;
  made.deps.fs = fs as unknown as CliDeps["fs"];
  made.deps.ids = { next: () => (names++ === 0 ? "a" : "b") };
  return {
    context: made.context,
    out: made.out,
    err: made.err,
    reads,
    removed,
    opened,
    runs,
  };
}

/** A build in the worktree at `cwd` fails when that worktree is the one named unbuildable. */
function buildAnswer(cwd: string | undefined, unbuildable?: string): RunResult {
  return unbuildable !== undefined && cwd?.includes(unbuildable)
    ? { stdout: "", stderr: "esbuild failed\n", code: 1 }
    : ok();
}

/** The guard's answer to a payload: a refusal for the recorded command when the ref refuses it. */
function hookAnswer(input: string, refuses: boolean): RunResult {
  const payload = JSON.parse(input) as {
    session_id?: string;
    tool_input: { command?: string };
  };
  if (payload.session_id !== undefined) {
    throw new Error(
      "the replay must not name a session, or the guard records to the ledger",
    );
  }
  return refuses && payload.tool_input.command === "ls *.ts" ? refusal() : ok();
}

/** git's answers: rev-parse for the refs and the main checkout, worktree add and remove. */
function gitAnswer(
  args: readonly string[],
  removed: string[],
  opened: string[],
): RunResult {
  if (args.includes("--git-common-dir")) {
    return ok(`${ROOT}/.git\n`);
  }
  if (args[0] === "rev-parse") {
    const ref = (args[args.length - 1] ?? "").replace(/\^\{commit\}$/, "");
    return SHAS[ref] === undefined
      ? { stdout: "", stderr: "", code: 128 }
      : ok(`${SHAS[ref]}\n`);
  }
  if (args[0] === "worktree" && args[1] === "add") {
    opened.push(args[3] ?? "");
    return ok();
  }
  if (args[0] === "worktree" && args[1] === "remove") {
    removed.push(args[3] ?? "");
    return ok();
  }
  return ok();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guardrail replay rejects a request it cannot answer", () => {
  it("names the missing flag and the form to run, and writes nothing", async () => {
    const { context, out, err, runs } = setUp();
    context.options = { rule: "unquoted-glob", old: OLD, new: NEW, until: "" };

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain("Missing --since");
    expect(err()).toContain("harness guardrail replay --rule");
    expect(out()).toBe("");
    expect(runs).toEqual([]);
  });

  it("refuses a window that is neither a date nor a UTC timestamp", async () => {
    const { context, err } = setUp();
    context.options = {
      rule: "unquoted-glob",
      old: OLD,
      new: NEW,
      since: "last tuesday",
    };

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain('"last tuesday" is not a date');
  });

  it("refuses a rule the inventory does not name", async () => {
    const { context, err } = setUp();
    context.options = {
      rule: "no-such-rule",
      old: OLD,
      new: NEW,
      since: "2026-11-15T00:00:00Z",
    };

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain("no-such-rule is not a guardrail rule");
  });

  it("refuses a ref that is not a commit, naming it, and opens no worktree", async () => {
    const { context, err, opened } = setUp();
    context.options = {
      rule: "unquoted-glob",
      old: "missing",
      new: NEW,
      since: "2026-11-15T00:00:00Z",
    };

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain("missing is not a commit");
    expect(opened).toEqual([]);
  });
});

describe("guardrail replay lists what changed", () => {
  const options = {
    rule: "unquoted-glob",
    old: OLD,
    new: NEW,
    since: "2026-11-15T00:00:00Z",
    until: "2026-11-16T00:00:00Z",
  };

  it("lists the calls the old guard refused and the new one allows, with both commits and the window", async () => {
    const { context, out } = setUp();
    context.options = options;

    expect(await guardrailReplay.run(context)).toBe(0);
    expect(JSON.parse(out())).toEqual({
      rule: "unquoted-glob",
      old: "aaaaaaa",
      new: "bbbbbbb",
      since: "2026-11-15T00:00:00.000Z",
      until: "2026-11-16T00:00:00.000Z",
      examined: 1,
      empty: false,
      changed: [
        {
          session: "s1",
          line: 1,
          at: "2026-11-15T10:00:00.000Z",
          tool: "Bash",
          command: "ls *.ts",
        },
      ],
    });
  });

  it("states an empty result as empty when the new guard still refuses the call", async () => {
    const { context, out } = setUp({ newRefuses: true });
    context.options = options;

    expect(await guardrailReplay.run(context)).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      examined: 1,
      empty: true,
      changed: [],
    });
  });

  it("removes both worktrees it opened, the one at each ref", async () => {
    const { context, removed } = setUp();
    context.options = options;

    await guardrailReplay.run(context);

    expect(removed.sort()).toEqual([
      "/repo/.claude/worktrees/replay-a",
      "/repo/.claude/worktrees/replay-b",
    ]);
  });
});

describe("guardrail replay writes nothing and leaves no worktree behind", () => {
  const options = {
    rule: "unquoted-glob",
    old: OLD,
    new: NEW,
    since: "2026-11-15T00:00:00Z",
    until: "2026-11-16T00:00:00Z",
  };

  it("reads the transcripts and the inventory, and writes nothing and never names the ledger", async () => {
    const { context, reads, runs } = setUp();
    context.options = options;

    await guardrailReplay.run(context);

    expect(readTranscripts).toHaveBeenCalledWith(expect.anything(), [
      "/home/.claude/projects/repo",
    ]);
    expect(reads).toEqual([`${ROOT}/.claude/guardrails.yaml`]);
    const writes = runs.filter(([, ...args]) =>
      args.some(
        (arg) => arg.includes("ledger") || arg.includes("guardrails.yaml"),
      ),
    );
    expect(writes).toEqual([]);
  });

  it("removes the worktree it opened, and fails naming the ref, when a guard does not build", async () => {
    const { context, err, removed } = setUp({ unbuildable: "replay-a" });
    context.options = options;

    expect(await guardrailReplay.run(context)).toBe(1);
    expect(err()).toContain(
      "the guard at aaaaaaa did not build: esbuild failed",
    );
    expect(removed).toEqual(["/repo/.claude/worktrees/replay-a"]);
  });
});
