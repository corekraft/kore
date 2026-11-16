import { describe, expect, it, vi } from "vitest";
import type { Clock, Runner } from "../runtime/index.js";
import {
  CHECKS_BOUND_MS,
  CHECKS_POLL_MS,
  checkRuns,
  readChecks,
  settle,
  waitForChecks,
  type CheckRun,
  type ChecksReport,
} from "./pr-checks.js";

const URL = "https://github.com/corekraft/kore/actions/runs/1";

/** A check run as gh reports it in statusCheckRollup. */
const run = (name: string, status: string, conclusion = "") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  detailsUrl: URL,
});

/** A commit status as gh reports it in statusCheckRollup, which has a state rather than a status. */
const status = (context: string, state: string) => ({
  __typename: "StatusContext",
  context,
  state,
  targetUrl: URL,
});

/** A clock whose sleep advances its own time, so a wait is measured without a real timer. */
function fakeClock(): Clock & { elapsed(): number } {
  let at = 0;
  return {
    now: () => new Date(at),
    sleep: (ms: number) => {
      at += ms;
      return Promise.resolve();
    },
    elapsed: () => at,
  };
}

const passing: CheckRun = { name: "check", outcome: "pass", url: URL };
const failing: CheckRun = { name: "scan", outcome: "fail", url: URL };
const waiting: CheckRun = { name: "coverage", outcome: "pending", url: URL };

const report = (
  state: ChecksReport["state"],
  checks: CheckRun[],
): ChecksReport => ({
  state,
  checks,
  failed: checks.filter((c) => c.outcome === "fail").map((c) => c.name),
  pending: checks.filter((c) => c.outcome === "pending").map((c) => c.name),
});

describe("a check run and a commit status classify to pass, fail or pending", () => {
  it("reads a completed successful, neutral or skipped check run as a pass", () => {
    expect(
      checkRuns({
        statusCheckRollup: [
          run("check", "COMPLETED", "SUCCESS"),
          run("lint", "COMPLETED", "NEUTRAL"),
          run("docs", "COMPLETED", "SKIPPED"),
        ],
      }),
    ).toEqual([
      { name: "check", outcome: "pass", url: URL },
      { name: "lint", outcome: "pass", url: URL },
      { name: "docs", outcome: "pass", url: URL },
    ]);
  });

  it("reads a completed check run with a failing conclusion as a fail, naming the check", () => {
    expect(
      checkRuns({
        statusCheckRollup: [run("scan", "COMPLETED", "FAILURE")],
      }),
    ).toEqual([{ name: "scan", outcome: "fail", url: URL }]);
  });

  it("reads a check run that has not completed as pending, never as a pass", () => {
    expect(
      checkRuns({
        statusCheckRollup: [
          run("check", "IN_PROGRESS"),
          run("scan", "QUEUED"),
          run("docs", "COMPLETED", ""),
        ],
      }),
    ).toEqual([
      { name: "check", outcome: "pending", url: URL },
      { name: "scan", outcome: "pending", url: URL },
      { name: "docs", outcome: "fail", url: URL },
    ]);
  });

  it("reads a commit status by its state: SUCCESS passes, PENDING and EXPECTED wait, anything else fails", () => {
    expect(
      checkRuns({
        statusCheckRollup: [
          status("a", "SUCCESS"),
          status("b", "PENDING"),
          status("c", "EXPECTED"),
          status("d", "ERROR"),
          status("e", "FAILURE"),
        ],
      }),
    ).toEqual([
      { name: "a", outcome: "pass", url: URL },
      { name: "b", outcome: "pending", url: URL },
      { name: "c", outcome: "pending", url: URL },
      { name: "d", outcome: "fail", url: URL },
      { name: "e", outcome: "fail", url: URL },
    ]);
  });

  it("reads no rollup at all as no checks, so the caller can wait for them to appear", () => {
    expect(checkRuns({ statusCheckRollup: [] })).toEqual([]);
    expect(checkRuns({})).toEqual([]);
  });
});

describe("settle decides green, red or pending from the check runs", () => {
  it("is pending, never green, while the PR has no checks yet", () => {
    expect(settle([])).toEqual(report("pending", []));
  });

  it("is green only when every check passes", () => {
    expect(settle([passing, passing])).toEqual(
      report("green", [passing, passing]),
    );
  });

  it("is red as soon as one check fails, naming only the failed checks, even while others still run", () => {
    const result = settle([passing, waiting, failing]);
    expect(result.state).toBe("red");
    expect(result.failed).toEqual(["scan"]);
    expect(result.pending).toEqual(["coverage"]);
  });

  it("is pending while checks run and none has failed", () => {
    expect(settle([passing, waiting]).state).toBe("pending");
  });
});

