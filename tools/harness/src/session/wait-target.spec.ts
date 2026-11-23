import { beforeEach, describe, expect, it, vi } from "vitest";
import { asRegistry, fakeDeps, fakeRegistry } from "./deps-support.js";
import { sessionNameError } from "./names.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import { readSettledOnce } from "./wait-hc.js";
import { openSessionTarget, settleSessionTarget } from "./wait-target.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: unknown) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./names.js");
vi.mock("./wait-hc.js", () => ({ readSettledOnce: vi.fn() }));

const RECORD: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-opus-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

const registry = fakeRegistry();
const deps = fakeDeps();

beforeEach(() => {
  vi.resetAllMocks();
  opener.open.mockResolvedValue(asRegistry(registry));
  vi.mocked(sessionNameError).mockReturnValue(undefined);
});

describe("openSessionTarget opens a spawned session as a wait target, or refuses it", () => {
  it("refuses a name the session domain rejects with a usage message, and opens nothing", async () => {
    vi.mocked(sessionNameError).mockReturnValue("bad name, use a subject.");

    expect(await openSessionTarget(deps, "x")).toEqual({
      usage: "bad name, use a subject.",
    });
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("refuses a session this tool never spawned, naming the fix", async () => {
    registry.read.mockResolvedValue(undefined);

    expect(await openSessionTarget(deps, "ghost")).toEqual({
      error:
        "No session named ghost was spawned by this tool; start it with `session spawn`.",
    });
  });

  it("returns the spawned session's record as the target", async () => {
    registry.read.mockResolvedValue(RECORD);

    const opened = await openSessionTarget(deps, RECORD.name);

    expect(opened).toEqual({
      target: expect.objectContaining({ name: RECORD.name, record: RECORD }),
    });
  });
});

describe("settleSessionTarget reads the pane once, through session wait", () => {
  it("is pending while session wait finds no RESULT line", async () => {
    registry.read.mockResolvedValue(RECORD);
    vi.mocked(readSettledOnce).mockResolvedValue(undefined);
    const opened = await openSessionTarget(deps, RECORD.name);
    if (!("target" in opened)) {
      throw new Error("expected a target");
    }

    expect(await settleSessionTarget(deps, opened.target)).toBe("pending");
  });

  it("returns the outcome word once session wait records the RESULT line", async () => {
    registry.read.mockResolvedValue(RECORD);
    vi.mocked(readSettledOnce).mockResolvedValue({
      name: RECORD.name,
      model: RECORD.model,
      outcome: "blocked",
      summary: "pane w3:p9",
    });
    const opened = await openSessionTarget(deps, RECORD.name);
    if (!("target" in opened)) {
      throw new Error("expected a target");
    }

    expect(await settleSessionTarget(deps, opened.target)).toEqual({
      outcome: "blocked",
    });
  });

  it("passes a pane read error through, so the caller fails rather than waits", async () => {
    vi.mocked(readSettledOnce).mockResolvedValue({
      error: "herdr pane read w3:p9 failed: no pane",
    });
    registry.read.mockResolvedValue(RECORD);
    const opened = await openSessionTarget(deps, RECORD.name);
    if (!("target" in opened)) {
      throw new Error("expected a target");
    }

    expect(await settleSessionTarget(deps, opened.target)).toEqual({
      error: "herdr pane read w3:p9 failed: no pane",
    });
  });
});
