import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { unstampedSpawns } from "./unstamped-spawns.js";
import { inWindow, type Span } from "./scope.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: Span = [0, 1000];

/** A spawn event whose id is its time in milliseconds, so the mocked clock reads it back. */
function spawn(ms: number, label?: string): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "herdr",
    kind: "spawn.unstamped" as Kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    role: "writer",
    agent: `x-${ms}`,
    ...(label === undefined ? {} : { label }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation((w, t) => t >= w[0] && t < w[1]);
});

describe("unstampedSpawns counts the spawns that named no idea", () => {
  it("counts each unstamped spawn in the range", () => {
    const events = [
      spawn(10),
      spawn(20),
      { ...spawn(30), kind: "session.launch" as Kind },
    ];

    expect(unstampedSpawns(events, WINDOW)).toEqual({
      total: 2,
      withReason: 0,
    });
  });

  it("counts a spawn whose session gave a --no-idea reason as one with a reason", () => {
    const events = [spawn(10), spawn(20, "grilling session")];

    expect(unstampedSpawns(events, WINDOW)).toEqual({
      total: 2,
      withReason: 1,
    });
  });

  it("leaves out an unstamped spawn outside the range", () => {
    const events = [spawn(10), spawn(2000)];

    expect(unstampedSpawns(events, WINDOW)).toEqual({
      total: 1,
      withReason: 0,
    });
  });

  it("counts none when no spawn named no idea", () => {
    expect(unstampedSpawns([], WINDOW)).toEqual({ total: 0, withReason: 0 });
  });
});
