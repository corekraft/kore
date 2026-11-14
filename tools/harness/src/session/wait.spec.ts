import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { describeFailure } from "./equalize.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import {
  DEFAULT_TIMEOUT_MS,
  findResult,
  formatWait,
  parseTimeout,
  wait,
  waitForResult,
} from "./wait.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./equalize.js");
vi.mock("./names.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const RECORD: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-opus-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const DONE = { ...RECORD, result: { outcome: "done" as const, at: "x" } };
const READ = ["pane", "read", "w3:p9", "--source", "recent-unwrapped"];

let deps: FakeDeps;
let registry: FakeRegistry;

beforeEach(() => {
  deps = fakeDeps();
  registry = fakeRegistry();
  opener.open.mockResolvedValue(asRegistry(registry));
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
});

/** The pane's screen as herdr shows it, one answer per poll. */
function screens(...texts: string[]): void {
  for (const stdout of texts) {
    deps.runner.run.mockResolvedValueOnce({ stdout, stderr: "", code: 0 });
  }
}

describe("findResult", () => {
  it("returns the outcome of the last anchored marker line", () => {
    expect(findResult("RESULT: done\nmore work\nRESULT: blocked\n")).toBe(
      "blocked",
    );
  });

  it("accepts a marker indented or after Claude's bullet, and nothing else", () => {
    expect(findResult("  RESULT: done")).toBe("done");
    expect(findResult("● RESULT: blocked")).toBe("blocked");
    expect(findResult("I will end with RESULT: done")).toBeUndefined();
    expect(findResult("RESULT: maybe")).toBeUndefined();
  });

  it("is undefined when the text has no marker", () => {
    expect(findResult("nothing finished yet")).toBeUndefined();
  });
});

describe("parseTimeout", () => {
  it("defaults to one hour when no timeout is given", () => {
    expect(parseTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(DEFAULT_TIMEOUT_MS).toBe(3_600_000);
  });

  it("reads a positive whole number of milliseconds", () => {
    expect(parseTimeout("5000")).toBe(5000);
  });

  it("refuses zero, fractions, words and a bare flag", () => {
    const error = {
      error: "--timeout must be a positive whole number of milliseconds.",
    };
    expect(parseTimeout("0")).toEqual(error);
    expect(parseTimeout("1.5")).toEqual(error);
    expect(parseTimeout("soon")).toEqual(error);
    expect(parseTimeout(true)).toEqual(error);
  });
});

describe("waitForResult", () => {
  it("returns the recorded outcome without reading the pane", async () => {
    const result = await waitForResult(deps, asRegistry(registry), DONE, 1000);

    expect(result).toEqual({
      name: "image-trust-writer",
      paneId: "w3:p9",
      model: "claude-opus-5-5",
      outcome: "done",
      summary: "pane w3:p9",
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("polls the pane every 2 seconds until its marker shows, then records the outcome", async () => {
    screens("working", "RESULT: done\n");

    const result = await waitForResult(
      deps,
      asRegistry(registry),
      RECORD,
      60_000,
    );

    expect(deps.runner.run).toHaveBeenNthCalledWith(1, "herdr", READ);
    expect(deps.runner.run).toHaveBeenNthCalledWith(2, "herdr", READ);
    expect(deps.clock.sleep).toHaveBeenCalledExactlyOnceWith(2000);
    expect(result).toMatchObject({ outcome: "done" });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      ...RECORD,
      result: { outcome: "done", at: "2026-01-02T03:04:07.000Z" },
    });
  });

  it("fails naming the pane when reading it fails, and records nothing", async () => {
    deps.runner.run.mockResolvedValueOnce({
      stdout: "",
      stderr: "no pane",
      code: 1,
    });
    vi.mocked(describeFailure).mockReturnValue("no pane");

    const result = await waitForResult(
      deps,
      asRegistry(registry),
      RECORD,
      60_000,
    );

    expect(result).toEqual({
      error: "herdr pane read w3:p9 failed: no pane",
    });
    expect(registry.write).not.toHaveBeenCalled();
  });

  it("gives up at the deadline, naming the wait command to run again", async () => {
    deps.runner.run.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    const result = await waitForResult(
      deps,
      asRegistry(registry),
      RECORD,
      5000,
    );

    expect(result).toEqual({
      error:
        'Session image-trust-writer printed no "RESULT: done" or "RESULT: blocked" line in pane w3:p9 within 5 seconds. It may still be working; run `session wait image-trust-writer` again or read the pane.',
    });
    expect(deps.clock.sleep).toHaveBeenCalledTimes(2);
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("formatWait", () => {
  it("names the session, its model, the outcome and where the summary is", () => {
    expect(
      formatWait({
        name: "image-trust-writer",
        paneId: "w3:p9",
        model: "claude-opus-5-5",
        outcome: "blocked",
        summary: "pane w3:p9",
      }),
    ).toBe(
      "image-trust-writer (claude-opus-5-5) finished: RESULT blocked; summary in pane w3:p9.\n",
    );
  });
});

describe("wait", () => {
  it("fails with a usage error when no session name is given", async () => {
    const code = await wait(contextOf(deps));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "Missing the session name: session wait <name>.",
    );
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("refuses an invalid name with the name error, before opening the registry", async () => {
    vi.mocked(sessionNameError).mockReturnValue("Session names use a-z only.");

    const code = await wait(contextOf(deps, { operand: "Bad Name" }));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "Session names use a-z only.",
    );
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("refuses a bad --timeout with a usage error", async () => {
    await wait(
      contextOf(deps, {
        operand: "image-trust-writer",
        options: { timeout: "0" },
      }),
    );

    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "--timeout must be a positive whole number of milliseconds.",
    );
  });

  it("fails naming the spawn command when no such session was spawned", async () => {
    registry.read.mockResolvedValue(undefined);

    const code = await wait(contextOf(deps, { operand: "image-trust-writer" }));

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "No session named image-trust-writer was spawned by this tool; start it with `session spawn`.",
    );
  });

  it("prints the finished session as text, and as one JSON object under --json", async () => {
    registry.read.mockResolvedValue(DONE);

    const text = await wait(contextOf(deps, { operand: "image-trust-writer" }));
    const json = await wait(
      contextOf(deps, { operand: "image-trust-writer", json: true }),
    );

    expect([text, json]).toEqual([0, 0]);
    expect(deps.stdout).toHaveBeenNthCalledWith(
      1,
      "image-trust-writer (claude-opus-5-5) finished: RESULT done; summary in pane w3:p9.\n",
    );
    expect(deps.stdout).toHaveBeenNthCalledWith(
      2,
      '{"name":"image-trust-writer","paneId":"w3:p9","model":"claude-opus-5-5","outcome":"done","summary":"pane w3:p9"}\n',
    );
  });
});
