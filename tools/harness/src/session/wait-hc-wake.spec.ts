import { beforeEach, expect, it, vi } from "vitest";
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
import { waitForReport } from "./wait-hc.js";

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
const WOKE = terminalError("woke", "a message woke the wait before a finish");
const DONE = {
  name: "image-trust-writer",
  model: "claude-sonnet-5-5",
  outcome: "done",
  summary: "Opened PR #5.",
  seq: 1,
};
const FIRST_WRITE = {
  ...RECORD,
  reportSeq: 1,
  result: {
    outcome: "done",
    summary: "Opened PR #5.",
    at: "2026-01-02T03:04:05.000Z",
  },
};

let deps: FakeDeps;
let registry: FakeRegistry;
let terminals: FakeTerminals;
/** What the report file holds now: undefined when the session has not written one. */
let onDisk: Report | undefined;

function report(seq: number, summary: string): Report {
  return {
    seq,
    outcome: "done",
    summary,
    at: "2026-01-02T03:04:05.000Z",
  };
}

function waitFor(timeoutMs = TIMEOUT_MS) {
  return waitForReport(
    deps,
    terminals,
    asRegistry(registry),
    RECORD,
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

it("does not end on a message wake while the session runs, and returns the report written after it", async () => {
  const waitSpy = vi.spyOn(terminals, "wait").mockResolvedValueOnce(WOKE);

  const pending = waitFor();
  await vi.waitFor(() => {
    expect(waitSpy).toHaveBeenCalledTimes(2);
  });
  onDisk = report(1, "Opened PR #5.");
  terminals.finish("t2", 0);

  expect(await pending).toStrictEqual(DONE);
  expect(waitSpy.mock.calls).toStrictEqual([
    [{ terminal: "t2" }, TIMEOUT_MS],
    [{ terminal: "t2" }, TIMEOUT_MS],
  ]);
});

it("returns a report that arrives with the wake, without waiting again", async () => {
  const waitSpy = vi
    .spyOn(terminals, "wait")
    .mockImplementationOnce(async () => {
      onDisk = report(1, "Opened PR #5.");
      return WOKE;
    });

  expect(await waitFor()).toStrictEqual(DONE);
  expect(waitSpy).toHaveBeenCalledTimes(1);
  expect(registry.write).toHaveBeenCalledWith(FIRST_WRITE);
});

it("ends on the bound after repeated wakes, waiting on what is left, and names the still-working cause", async () => {
  const waitSpy = vi.spyOn(terminals, "wait").mockImplementation(async () => {
    await deps.clock.sleep(20_000);
    return WOKE;
  });

  expect(await waitFor()).toStrictEqual({
    error:
      "Session image-trust-writer is still working: no report and no stop within 60 seconds. Run session wait image-trust-writer again, or read the terminal with hc read t2.",
  });
  expect(waitSpy.mock.calls).toStrictEqual([
    [{ terminal: "t2" }, 60_000],
    [{ terminal: "t2" }, 40_000],
    [{ terminal: "t2" }, 20_000],
  ]);
});

it("waits again on the bound left when hc times out before the bound", async () => {
  const waitSpy = vi
    .spyOn(terminals, "wait")
    .mockImplementationOnce(async () => {
      await deps.clock.sleep(10_000);
      return terminalError("timeout", "nothing has finished within 10000 ms");
    });

  const pending = waitFor();
  await vi.waitFor(() => {
    expect(waitSpy).toHaveBeenCalledTimes(2);
  });
  onDisk = report(1, "Opened PR #5.");
  terminals.finish("t2", 0);

  expect(await pending).toStrictEqual(DONE);
  expect(waitSpy.mock.calls).toStrictEqual([
    [{ terminal: "t2" }, TIMEOUT_MS],
    [{ terminal: "t2" }, 50_000],
  ]);
});

it("names hc's message and does not wait again when the terminal is gone after a message wake", async () => {
  const live = await terminals.get("t2");
  const gone = terminalError(
    "not-found",
    "no terminal t2",
    "check the id with list()",
  );
  vi.spyOn(terminals, "get")
    .mockResolvedValueOnce(live)
    .mockResolvedValueOnce(live)
    .mockResolvedValueOnce(gone);
  const waitSpy = vi.spyOn(terminals, "wait").mockResolvedValueOnce(WOKE);
  vi.mocked(hcMessage).mockReturnValue(
    "no terminal t2 (check the id with list())",
  );

  expect(await waitFor()).toStrictEqual({
    error:
      "Session image-trust-writer: no terminal t2 (check the id with list())",
  });
  expect(hcMessage).toHaveBeenCalledWith(gone);
  expect(waitSpy).toHaveBeenCalledTimes(1);
});
