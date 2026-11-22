import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals, terminalError } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import {
  asRegistry,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import type { SessionRecord } from "./registry.js";
import { readReport, reportPath, type Report } from "./report-file.js";
import { formatReportWait, waitForReport } from "./wait-hc.js";

vi.mock("./backend.js");
vi.mock("./report-file.js");

const RECORD: SessionRecord = {
  version: 1,
  backend: "hc",
  terminal: "t2",
  name: "image-trust-writer",
  paneId: "t2",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const REPORT = "/work/writer/.kore/report/image-trust-writer.json";
const TIMEOUT_MS = 60_000;
const DONE_RESULT = {
  outcome: "done",
  summary: "Opened PR #5.",
  at: "2026-01-02T03:04:05.000Z",
};
const STOPPED = {
  ...RECORD,
  result: {
    outcome: "blocked",
    summary: "stopped without a report",
    at: "2026-01-02T03:04:05.000Z",
  },
};
const FIRST_WRITE = { ...RECORD, reportSeq: 1, result: DONE_RESULT };
const REWORK_RESULT = {
  outcome: "done",
  summary: "Fixed the review.",
  at: "2026-01-02T03:04:05.000Z",
};

let deps: FakeDeps;
let registry: FakeRegistry;
let terminals: FakeTerminals;
/** What the report file holds now: undefined when the session has not written one. */
let onDisk: Report | undefined;

function report(
  seq: number,
  outcome: "done" | "blocked",
  summary: string,
): Report {
  return { seq, outcome, summary, at: "2026-01-02T03:04:05.000Z" };
}

function waitFor(record: SessionRecord = RECORD, timeoutMs = TIMEOUT_MS) {
  return waitForReport(
    deps,
    terminals,
    asRegistry(registry),
    record,
    timeoutMs,
  );
}

beforeEach(async () => {
  deps = fakeDeps();
  registry = fakeRegistry();
  terminals = new FakeTerminals();
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
  });
  onDisk = undefined;
  vi.mocked(reportPath).mockReturnValue(REPORT);
  vi.mocked(readReport).mockImplementation(async () => onDisk);
});

describe("waitForReport reads a report the session has not consumed", () => {
  it("returns it, records its seq as consumed, and never waits when it is already there", async () => {
    onDisk = report(1, "done", "Opened PR #5.");
    const waitSpy = vi.spyOn(terminals, "wait");

    const result = await waitFor();

    expect(reportPath).toHaveBeenCalledWith(
      "/work/writer",
      "image-trust-writer",
    );
    expect(result).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "done",
      summary: "Opened PR #5.",
      seq: 1,
    });
    expect(registry.write).toHaveBeenCalledWith(FIRST_WRITE);
    expect(waitSpy).not.toHaveBeenCalled();
  });

  it("waits for the terminal to stop, then reads the report it wrote meanwhile", async () => {
    const waitSpy = vi.spyOn(terminals, "wait");

    const pending = waitFor();
    await vi.waitFor(() => {
      expect(waitSpy).toHaveBeenCalledWith({ terminal: "t2" }, TIMEOUT_MS);
    });
    onDisk = report(1, "done", "Opened PR #5.");
    terminals.finish("t2", 0);

    expect(await pending).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "done",
      summary: "Opened PR #5.",
      seq: 1,
    });
    expect(registry.write).toHaveBeenCalledWith(FIRST_WRITE);
  });

  it("takes a second report after rework by its higher seq, and ignores one already consumed", async () => {
    const consumed = { ...RECORD, reportSeq: 1 };
    onDisk = report(2, "done", "Fixed the review.");

    const second = await waitFor(consumed);

    expect(second).toMatchObject({
      outcome: "done",
      summary: "Fixed the review.",
      seq: 2,
    });
    expect(registry.write).toHaveBeenCalledWith({
      ...consumed,
      reportSeq: 2,
      result: REWORK_RESULT,
    });

    vi.clearAllMocks();
    vi.mocked(reportPath).mockReturnValue(REPORT);
    vi.mocked(readReport).mockImplementation(async () => onDisk);
    onDisk = report(1, "done", "Opened PR #5.");
    terminals.emit("t2", "Ran the tests.\n");
    terminals.finish("t2", 0);

    const stale = await waitFor(consumed);

    expect(stale).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "stopped without a report\nRan the tests.",
    });
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("waitForReport never reports done without a report", () => {
  it.each(["blocked", "error"] as const)(
    "returns blocked at once, without waiting, when the terminal reports %s",
    async (status) => {
      terminals.setStatus("t2", status);
      const waitSpy = vi.spyOn(terminals, "wait");

      expect(await waitFor()).toStrictEqual({
        name: "image-trust-writer",
        model: "claude-sonnet-5-5",
        outcome: "blocked",
        summary: `reported ${status} and wrote no report`,
      });
      expect(waitSpy).not.toHaveBeenCalled();
    },
  );

  it("returns blocked, stopped without a report, with the last lines the terminal printed", async () => {
    terminals.emit("t2", "Ran the tests.\nNo PR was opened.\n");
    terminals.finish("t2", 1);

    expect(await waitFor()).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "stopped without a report\nRan the tests.\nNo PR was opened.",
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith(STOPPED);
  });

  it("returns blocked, stopped without a report and no lines, when the terminal printed nothing", async () => {
    terminals.finish("t2", 0);

    expect(await waitFor()).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "stopped without a report",
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith(STOPPED);
  });

  it("fails as still working on a timeout with no report and no stop, naming the command to run again", async () => {
    vi.spyOn(terminals, "wait").mockResolvedValue(
      terminalError(
        "timeout",
        "nothing has finished within 60000 ms",
        "wait longer, or check the terminal with get()",
      ),
    );

    expect(await waitFor()).toStrictEqual({
      error:
        "Session image-trust-writer is still working: no report and no stop within 60 seconds. Run session wait image-trust-writer again, or read the terminal with hc read t2.",
    });
  });

  it("returns blocked, not still working, when the terminal turns blocked while the wait runs out", async () => {
    vi.spyOn(terminals, "wait").mockImplementation(async () => {
      terminals.setStatus("t2", "blocked");
      return terminalError("timeout", "nothing has finished within 60000 ms");
    });

    expect(await waitFor()).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "reported blocked and wrote no report",
    });
  });
});

