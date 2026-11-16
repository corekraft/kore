import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { failed, prNumber, repoOf } from "./judge-shared.js";
import { prChecksRun } from "./pr-checks-command.js";
import {
  readChecks,
  waitForChecks,
  type ChecksReport,
  type CheckRun,
} from "./pr-checks.js";

vi.mock("./judge-shared.js", () => ({
  failed: vi.fn<(context: CommandContext, error: unknown) => number>(),
  prNumber: vi.fn<(operand: string | undefined, usage: string) => number>(),
  repoOf: vi.fn<(context: CommandContext) => Promise<string>>(),
}));
vi.mock("./pr-checks.js", () => ({
  CHECKS_BOUND_MS: 540_000,
  CHECKS_POLL_MS: 15_000,
  readChecks: vi.fn(),
  waitForChecks: vi.fn(),
}));

const URL = "https://github.com/corekraft/kore/actions/runs/1";
const check = (name: string, outcome: CheckRun["outcome"]): CheckRun => ({
  name,
  outcome,
  url: URL,
});

function fixture(
  options: Record<string, string | boolean>,
  json = false,
  operand: string | undefined = "9",
) {
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const context = {
    options,
    operand,
    json,
    deps: {
      runner: { run: vi.fn() },
      clock: { now: () => new Date(0), sleep: vi.fn() },
      root: () => Promise.resolve("/repo"),
      stdout,
      stderr,
    },
  } as unknown as CommandContext;
  return { context, stdout, stderr };
}

/** The outcome the wait returns, as the command receives it. */
function settled(
  state: ChecksReport["state"],
  checks: CheckRun[],
): ChecksReport {
  return {
    state,
    checks,
    failed: checks.filter((c) => c.outcome === "fail").map((c) => c.name),
    pending: checks.filter((c) => c.outcome === "pending").map((c) => c.name),
  };
}

beforeEach(() => {
  vi.mocked(prNumber).mockReset();
  vi.mocked(prNumber).mockReturnValue(9);
  vi.mocked(repoOf).mockReset();
  vi.mocked(repoOf).mockResolvedValue("corekraft/kore");
  vi.mocked(failed).mockReset();
  vi.mocked(failed).mockReturnValue(1);
  vi.mocked(readChecks).mockReset();
  vi.mocked(waitForChecks).mockReset();
});

describe("harness pr checks exits 0 on green, 1 on red and 2 while checks are still pending at the bound", () => {
  it("prints the passing count and exits 0 when every check passes", async () => {
    const f = fixture({ wait: true });
    vi.mocked(waitForChecks).mockResolvedValue(
      settled("green", [check("check", "pass"), check("scan", "pass")]),
    );
    expect(await prChecksRun(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(
      "green: 2 of 2 checks passed on PR #9\n",
    );
  });

  it("names each failed check with its URL and exits 1 on red", async () => {
    const f = fixture({ wait: true });
    vi.mocked(waitForChecks).mockResolvedValue(
      settled("red", [check("check", "pass"), check("scan", "fail")]),
    );
    expect(await prChecksRun(f.context)).toBe(1);
    expect(f.stdout).toHaveBeenCalledWith(
      `red: 1 failed check on PR #9: scan\n  scan ${URL}\n`,
    );
  });

  it("says CI is still pending, names the checks, and exits 2 at the bound", async () => {
    const f = fixture({ wait: true });
    vi.mocked(waitForChecks).mockResolvedValue(
      settled("pending", [
        check("check", "pass"),
        check("coverage", "pending"),
      ]),
    );
    expect(await prChecksRun(f.context)).toBe(2);
    expect(f.stdout).toHaveBeenCalledWith(
      "pending: CI still running on PR #9 after 9 minutes: coverage. Print RESULT with CI pending; the driver polls with ledger poll-github.\n",
    );
  });

  it("says no checks have appeared yet, and exits 2, when the PR reports none", async () => {
    const f = fixture({ wait: true });
    vi.mocked(waitForChecks).mockResolvedValue(settled("pending", []));
    expect(await prChecksRun(f.context)).toBe(2);
    expect(f.stdout).toHaveBeenCalledWith(
      "pending: no checks reported on PR #9 yet after 9 minutes. Print RESULT with CI pending; the driver polls with ledger poll-github.\n",
    );
  });

  it("drops the bound from the pending text when --wait is not given", async () => {
    const f = fixture({});
    vi.mocked(waitForChecks).mockResolvedValue(
      settled("pending", [check("coverage", "pending")]),
    );
    expect(await prChecksRun(f.context)).toBe(2);
    expect(f.stdout).toHaveBeenCalledWith(
      "pending: CI still running on PR #9: coverage. Print RESULT with CI pending; the driver polls with ledger poll-github.\n",
    );
  });
});

describe("harness pr checks waits through the injected clock, with the placeholder bound and no sleep of its own", () => {
  it("passes the wait flag, the placeholder bound and poll interval, and the clock to the wait", async () => {
    const f = fixture({ wait: true });
    vi.mocked(waitForChecks).mockResolvedValue(
      settled("green", [check("check", "pass")]),
    );
    await prChecksRun(f.context);
    expect(waitForChecks).toHaveBeenCalledWith(
      expect.any(Function),
      f.context.deps.clock,
      { wait: true, boundMs: 540_000, pollMs: 15_000 },
    );
  });

  it("reads the PR's checks through the runner in the repository named, from the checkout root", async () => {
    const f = fixture({ wait: true });
    vi.mocked(readChecks).mockResolvedValue(settled("green", []));
    vi.mocked(waitForChecks).mockImplementation(async (read) => {
      await read();
      return settled("green", []);
    });
    await prChecksRun(f.context);
    expect(readChecks).toHaveBeenCalledWith(
      f.context.deps.runner,
      "/repo",
      "corekraft/kore",
      9,
    );
  });
});

describe("harness pr checks --json prints the settled state, the checks and their failures", () => {
  it("prints one JSON object with the state, PR number, failed and pending names, and each check", async () => {
    const f = fixture({ wait: true }, true);
    vi.mocked(waitForChecks).mockResolvedValue(
      settled("red", [check("check", "pass"), check("scan", "fail")]),
    );
    expect(await prChecksRun(f.context)).toBe(1);
    expect(f.stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        state: "red",
        pr: 9,
        failed: ["scan"],
        pending: [],
        checks: [
          { name: "check", outcome: "pass", url: URL },
          { name: "scan", outcome: "fail", url: URL },
        ],
      })}\n`,
    );
  });
});

describe("harness pr checks refuses through the shared failure path, creating no output", () => {
  it("hands a gh or PR-number error to the shared failure path and exits with its code", async () => {
    const f = fixture({ wait: true });
    const error = new Error("gh pr view failed");
    vi.mocked(waitForChecks).mockRejectedValue(error);
    expect(await prChecksRun(f.context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, error);
    expect(f.stdout).not.toHaveBeenCalled();
  });
});
