import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals, terminalError } from "../terminal/index.js";
import { hcMessage, routeSession, terminalsFor } from "./backend.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { FAILED, fail } from "./output.js";
import { report } from "./report.js";
import {
  isInsideReportDir,
  noticeLine,
  readReport,
  reportDirOf,
  reportPath,
} from "./report-file.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./backend.js");
vi.mock("./report-file.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

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
const REPORT_DIR = "/work/writer/.kore/report";
const REPORT = "/work/writer/.kore/report/image-trust-writer.json";
const NOTICE = `image-trust-writer done seq 1: ${REPORT}`;
const DONE = { outcome: "done", summary: "Opened PR #5." };

let deps: FakeDeps;
let registry: FakeRegistry;
let terminals: FakeTerminals;

/** Routes the record to hc over these terminals: a parent t1 in the main checkout, and the writer t2 in its worktree. */
async function setUpTerminals(self: string | undefined): Promise<void> {
  terminals = new FakeTerminals(self === undefined ? {} : { self });
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
  });
  vi.mocked(terminalsFor).mockReturnValue(terminals);
  vi.mocked(routeSession).mockReturnValue({ terminals });
}

beforeEach(async () => {
  deps = fakeDeps();
  deps.cwd = "/work/writer";
  registry = fakeRegistry();
  opener.open.mockResolvedValue(asRegistry(registry));
  registry.findByTerminal.mockResolvedValue(RECORD);
  vi.mocked(reportPath).mockReturnValue(REPORT);
  vi.mocked(reportDirOf).mockReturnValue(REPORT_DIR);
  vi.mocked(isInsideReportDir).mockResolvedValue(true);
  vi.mocked(readReport).mockResolvedValue(undefined);
  vi.mocked(noticeLine).mockReturnValue(NOTICE);
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  await setUpTerminals("t2");
});

describe("report tells the parent in one fixed line, and only an agent parent", () => {
  it("sends the parent the line the notice builder returns, and names the seq, outcome and path to it", async () => {
    terminals.setStatus("t1", "working");

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(0);
    expect(noticeLine).toHaveBeenCalledWith(
      "image-trust-writer",
      "done",
      1,
      REPORT,
    );
    expect(terminals.sent("t1")).toStrictEqual([NOTICE]);
    expect(terminals.sent("t1")[0]).not.toContain("Opened PR #5.");
    expect(deps.stdout).toHaveBeenCalledWith(
      `Wrote ${REPORT} (seq 1, done). Notified t1.\n`,
    );
  });

  it("sends no notice to a parent that is not an agent terminal, and keeps the file", async () => {
    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(0);
    expect(terminals.sent("t1")).toStrictEqual([]);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(REPORT, expect.any(String));
    expect(deps.stdout).toHaveBeenCalledWith(
      `Wrote ${REPORT} (seq 1, done). No notice sent.\n`,
    );
  });

  it("sends no notice when the session has no parent", async () => {
    await setUpTerminals("t1");
    terminals = new FakeTerminals({ self: "t1" });
    await terminals.run({ argv: ["claude"], cwd: "/work/writer" });
    vi.mocked(terminalsFor).mockReturnValue(terminals);
    vi.mocked(routeSession).mockReturnValue({ terminals });

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(0);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(REPORT, expect.any(String));
    expect(deps.stdout).toHaveBeenCalledWith(
      `Wrote ${REPORT} (seq 1, done). No notice sent.\n`,
    );
  });

  it("fails naming the notice when the send fails, and keeps the report it already wrote", async () => {
    terminals.setStatus("t1", "working");
    const error = terminalError(
      "unavailable",
      "hc send printed nothing",
      "check hc --version",
    );
    vi.spyOn(terminals, "send").mockResolvedValue(error);
    vi.mocked(hcMessage).mockReturnValue(
      "hc send printed nothing (check hc --version)",
    );

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(hcMessage).toHaveBeenCalledWith(error);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(REPORT, expect.any(String));
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      `The report is written at ${REPORT}, but the notice to t1 failed: hc send printed nothing (check hc --version).`,
    );
  });
});
