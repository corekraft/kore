import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DecisionError,
  decisionFlagOn,
  postDigest,
  type DigestPorts,
  type DigestResult,
} from "../decision/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { digestCommands } from "./decision-digest-commands.js";
import { openLedger } from "./ledger-commands.js";

vi.mock("../decision/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../decision/index.js")>()),
  decisionFlagOn: vi.fn(),
  postDigest: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const ROOT = "/repo";
const POSTED: DigestResult = {
  posted: true,
  commentUrl: "https://github.com/corekraft/kore/issues/900#c3",
  open: 2,
  blocking: 1,
  tickGap: false,
};

function fakeDeps() {
  return {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: {
      run: vi.fn(() =>
        Promise.resolve({
          code: 0,
          stdout: "https://github.com/corekraft/kore/issues/900#c3",
          stderr: "",
        }),
      ),
    },
    clock: {
      now: vi.fn(() => new Date("2026-11-17T12:00:00Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
    env: {},
  };
}

function context(options: Record<string, string | boolean> = {}, json = false) {
  const deps = fakeDeps();
  return { ctx: contextWith(deps, options, json), deps };
}

/** The ports the command handed to postDigest. */
function portsOf(): DigestPorts {
  return vi.mocked(postDigest).mock.calls[0]?.[0] as DigestPorts;
}

const digest = digestCommands["digest"];

beforeEach(() => {
  vi.mocked(postDigest).mockResolvedValue(POSTED);
  vi.mocked(decisionFlagOn).mockResolvedValue(true);
  vi.mocked(openLedger).mockResolvedValue({
    ledger: fakeLedger([{ id: "e1", kind: "decision.routed" }]).ledger,
  });
});

describe("decision digest", () => {
  it("posts the digest from the ledger's events and says where it went", async () => {
    const { ctx, deps } = context();

    expect(await digest?.run(ctx)).toBe(0);

    expect(postDigest).toHaveBeenCalledWith(expect.anything(), {
      events: [{ id: "e1", kind: "decision.routed" }],
      now: new Date("2026-11-17T12:00:00Z"),
    });
    expect(deps.stdout).toHaveBeenCalledWith(
      "Posted the owner digest: https://github.com/corekraft/kore/issues/900#c3 (2 open, 1 blocking).\n",
    );
  });

  it("says the tick is not running in the line it prints when the tick gap is in the digest", async () => {
    vi.mocked(postDigest).mockResolvedValue({ ...POSTED, tickGap: true });
    const { ctx, deps } = context();

    await digest?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(
      "Posted the owner digest: https://github.com/corekraft/kore/issues/900#c3 (2 open, 1 blocking, the tick is not running).\n",
    );
  });

  it("says when the next digest is due, and posts nothing, when one was posted within the day", async () => {
    vi.mocked(postDigest).mockResolvedValue({
      posted: false,
      reason: "not-due",
      nextAt: "2026-11-18T06:00:00.000Z",
    });
    const { ctx, deps } = context();

    expect(await digest?.run(ctx)).toBe(0);

    expect(deps.stdout).toHaveBeenCalledWith(
      "The owner digest is not due until 2026-11-18T06:00:00.000Z.\n",
    );
  });

  it("says there is nothing to report when no question is open and the tick is running", async () => {
    vi.mocked(postDigest).mockResolvedValue({
      posted: false,
      reason: "nothing-to-report",
    });
    const { ctx, deps } = context();

    await digest?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(
      "Nothing to report: no open reserved question, and the tick is running.\n",
    );
  });

  it("prints the result as one JSON object under --json", async () => {
    const { ctx, deps } = context({}, true);

    await digest?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(`${JSON.stringify(POSTED)}\n`);
  });

  it("prints a refusal, and exits 1, when no issue is pinned", async () => {
    vi.mocked(postDigest).mockRejectedValue(
      new DecisionError("No issue is pinned for the owner digest."),
    );
    const { ctx, deps } = context();

    expect(await digest?.run(ctx)).toBe(1);

    expect(deps.stderr).toHaveBeenCalledWith(
      "No issue is pinned for the owner digest.\n",
    );
  });
});

describe("decision digest ports", () => {
  it("reads the pinned issue through gh's GraphQL, from the runner, in the repository root", async () => {
    const { ctx, deps } = context();
    await digest?.run(ctx);
    vi.mocked(deps.runner.run).mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            pinnedIssues: {
              nodes: [
                {
                  issue: {
                    url: "https://github.com/corekraft/kore/issues/900",
                  },
                },
              ],
            },
          },
        },
      }),
      stderr: "",
    });

    expect(await portsOf().pinned()).toEqual({
      number: "900",
      repo: "corekraft/kore",
    });
    expect(deps.runner.run).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["api", "graphql"]),
      { cwd: ROOT },
    );
  });

  it("posts the digest as a comment on the pinned issue, then records decision.digest at the posting time", async () => {
    const { ctx, deps } = context();
    await digest?.run(ctx);

    const url = await portsOf().post(
      { number: "900", repo: "corekraft/kore" },
      "BODY",
    );
    const recorded = await portsOf().record("2026-11-17T12:00:00.000Z");

    expect(url).toBe("https://github.com/corekraft/kore/issues/900#c3");
    expect(deps.runner.run).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "900", "--repo", "corekraft/kore", "--body", "BODY"],
      { cwd: ROOT },
    );
    expect(recorded).toEqual({ ok: true });
  });
});
