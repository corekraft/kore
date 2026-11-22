import { beforeEach, describe, expect, it, vi } from "vitest";
import { settledReads, type Tool } from "./review-settled.js";

vi.mock("../judge/index.js", () => {
  class ErrorStandIn extends Error {}
  return { JudgeError: ErrorStandIn };
});

const harness = vi.fn<(...args: string[]) => Promise<string>>();
const tool = vi.fn<Tool>();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("settledReads on herdr reads the pane a session settled in", () => {
  it("reads the unwrapped text of the pane, through herdr, by session name", async () => {
    harness.mockResolvedValue(
      JSON.stringify({ outcome: "done", paneId: "p1" }),
    );
    tool.mockResolvedValue("TEXT");
    const reads = settledReads(harness, tool, "herdr");

    await reads.wait("s1");

    expect(await reads.read("s1")).toBe("TEXT");
    expect(harness).toHaveBeenCalledExactlyOnceWith(
      "session",
      "wait",
      "s1",
      "--json",
    );
    expect(tool).toHaveBeenCalledExactlyOnceWith(
      "herdr",
      ["pane", "read", "p1", "--source", "recent-unwrapped"],
      "herdr pane read of session s1",
    );
  });

  it("refuses a session whose wait named no pane, and reads nothing", async () => {
    harness.mockResolvedValue(JSON.stringify({ outcome: "done" }));
    const reads = settledReads(harness, tool, "herdr");
    await reads.wait("s1");

    await expect(reads.read("s1")).rejects.toThrow(
      /named no pane, so its text is not read/,
    );
    expect(tool).not.toHaveBeenCalled();
  });
});

describe("settledReads on hc reads the summary its wait printed, never a pane", () => {
  it("returns the summary the wait printed and reads no pane, even when the wait named one", async () => {
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
    const reads = settledReads(harness, tool, "hc");
    await reads.wait("s1");

    expect(await reads.read("s1")).toBe("VERDICT: none");
    expect(tool).not.toHaveBeenCalled();
  });

  it("gives the outcome of a blocked wait without reading anything", async () => {
    harness.mockResolvedValue(
      JSON.stringify({ name: "s1", model: "m", outcome: "blocked" }),
    );
    const reads = settledReads(harness, tool, "hc");

    expect(await reads.wait("s1")).toEqual({ outcome: "blocked" });
  });

  it("refuses a session that settled without a report, and names the fix", async () => {
    harness.mockResolvedValue(
      JSON.stringify({ name: "s1", model: "m", outcome: "done" }),
    );
    const reads = settledReads(harness, tool, "hc");
    await reads.wait("s1");

    await expect(reads.read("s1")).rejects.toThrow(
      /settled without a report, so its text is not read\. Rerun it; its last action must be `node skills\/bin\/harness\.mjs session report`\./,
    );
    expect(tool).not.toHaveBeenCalled();
  });
});

describe("settledReads refuses a session it has not waited for, on either backend", () => {
  it.each(["herdr", "hc"] as const)(
    "refuses on %s before any wait",
    async (backend) => {
      const reads = settledReads(harness, tool, backend);

      await expect(reads.read("s1")).rejects.toThrow(
        /has not settled, so its text is not read/,
      );
      expect(harness).not.toHaveBeenCalled();
      expect(tool).not.toHaveBeenCalled();
    },
  );
});
