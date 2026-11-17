import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  asRegistry,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { recordFinish } from "./finish-record.js";
import type { SessionRecord } from "./registry.js";
import { readResult } from "./wait.js";

vi.mock("./finish-record.js", () => ({ recordFinish: vi.fn() }));
vi.mock("./equalize.js", () => ({ describeFailure: () => "no pane" }));

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
});

describe("readResult reads the pane once and settles only on a RESULT line (ADR 0123)", () => {
  it("returns the recorded result without reading the pane", async () => {
    const result = await readResult(deps, asRegistry(registry), DONE);

    expect(result).toMatchObject({ outcome: "done", paneId: "w3:p9" });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("returns nothing, and records nothing, while the pane shows no RESULT line", async () => {
    deps.runner.run.mockResolvedValueOnce({
      stdout: "still working\n",
      stderr: "",
      code: 0,
    });

    const result = await readResult(deps, asRegistry(registry), RECORD);

    expect(result).toBeUndefined();
    expect(deps.runner.run).toHaveBeenCalledExactlyOnceWith("herdr", READ);
    expect(registry.write).not.toHaveBeenCalled();
    expect(recordFinish).not.toHaveBeenCalled();
  });

  it("records the outcome, its summary and pane.finished once the RESULT line shows", async () => {
    deps.runner.run.mockResolvedValueOnce({
      stdout: "Wrote the spec.\nRESULT: blocked\n",
      stderr: "",
      code: 0,
    });

    const result = await readResult(deps, asRegistry(registry), RECORD);

    expect(result).toMatchObject({
      outcome: "blocked",
      result: { outcome: "blocked", summary: "Wrote the spec." },
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      ...RECORD,
      result: {
        outcome: "blocked",
        at: "2026-01-02T03:04:05.000Z",
        summary: "Wrote the spec.",
      },
    });
    expect(recordFinish).toHaveBeenCalledExactlyOnceWith(
      deps,
      "w3:p9",
      "image-trust-writer",
      "blocked",
    );
  });

  it("returns an error naming the pane when the read fails, and records nothing", async () => {
    deps.runner.run.mockResolvedValueOnce({
      stdout: "",
      stderr: "no pane",
      code: 1,
    });

    const result = await readResult(deps, asRegistry(registry), RECORD);

    expect(result).toEqual({
      error: "herdr pane read w3:p9 failed: no pane",
    });
    expect(registry.write).not.toHaveBeenCalled();
  });
});
