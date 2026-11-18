import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import {
  openSessionTarget,
  parseTimeout,
  settleSessionTarget,
} from "../session/index.js";
import { failed, repoOf } from "./judge-shared.js";
import { readChecks, type ChecksReport } from "./pr-checks.js";
import { harnessWait } from "./wait-command.js";

vi.mock("../session/index.js", () => ({
  openSessionTarget: vi.fn(),
  parseTimeout: vi.fn(),
  settleSessionTarget: vi.fn(),
}));
vi.mock("./judge-shared.js", () => ({
  failed: vi.fn(),
  repoOf: vi.fn(),
}));
vi.mock("./pr-checks.js", () => ({
  CHECKS_POLL_MS: 15_000,
  readChecks: vi.fn(),
}));

interface Fixture {
  context: CommandContext;
  stdout: ReturnType<typeof vi.fn<(text: string) => void>>;
  stderr: ReturnType<typeof vi.fn<(text: string) => void>>;
  runner: { run: ReturnType<typeof vi.fn> };
  sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;
}

/** A context whose clock moves only when the wait sleeps, so the bound is measured without a timer. */
function fixture(
  lists: Record<string, string[]>,
  options: Record<string, string | boolean> = {},
  json = false,
): Fixture {
  let elapsed = 0;
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const runner = { run: vi.fn() };
  const sleep = vi.fn((ms: number) => {
    elapsed += ms;
    return Promise.resolve();
  });
  const context = {
    json,
    options,
    lists,
    deps: {
      runner,
      clock: {
        now: () => new Date(Date.parse("2026-01-02T03:04:05.000Z") + elapsed),
        sleep,
      },
      root: () => Promise.resolve("/repo"),
      stdout,
      stderr,
    },
  } as unknown as CommandContext;
  return { context, stdout, stderr, runner, sleep };
}

function report(state: ChecksReport["state"]): ChecksReport {
  return { state, checks: [], failed: [], pending: [] };
}

/** A session target as openSessionTarget hands it back; the wait never looks inside it. */
const TARGET = { name: "image-trust-writer" } as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repoOf).mockResolvedValue("corekraft/kore");
  vi.mocked(failed).mockReturnValue(1);
  vi.mocked(parseTimeout).mockReturnValue(3_600_000);
});

describe("harness wait refuses a call it cannot run, before it reads anything", () => {
  it("refuses with usage when it names no target", async () => {
    const f = fixture({});

    expect(await harnessWait.run(f.context)).toBe(2);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      "Missing a target: name one or more with --pr <n>, --session <name>, --idea <name> or --any-idea, such as harness wait --pr 942.\n",
    );
    expect(readChecks).not.toHaveBeenCalled();
  });

  it("refuses a --pr that is not a pull request number, as JSON when asked", async () => {
    const f = fixture({ pr: ["x"] }, {}, true);

    expect(await harnessWait.run(f.context)).toBe(2);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      '{"error":"Invalid --pr \\"x\\": give a pull request number, such as --pr 942."}\n',
    );
    expect(readChecks).not.toHaveBeenCalled();
  });

  it("refuses a --timeout that parseTimeout rejects, and waits on nothing", async () => {
    vi.mocked(parseTimeout).mockReturnValue({
      error: "--timeout must be a positive whole number of milliseconds.",
    });
    const f = fixture({ pr: ["5"] }, { timeout: "0" });

    expect(await harnessWait.run(f.context)).toBe(2);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      "--timeout must be a positive whole number of milliseconds.\n",
    );
    expect(readChecks).not.toHaveBeenCalled();
  });

  it("refuses a session name the session domain rejects with its usage message", async () => {
    vi.mocked(openSessionTarget).mockResolvedValue({
      usage: "bad name, use a subject.",
    });
    const f = fixture({ session: ["x"] });

    expect(await harnessWait.run(f.context)).toBe(2);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      "bad name, use a subject.\n",
    );
  });

  it("refuses a session that was never spawned, with exit 1, and waits on nothing", async () => {
    vi.mocked(openSessionTarget).mockResolvedValue({
      error:
        "No session named ghost was spawned by this tool; start it with `session spawn`.",
    });
    const f = fixture({ session: ["ghost"] });

    expect(await harnessWait.run(f.context)).toBe(1);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      "No session named ghost was spawned by this tool; start it with `session spawn`.\n",
    );
    expect(settleSessionTarget).not.toHaveBeenCalled();
  });
});

