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
import { FAILED, USAGE_ERROR, fail } from "./output.js";
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
const SUMMARY = "/work/writer/.kore/report/summary.md";
const NOTICE = `image-trust-writer done seq 1: ${REPORT}`;
const USAGE =
  "session report --outcome done|blocked (--summary <text> | --summary - | --file <path>) [--plan <file> | --plan -]";
const OUTCOME_MESSAGE = `--outcome must be done or blocked: ${USAGE}.`;
const ONE_OF_MESSAGE = `Give exactly one of --summary <text> or --file <path>: ${USAGE}.`;
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

describe("report refuses a bad usage before it touches a terminal", () => {
  it.each([
    [
      "an outcome that is neither done nor blocked",
      { outcome: "maybe", summary: "Opened PR #5." },
      OUTCOME_MESSAGE,
    ],
    ["both --summary and --file", { ...DONE, file: SUMMARY }, ONE_OF_MESSAGE],
    ["neither --summary nor --file", { outcome: "done" }, ONE_OF_MESSAGE],
    [
      "an empty summary",
      { outcome: "done", summary: "  " },
      `--summary must not be empty: ${USAGE}.`,
    ],
    [
      "a bare --plan with no file",
      { ...DONE, plan: true },
      `--plan needs a file path: ${USAGE}.`,
    ],
  ])("refuses %s with a usage error (2)", async (_label, values, message) => {
    const code = await report(contextOf(deps, { options: values }));

    expect(code).toBe(2);
    expect(fail).toHaveBeenCalledWith(deps, false, USAGE_ERROR, `${message}`);
    expect(opener.open).not.toHaveBeenCalled();
  });
});

describe("report refuses when it is not an open hc session", () => {
  it("refuses outside a terminal, naming the spawn that starts one", async () => {
    await setUpTerminals(undefined);

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "Not inside an hc terminal (HC_TERMINAL_ID is unset). session report runs in the session's own terminal, which session spawn starts.",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a terminal no open record names, and writes nothing", async () => {
    registry.findByTerminal.mockResolvedValue(undefined);

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(registry.findByTerminal).toHaveBeenCalledWith("t2");
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "No open session record matches terminal t2. session report writes only for a session that session spawn started; nothing was written.",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses with the routing error when the record cannot be routed", async () => {
    vi.mocked(routeSession).mockReturnValue({
      error: "hc is not available here",
    });

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "hc is not available here",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("report reads a --file only from inside the report directory", () => {
  it("refuses a --file outside the report directory, resolved from the process directory, and reads nothing", async () => {
    vi.mocked(isInsideReportDir).mockResolvedValue(false);

    const code = await report(
      contextOf(deps, {
        options: { outcome: "done", file: "../../secret.md" },
      }),
    );

    expect(code).toBe(1);
    expect(isInsideReportDir).toHaveBeenCalledWith(
      deps.fs,
      undefined,
      "/work/writer",
      "/secret.md",
    );
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "--file ../../secret.md is outside /work/writer/.kore/report; a report reads its summary only from there. Write the summary file in that directory and pass it again.",
    );
    expect(deps.fs.readFile).not.toHaveBeenCalled();
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a --file that does not exist, and writes nothing", async () => {
    deps.fs.exists.mockResolvedValue(false);

    const code = await report(
      contextOf(deps, {
        options: { outcome: "done", file: ".kore/report/missing.md" },
      }),
    );

    expect(code).toBe(1);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "--file .kore/report/missing.md does not exist.",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("fails naming the session and hc's message when hc cannot read the terminal", async () => {
    const error = terminalError(
      "unavailable",
      "hc get printed nothing",
      "check hc --version",
    );
    vi.spyOn(terminals, "get").mockResolvedValue(error);
    vi.mocked(hcMessage).mockReturnValue(
      "hc get printed nothing (check hc --version)",
    );

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(hcMessage).toHaveBeenCalledWith(error);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "Session image-trust-writer: hc get printed nothing (check hc --version)",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("report writes the report file under the terminal's checkout", () => {
  it("writes seq 1 with the summary and the time, before it sends the notice", async () => {
    terminals.setStatus("t1", "working");
    const send = vi.spyOn(terminals, "send");

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(0);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(REPORT, expect.any(String));
    const [, content] = deps.fs.writeFile.mock.calls[0] ?? [];
    expect(JSON.parse(content ?? "")).toStrictEqual({
      seq: 1,
      outcome: "done",
      summary: "Opened PR #5.",
      at: "2026-01-02T03:04:05.000Z",
    });
    expect(deps.fs.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("takes the next seq after the one the report file holds", async () => {
    vi.mocked(readReport).mockResolvedValue({
      seq: 2,
      outcome: "blocked",
      summary: "Earlier.",
      at: "2026-01-02T03:00:00.000Z",
    });

    await report(contextOf(deps, { options: DONE }));

    expect(readReport).toHaveBeenCalledWith(deps.fs, REPORT);
    const [, content] = deps.fs.writeFile.mock.calls[0] ?? [];
    expect(JSON.parse(content ?? "")).toMatchObject({
      seq: 3,
      summary: "Opened PR #5.",
    });
  });

  it("stores the text of a --plan file with the report", async () => {
    deps.fs.exists.mockImplementation((path: string) =>
      Promise.resolve(path === "/work/writer/plan.json"),
    );
    deps.fs.readFile.mockImplementation((path: string) =>
      Promise.resolve(path === "/work/writer/plan.json" ? '{"steps":[]}' : ""),
    );

    await report(contextOf(deps, { options: { ...DONE, plan: "plan.json" } }));

    const [, content] = deps.fs.writeFile.mock.calls[0] ?? [];
    expect(JSON.parse(content ?? "")).toMatchObject({ plan: '{"steps":[]}' });
  });

  it("reads a --file the containment check accepts as the summary", async () => {
    deps.fs.exists.mockImplementation((path: string) =>
      Promise.resolve(path === SUMMARY),
    );
    deps.fs.readFile.mockImplementation((path: string) =>
      Promise.resolve(path === SUMMARY ? "Long answer." : ""),
    );

    await report(
      contextOf(deps, {
        options: { outcome: "done", file: ".kore/report/summary.md" },
      }),
    );

    expect(isInsideReportDir).toHaveBeenCalledWith(
      deps.fs,
      undefined,
      "/work/writer",
      SUMMARY,
    );
    const [, content] = deps.fs.writeFile.mock.calls[0] ?? [];
    expect(JSON.parse(content ?? "")).toMatchObject({
      summary: "Long answer.",
    });
  });
});
