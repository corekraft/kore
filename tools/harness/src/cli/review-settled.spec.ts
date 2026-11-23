import { beforeEach, describe, expect, it, vi } from "vitest";
import { settledReads } from "./review-settled.js";

vi.mock("../judge/index.js", () => {
  class ErrorStandIn extends Error {}
  return { JudgeError: ErrorStandIn };
});

const harness = vi.fn<(...args: string[]) => Promise<string>>();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("settledReads reads the summary a session's wait printed, never a terminal", () => {
  it("returns the summary the wait printed, and runs no terminal read", async () => {
    harness.mockResolvedValue(
      JSON.stringify({
        name: "s1",
        paneId: "t2",
        model: "m",
        outcome: "done",
        summary: "VERDICT: none",
        seq: 1,
      }),
    );
    const reads = settledReads(harness);
    await reads.wait("s1");

    expect(await reads.read("s1")).toBe("VERDICT: none");
    expect(harness).toHaveBeenCalledExactlyOnceWith(
      "session",
      "wait",
      "s1",
      "--json",
    );
  });

  it("gives the outcome of a blocked wait", async () => {
    harness.mockResolvedValue(
      JSON.stringify({ name: "s1", model: "m", outcome: "blocked" }),
    );
    const reads = settledReads(harness);

    expect(await reads.wait("s1")).toEqual({ outcome: "blocked" });
  });

  it("refuses a session that settled without a report, and names the fix", async () => {
    harness.mockResolvedValue(
      JSON.stringify({ name: "s1", model: "m", outcome: "done" }),
    );
    const reads = settledReads(harness);
    await reads.wait("s1");

    await expect(reads.read("s1")).rejects.toThrow(
      /settled without a report, so its text is not read\. Rerun it; its last action must be `node skills\/bin\/harness\.mjs session report`\./,
    );
  });

  it("refuses a session it has not waited for, before any harness call", async () => {
    const reads = settledReads(harness);

    await expect(reads.read("s1")).rejects.toThrow(
      /has not settled, so its text is not read/,
    );
    expect(harness).not.toHaveBeenCalled();
  });
});