describe("readChecks reads the PR's check runs through the runner and gh, with the repository named", () => {
  function fixture(stdout: string, code = 0, stderr = "") {
    const runner = { run: vi.fn() };
    runner.run.mockResolvedValue({ code, stdout, stderr });
    return {
      runner: runner as unknown as Runner & { run: ReturnType<typeof vi.fn> },
    };
  }

  it("asks gh for the PR's status check rollup in the named repository and settles it", async () => {
    const f = fixture(
      JSON.stringify({
        statusCheckRollup: [run("check", "COMPLETED", "SUCCESS")],
      }),
    );
    expect(await readChecks(f.runner, "/repo", "corekraft/kore", 9)).toEqual(
      report("green", [passing]),
    );
    expect(f.runner.run).toHaveBeenCalledWith(
      "gh",
      [
        "pr",
        "view",
        "9",
        "--repo",
        "corekraft/kore",
        "--json",
        "statusCheckRollup",
      ],
      { cwd: "/repo" },
    );
  });

  it("refuses with the gh error when gh fails, and never reports a pass", async () => {
    const f = fixture("", 1, "no pull request found");
    await expect(
      readChecks(f.runner, "/repo", "corekraft/kore", 9),
    ).rejects.toThrow(/gh pr view failed for PR #9: no pull request found/);
  });

  it("refuses unreadable output rather than reading it as no checks", async () => {
    const f = fixture("not json");
    await expect(
      readChecks(f.runner, "/repo", "corekraft/kore", 9),
    ).rejects.toThrow(/unreadable output for PR #9/);
  });
});

describe("waitForChecks polls within the bound and never sleeps past it", () => {
  it("reads once and returns pending at once without waiting when --wait is not given", async () => {
    const clock = fakeClock();
    const read = vi.fn().mockResolvedValue(report("pending", [waiting]));
    const result = await waitForChecks(read, clock, {
      wait: false,
      boundMs: 60_000,
      pollMs: 15_000,
    });
    expect(result).toEqual(report("pending", [waiting]));
    expect(read).toHaveBeenCalledTimes(1);
    expect(clock.elapsed()).toBe(0);
  });

  it("returns green as soon as the checks settle green, after waiting for them", async () => {
    const clock = fakeClock();
    const read = vi
      .fn()
      .mockResolvedValueOnce(report("pending", [waiting]))
      .mockResolvedValueOnce(report("green", [passing]));
    const result = await waitForChecks(read, clock, {
      wait: true,
      boundMs: 60_000,
      pollMs: 15_000,
    });
    expect(result).toEqual(report("green", [passing]));
    expect(read).toHaveBeenCalledTimes(2);
    expect(clock.elapsed()).toBe(15_000);
  });

  it("returns red at once when a check fails, without waiting for the rest", async () => {
    const clock = fakeClock();
    const read = vi
      .fn()
      .mockResolvedValueOnce(report("pending", [waiting]))
      .mockResolvedValueOnce(report("red", [failing, waiting]));
    const result = await waitForChecks(read, clock, {
      wait: true,
      boundMs: 60_000,
      pollMs: 15_000,
    });
    expect(result.state).toBe("red");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("returns pending at the bound and does not sleep past it", async () => {
    const clock = fakeClock();
    const read = vi.fn().mockResolvedValue(report("pending", [waiting]));
    const result = await waitForChecks(read, clock, {
      wait: true,
      boundMs: 60_000,
      pollMs: 15_000,
    });
    expect(result.state).toBe("pending");
    // Reads at 0, 15, 30, 45 and 60 seconds; the read at the bound is the last.
    expect(read).toHaveBeenCalledTimes(5);
    expect(clock.elapsed()).toBe(60_000);
  });

  it("uses the placeholder bound under the 10 minute foreground limit", () => {
    expect(CHECKS_BOUND_MS).toBe(540_000);
    expect(CHECKS_BOUND_MS).toBeLessThan(10 * 60 * 1000);
    expect(CHECKS_POLL_MS).toBe(15_000);
  });
});
