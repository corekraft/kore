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
import { readSettledOnce } from "./wait-hc.js";

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
const AT = "2026-01-02T03:04:05.000Z";
const FIRST_WRITE = {
  ...RECORD,
  reportSeq: 1,
  result: { outcome: "done", summary: "Opened PR #5.", at: AT },
};
const STOPPED = {
  ...RECORD,
  result: { outcome: "blocked", summary: "stopped without a report", at: AT },
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
  return { seq, outcome, summary, at: AT };
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
  vi.mocked(reportPath).mockReturnValue(
    "/work/writer/.kore/report/image-trust-writer.json",
  );
  vi.mocked(readReport).mockImplementation(async () => onDisk);
});

describe("readSettledOnce looks once and never waits", () => {
  const readOnce = (record: SessionRecord = RECORD) =>
    readSettledOnce(deps, terminals, asRegistry(registry), record);

  it("settles on a report with a new seq and records it consumed", async () => {
    onDisk = report(1, "done", "Opened PR #5.");
    const waitSpy = vi.spyOn(terminals, "wait");

    expect(await readOnce()).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "done",
      summary: "Opened PR #5.",
      seq: 1,
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith(FIRST_WRITE);
    expect(waitSpy).not.toHaveBeenCalled();
  });

  it("settles blocked, and records it, when the terminal reports blocked with no report", async () => {
    terminals.setStatus("t2", "blocked");

    expect(await readOnce()).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "reported blocked and wrote no report",
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        result: expect.objectContaining({ outcome: "blocked" }),
      }),
    );
  });

  it("settles blocked, stopped without a report, when the terminal finished and records it", async () => {
    terminals.finish("t2", 0);

    expect(await readOnce()).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "stopped without a report",
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith(STOPPED);
  });

  it("keeps the outcome a consumed report recorded when the terminal finished after it", async () => {
    terminals.finish("t2", 0);

    expect(await readOnce({ ...RECORD, reportSeq: 1 })).toStrictEqual({
      name: "image-trust-writer",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "stopped without a report",
    });
    expect(registry.write).not.toHaveBeenCalled();
  });

  it("is pending, undefined, for a live terminal with no new report and no blocked status", async () => {
    onDisk = report(1, "done", "Already consumed.");
    const waitSpy = vi.spyOn(terminals, "wait");

    expect(await readOnce({ ...RECORD, reportSeq: 1 })).toBeUndefined();
    expect(registry.write).not.toHaveBeenCalled();
    expect(waitSpy).not.toHaveBeenCalled();
  });
});

describe("readSettledOnce fails, with hc's error, when hc cannot answer", () => {
  const readOnce = (record: SessionRecord = RECORD) =>
    readSettledOnce(deps, terminals, asRegistry(registry), record);

  it("names the session and hc's message when hc cannot read the terminal", async () => {
    const error = terminalError("not-found", "no terminal t2");
    vi.spyOn(terminals, "get").mockResolvedValue(error);
    vi.mocked(hcMessage).mockReturnValue("no terminal t2");

    expect(await readOnce()).toStrictEqual({
      error: "Session image-trust-writer: no terminal t2",
    });
  });

  it("refuses a record with no terminal, naming the spawn that starts one", async () => {
    const { terminal: _terminal, ...noTerminal } = RECORD;

    expect(await readOnce(noTerminal)).toStrictEqual({
      error:
        "Session image-trust-writer has no hc terminal recorded; start it again with session spawn.",
    });
  });
});