describe("harness wait returns on the first target to settle", () => {
  it("settles on the first pull request to go green, names it, and leaves the rest to restart", async () => {
    const f = fixture({ pr: ["5", "7"] });
    vi.mocked(readChecks)
      .mockResolvedValueOnce(report("pending"))
      .mockResolvedValueOnce(report("green"));

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: PR #7 is green.\nRestart harness wait with the rest: --pr 5.\n",
    );
    expect(readChecks).toHaveBeenNthCalledWith(
      1,
      f.runner,
      "/repo",
      "corekraft/kore",
      5,
    );
    expect(readChecks).toHaveBeenNthCalledWith(
      2,
      f.runner,
      "/repo",
      "corekraft/kore",
      7,
    );
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it("returns at once for a pull request whose checks have already settled", async () => {
    const f = fixture({ pr: ["5"] });
    vi.mocked(readChecks).mockResolvedValue(report("red"));

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: PR #5 is red.\n",
    );
    expect(readChecks).toHaveBeenCalledOnce();
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it("polls every 15 seconds while every target is still pending", async () => {
    const f = fixture({ pr: ["5"] });
    vi.mocked(readChecks)
      .mockResolvedValueOnce(report("pending"))
      .mockResolvedValueOnce(report("pending"))
      .mockResolvedValueOnce(report("green"));

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.sleep.mock.calls).toEqual([[15_000], [15_000]]);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: PR #5 is green.\n",
    );
  });

  it("settles on a session whose RESULT line shows, and names its outcome", async () => {
    vi.mocked(openSessionTarget).mockResolvedValue({ target: TARGET });
    vi.mocked(settleSessionTarget).mockResolvedValue({ outcome: "blocked" });
    vi.mocked(readChecks).mockResolvedValue(report("pending"));
    const f = fixture({ pr: ["5"], session: ["image-trust-writer"] });

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: session image-trust-writer finished: RESULT blocked.\nRestart harness wait with the rest: --pr 5.\n",
    );
    expect(settleSessionTarget).toHaveBeenCalledWith(f.context.deps, TARGET);
  });
});

describe("harness wait stops at its bound, naming what is still pending", () => {
  it("exits 3 once the bound passes, naming the pending target and the next step", async () => {
    vi.mocked(parseTimeout).mockReturnValue(30_000);
    vi.mocked(readChecks).mockResolvedValue(report("pending"));
    const f = fixture({ pr: ["5"] }, { timeout: "30000" });

    expect(await harnessWait.run(f.context)).toBe(3);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "harness wait: the bound of 30 seconds passed with nothing settled. Still pending: PR #5. Next: read PR #5 with `harness pr checks 5`, then restart harness wait with --pr 5.\n",
    );
    expect(readChecks).toHaveBeenCalledTimes(3);
    expect(f.sleep.mock.calls).toEqual([[15_000], [15_000]]);
  });
});

describe("harness wait --json gives the same as one object", () => {
  it("prints the settled target, its kind and state, and the targets left to restart", async () => {
    vi.mocked(readChecks)
      .mockResolvedValueOnce(report("pending"))
      .mockResolvedValueOnce(report("green"));
    const f = fixture({ pr: ["5", "7"] }, {}, true);

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"outcome":"settled","kind":"pr","target":"7","state":"green","pending":[{"kind":"pr","target":"5"}]}\n',
    );
  });

  it("prints the bound, the pending targets and the next step, and exits 3", async () => {
    vi.mocked(parseTimeout).mockReturnValue(15_000);
    vi.mocked(readChecks).mockResolvedValue(report("pending"));
    const f = fixture({ pr: ["5"] }, { timeout: "15000" }, true);

    expect(await harnessWait.run(f.context)).toBe(3);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"outcome":"bound","pending":[{"kind":"pr","target":"5"}],"next":"Next: read PR #5 with `harness pr checks 5`, then restart harness wait with --pr 5."}\n',
    );
  });
});

describe("harness wait treats a failed read as a failure, not a result", () => {
  it("hands a gh error to the judge's failure path and settles nothing", async () => {
    const error = new Error("gh is not logged in");
    vi.mocked(readChecks).mockRejectedValue(error);
    const f = fixture({ pr: ["5"] });

    expect(await harnessWait.run(f.context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, error);
    expect(f.stdout).not.toHaveBeenCalled();
  });

  it("returns the pane read error as a failure, not a pending target", async () => {
    vi.mocked(openSessionTarget).mockResolvedValue({ target: TARGET });
    vi.mocked(settleSessionTarget).mockResolvedValue({
      error: "herdr pane read w3:p9 failed: no pane",
    });
    const f = fixture({ session: ["image-trust-writer"] });

    expect(await harnessWait.run(f.context)).toBe(1);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      "herdr pane read w3:p9 failed: no pane\n",
    );
    expect(f.stdout).not.toHaveBeenCalled();
  });
});