describe("waitForReport records a blocked terminal's outcome so close can settle it", () => {
  const blockedResult = (status: string): SessionRecord => ({
    ...RECORD,
    result: {
      outcome: "blocked",
      summary: `reported ${status} and wrote no report`,
      at: "2026-01-02T03:04:05.000Z",
    },
  });

  it.each(["blocked", "error"] as const)(
    "records the result when the terminal reports %s at once",
    async (status) => {
      terminals.setStatus("t2", status);

      await waitFor();

      expect(registry.write).toHaveBeenCalledExactlyOnceWith(
        blockedResult(status),
      );
    },
  );

  it("records the result when the terminal turns blocked while the wait runs out", async () => {
    vi.spyOn(terminals, "wait").mockImplementation(async () => {
      terminals.setStatus("t2", "blocked");
      return terminalError("timeout", "nothing has finished within 60000 ms");
    });

    await waitFor();

    expect(registry.write).toHaveBeenCalledExactlyOnceWith(
      blockedResult("blocked"),
    );
  });

  it("keeps a result a consumed report already recorded", async () => {
    terminals.setStatus("t2", "blocked");

    await waitFor({
      ...RECORD,
      reportSeq: 1,
      result: { ...DONE_RESULT, outcome: "done" },
    });

    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("waitForReport fails, with hc's error, when hc cannot answer", () => {
  it("names the session and hc's message when hc cannot read the terminal", async () => {
    const error = terminalError(
      "not-found",
      "no terminal t2",
      "check the id with list()",
    );
    vi.spyOn(terminals, "get").mockResolvedValue(error);
    vi.mocked(hcMessage).mockReturnValue(
      "no terminal t2 (check the id with list())",
    );

    expect(await waitFor()).toStrictEqual({
      error:
        "Session image-trust-writer: no terminal t2 (check the id with list())",
    });
    expect(hcMessage).toHaveBeenCalledWith(error);
    expect(readReport).not.toHaveBeenCalled();
  });

  it("names the session and hc's message when hc's wait fails for another reason", async () => {
    const error = terminalError(
      "unavailable",
      "hc wait printed JSON of an unexpected shape",
    );
    vi.spyOn(terminals, "wait").mockResolvedValue(error);
    vi.mocked(hcMessage).mockReturnValue(
      "hc wait printed JSON of an unexpected shape",
    );

    expect(await waitFor()).toStrictEqual({
      error:
        "Session image-trust-writer: hc wait printed JSON of an unexpected shape",
    });
  });

  it("refuses a record with no terminal, naming the spawn that starts one", async () => {
    const { terminal: _terminal, ...noTerminal } = RECORD;

    expect(await waitFor(noTerminal)).toStrictEqual({
      error:
        "Session image-trust-writer has no hc terminal recorded; start it again with session spawn.",
    });
  });
});

describe("formatReportWait prints the outcome and its summary in one line", () => {
  it("names the session, its model, the outcome and the summary", () => {
    expect(
      formatReportWait({
        name: "image-trust-writer",
        model: "claude-sonnet-5-5",
        outcome: "done",
        summary: "Opened PR #5.",
        seq: 1,
      }),
    ).toBe("image-trust-writer (claude-sonnet-5-5) done: Opened PR #5.\n");
  });
});
