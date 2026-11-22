import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals, terminalError } from "../terminal/index.js";
import { terminalsFor } from "./backend.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { report } from "./report.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./backend.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend.js")>()),
  terminalsFor: vi.fn(),
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
const REPORT = "/work/writer/.kore/report/image-trust-writer.json";
const SUMMARY = "/work/writer/.kore/report/summary.md";
const USAGE =
  "session report --outcome done|blocked (--summary <text> | --file <path>) [--plan <file>]";
const OUTCOME_MESSAGE = `--outcome must be done or blocked: ${USAGE}.`;
const ONE_OF_MESSAGE = `Give exactly one of --summary <text> or --file <path>: ${USAGE}.`;

let deps: FakeDeps;
let registry: FakeRegistry;
let terminals: FakeTerminals;

/** A parent t1 in the main checkout, and the writer t2 in its worktree, a child of t1. */
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
}

/** The flags a writer passes for a finished report, with the summary text. */
const DONE = { outcome: "done", summary: "Opened PR #5." };

beforeEach(async () => {
  deps = fakeDeps();
  deps.cwd = "/work/writer";
  registry = fakeRegistry();
  opener.open.mockResolvedValue(asRegistry(registry));
  registry.findByTerminal.mockResolvedValue(RECORD);
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
    expect(deps.stderr).toHaveBeenCalledWith(`${message}\n`);
    expect(opener.open).not.toHaveBeenCalled();
  });
});

describe("report refuses when it is not an open hc session", () => {
  it("refuses outside a terminal, naming the spawn that starts one", async () => {
    await setUpTerminals(undefined);

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Not inside an hc terminal (HC_TERMINAL_ID is unset). session report runs in the session's own terminal, which session spawn starts.\n",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a terminal no open record names, and writes nothing", async () => {
    registry.findByTerminal.mockResolvedValue(undefined);

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(registry.findByTerminal).toHaveBeenCalledWith("t2");
    expect(deps.stderr).toHaveBeenCalledWith(
      "No open session record matches terminal t2. session report writes only for a session that session spawn started; nothing was written.\n",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a --file outside the report directory, and reads nothing", async () => {
    const code = await report(
      contextOf(deps, {
        options: { outcome: "done", file: "../../secret.md" },
      }),
    );

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "--file ../../secret.md is outside /work/writer/.kore/report; a report reads its summary only from there. Write the summary file in that directory and pass it again.\n",
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
    expect(deps.stderr).toHaveBeenCalledWith(
      "--file .kore/report/missing.md does not exist.\n",
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("fails naming the session and hc's error when hc cannot read the terminal", async () => {
    vi.spyOn(terminals, "get").mockResolvedValue(
      terminalError(
        "unavailable",
        "hc get printed nothing",
        "check hc --version",
      ),
    );

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Session image-trust-writer: hc get printed nothing (check hc --version)\n",
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

  it("takes the next seq after the one the file holds", async () => {
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue(
      JSON.stringify({
        seq: 2,
        outcome: "blocked",
        summary: "Earlier.",
        at: "2026-01-02T03:00:00.000Z",
      }),
    );

    await report(contextOf(deps, { options: DONE }));

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

  it("reads a --file inside the report directory as the summary", async () => {
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

    const [, content] = deps.fs.writeFile.mock.calls[0] ?? [];
    expect(JSON.parse(content ?? "")).toMatchObject({
      summary: "Long answer.",
    });
  });
});

describe("report tells the parent in one fixed line, and only an agent parent", () => {
  it("sends the parent one line that names the file and never the summary", async () => {
    terminals.setStatus("t1", "working");

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(0);
    expect(terminals.sent("t1")).toStrictEqual([
      `image-trust-writer done seq 1: ${REPORT}`,
    ]);
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
    terminals = new FakeTerminals({ self: "t1" });
    await terminals.run({ argv: ["claude"], cwd: "/work/writer" });
    vi.mocked(terminalsFor).mockReturnValue(terminals);

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(0);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(REPORT, expect.any(String));
    expect(deps.stdout).toHaveBeenCalledWith(
      `Wrote ${REPORT} (seq 1, done). No notice sent.\n`,
    );
  });

  it("fails naming the notice when the send fails, and keeps the report it already wrote", async () => {
    terminals.setStatus("t1", "working");
    vi.spyOn(terminals, "send").mockResolvedValue(
      terminalError(
        "unavailable",
        "hc send printed nothing",
        "check hc --version",
      ),
    );

    const code = await report(contextOf(deps, { options: DONE }));

    expect(code).toBe(1);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(REPORT, expect.any(String));
    expect(deps.stderr).toHaveBeenCalledWith(
      `The report is written at ${REPORT}, but the notice to t1 failed: hc send printed nothing (check hc --version).\n`,
    );
  });
});
