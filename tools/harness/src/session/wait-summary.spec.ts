// The pane result summary `session wait` keeps (ADR 0123): the text a pane printed
// between its last prompt and its RESULT line, stored in the session record and
// returned under --json, never written to the ledger.
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
import { recordFinish } from "./finish-record.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import { wait, waitForResult } from "./wait.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./finish-record.js", () => ({ recordFinish: vi.fn() }));

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

let deps: FakeDeps;
let registry: FakeRegistry;

beforeEach(() => {
  deps = fakeDeps();
  registry = fakeRegistry();
  opener.open.mockResolvedValue(asRegistry(registry));
});

/** The pane's screen as herdr shows it, one answer per poll. */
function screen(stdout: string): void {
  deps.runner.run.mockResolvedValueOnce({ stdout, stderr: "", code: 0 });
}

/** The summary the session record was last written with. */
function storedSummary(): string | undefined {
  return vi.mocked(registry.write).mock.calls[0]?.[0].result?.summary;
}

describe("waitForResult stores the summary of the pane result", () => {
  it("stores the text between the last prompt line and the RESULT line, ANSI stripped and trimmed", async () => {
    screen(
      "> an earlier task\nold answer\n> finish the task\n\x1b[1m  Fixed the parser.\x1b[0m\nAll tests pass.  \nRESULT: done\nafter the marker\n",
    );

    await waitForResult(deps, asRegistry(registry), RECORD, 60_000);

    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      ...RECORD,
      result: {
        outcome: "done",
        at: "2026-01-02T03:04:05.000Z",
        summary: "Fixed the parser.\nAll tests pass.",
      },
    });
  });

  it("takes everything before the RESULT line when the pane shows no prompt line", async () => {
    screen("Plain answer\nRESULT: blocked\n");

    const result = await waitForResult(
      deps,
      asRegistry(registry),
      RECORD,
      60_000,
    );

    expect(result).toMatchObject({
      outcome: "blocked",
      result: { outcome: "blocked", summary: "Plain answer" },
    });
  });

  it("stores an empty summary when the RESULT line directly follows the prompt", async () => {
    screen("> finish the task\nRESULT: done\n");

    await waitForResult(deps, asRegistry(registry), RECORD, 60_000);

    expect(storedSummary()).toBe("");
  });

  it("caps the summary at 2000 characters, keeping the head and ending with an ellipsis", async () => {
    screen(`> task\n${"a".repeat(2500)}\nRESULT: done\n`);

    await waitForResult(deps, asRegistry(registry), RECORD, 60_000);

    expect(storedSummary()).toBe(`${"a".repeat(1999)}…`);
  });

  it("keeps the summary out of the ledger: pane.finished gets the outcome word only", async () => {
    screen("> task\nSecret summary text\nRESULT: done\n");

    await waitForResult(deps, asRegistry(registry), RECORD, 60_000);

    expect(recordFinish).toHaveBeenCalledExactlyOnceWith(
      deps,
      "w3:p9",
      "image-trust-writer",
      "done",
    );
    expect(JSON.stringify(vi.mocked(recordFinish).mock.calls)).not.toContain(
      "Secret summary text",
    );
  });
});

describe("waitForResult returns the summary of a recorded result", () => {
  it("returns the summary stored with the result, without reading the pane", async () => {
    const recorded = {
      ...DONE,
      result: { outcome: "done" as const, at: "x", summary: "Kept text" },
    };

    const result = await waitForResult(
      deps,
      asRegistry(registry),
      recorded,
      1000,
    );

    expect(result).toMatchObject({
      result: { outcome: "done", summary: "Kept text" },
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("returns an empty summary for a result recorded before summaries existed", async () => {
    const result = await waitForResult(deps, asRegistry(registry), DONE, 1000);

    expect(result).toMatchObject({
      result: { outcome: "done", summary: "" },
    });
  });
});

describe("wait prints the summary under --json", () => {
  it("returns the stored summary as result.summary beside the outcome, and the text output still names the pane", async () => {
    const recorded = {
      ...DONE,
      result: { outcome: "done" as const, at: "x", summary: "Kept text" },
    };
    registry.read.mockResolvedValue(recorded);

    const json = await wait(
      contextOf(deps, { operand: "image-trust-writer", json: true }),
    );
    const text = await wait(contextOf(deps, { operand: "image-trust-writer" }));

    expect([json, text]).toEqual([0, 0]);
    expect(deps.stdout).toHaveBeenNthCalledWith(
      1,
      '{"name":"image-trust-writer","paneId":"w3:p9","model":"claude-opus-5-5","outcome":"done","summary":"pane w3:p9","result":{"outcome":"done","summary":"Kept text"}}\n',
    );
    expect(deps.stdout).toHaveBeenNthCalledWith(
      2,
      "image-trust-writer (claude-opus-5-5) finished: RESULT done; summary in pane w3:p9.\n",
    );
  });
});
