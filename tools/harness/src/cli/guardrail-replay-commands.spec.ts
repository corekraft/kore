// `guardrail replay`: flags in, the two guard versions and the transcripts faked, one JSON
// report out. It reads transcripts and the inventory, and never the ledger.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GuardAtRefError,
  defaultDirs,
  guardAtRef,
  readTranscripts,
  type Evaluate,
} from "../hook/index.js";
import type { CliDeps } from "../runtime/index.js";
import { fakeContext } from "./command-support.js";
import { guardrailReplay } from "./guardrail-replay-commands.js";

vi.mock("../hook/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hook/index.js")>()),
  guardAtRef: vi.fn(),
  defaultDirs: vi.fn(),
  readTranscripts: vi.fn(),
}));

const OLD = "old-ref";
const NEW = "new-ref";
const SHAS: Record<string, string> = { [OLD]: "aaaaaaa", [NEW]: "bbbbbbb" };
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
const SESSION = [
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-15T10:00:00.000Z",
    cwd: "/repo",
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
  }),
].join("\n");

const refused: Evaluate = async () => ({
  action: "block",
  rule: "unquoted-glob",
  message: "[guard:unquoted-glob]",
});
const allowed: Evaluate = async () => ({ action: "allow" });

const OPTIONS = {
  rule: "unquoted-glob",
  old: OLD,
  new: NEW,
  since: "2026-11-15T00:00:00Z",
  until: "2026-11-16T00:00:00Z",
};

interface Fakes {
  refusedBefore?: boolean;
  allowedAfter?: boolean;
  failing?: boolean;
  refs?: Record<string, string>;
}

/** The command's context with the runner, file system and guard loader faked. */
function setUp({
  refusedBefore = true,
  allowedAfter = true,
  failing = false,
  refs = SHAS,
}: Fakes = {}) {
  const reads: string[] = [];
  const runner = {
    run: vi.fn(async (_command: string, args: readonly string[]) => {
      const ref = (args[args.length - 1] ?? "").replace(/\^\{commit\}$/, "");
      const sha = refs[ref];
      return sha === undefined
        ? { stdout: "", stderr: "", code: 128 }
        : { stdout: `${sha}\n`, stderr: "", code: 0 };
    }),
  };
  const fs = {
    readFile: vi.fn(async (path: string) => {
      reads.push(path);
      if (path === "/repo/.claude/guardrails.yaml") {
        return INVENTORY;
      }
      throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
    }),
  };
  vi.mocked(defaultDirs).mockResolvedValue(["/home/.claude/projects/repo"]);
  vi.mocked(readTranscripts).mockResolvedValue([{ id: "s1", text: SESSION }]);
  vi.mocked(guardAtRef).mockImplementation(async (_runner, _root, sha) => {
    if (failing) {
      throw new GuardAtRefError(`${sha} has no guard`);
    }
    if (sha === SHAS[OLD]) {
      return refusedBefore ? refused : allowed;
    }
    return allowedAfter ? allowed : refused;
  });
  const made = fakeContext();
  made.deps.runner = runner as unknown as CliDeps["runner"];
  made.deps.fs = fs as unknown as CliDeps["fs"];
  return { context: made.context, out: made.out, err: made.err, reads };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guardrail replay rejects a request it cannot answer", () => {
  it("names the missing flag and the form to run, and writes nothing", async () => {
    const { context, out, err } = setUp();
    context.options = { ...OPTIONS, since: undefined } as never;

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain("Missing --since");
    expect(err()).toContain("harness guardrail replay --rule");
    expect(out()).toBe("");
  });

  it("refuses a window that is neither a date nor a UTC timestamp", async () => {
    const { context, err } = setUp();
    context.options = { ...OPTIONS, since: "last tuesday" };

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain('"last tuesday" is not a date');
  });

  it("refuses a rule the inventory does not name", async () => {
    const { context, err } = setUp();
    context.options = { ...OPTIONS, rule: "no-such-rule" };

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain("no-such-rule is not a guardrail rule");
  });

  it("refuses a ref that is not a commit, naming it", async () => {
    const { context, err } = setUp({ refs: { [NEW]: "bbbbbbb" } });
    context.options = OPTIONS;

    expect(await guardrailReplay.run(context)).toBe(2);
    expect(err()).toContain(`${OLD} is not a commit`);
  });
});

describe("guardrail replay lists what changed", () => {
  it("lists the calls the old rule refused and the new one allows, with both commits and the window", async () => {
    const { context, out } = setUp();
    context.options = OPTIONS;

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

  it("states an empty result as empty when the new rule still refuses the call", async () => {
    const { context, out } = setUp({ allowedAfter: false });
    context.options = OPTIONS;

    expect(await guardrailReplay.run(context)).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      examined: 1,
      empty: true,
      changed: [],
    });
  });

  it("reads the transcripts and the inventory, and never the ledger", async () => {
    const { context, reads } = setUp();
    context.options = OPTIONS;

    await guardrailReplay.run(context);

    expect(readTranscripts).toHaveBeenCalledWith(expect.anything(), [
      "/home/.claude/projects/repo",
    ]);
    expect(reads).toEqual(["/repo/.claude/guardrails.yaml"]);
    expect(reads.some((path) => path.includes("ledger"))).toBe(false);
  });

  it("fails naming the ref whose guard cannot be loaded", async () => {
    const { context, err } = setUp({ failing: true });
    context.options = OPTIONS;

    expect(await guardrailReplay.run(context)).toBe(1);
    expect(err()).toContain("aaaaaaa has no guard");
  });
});
