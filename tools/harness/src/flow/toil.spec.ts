import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { uncovered } from "./intervals.js";
import { chargeToil, newLife, type Life, type ToilKind } from "./toil.js";

vi.mock("./intervals.js");

const WINDOW: [number, number] = [0, 1000];

function event(kind: Kind, fields: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    schema: 1,
    id: "e1",
    source: "claude",
    kind,
    occurredAt: "2026-01-02T00:00:00.000Z",
    recordedAt: "2026-01-02T00:00:00.000Z",
    ...fields,
  };
}

/** A life that began with a spawn, with nothing yet charged. */
function startedLife(): Life {
  return newLife(event("pane.spawned"), [...WINDOW]);
}

/** Runs one event through the charger and returns what it added, in order. */
function charge(life: Life, e: LedgerEvent, at: number, start: number) {
  const added: [ToilKind, number][] = [];
  chargeToil((kind, ms) => added.push([kind, ms]), e, at, start, life);
  return added;
}

beforeEach(() => {
  vi.mocked(uncovered).mockReturnValue(7);
});

describe("newLife", () => {
  it("begins a life at a pane spawn or a session start, and not at a tool", () => {
    expect(newLife(event("pane.spawned"), [...WINDOW]).began).toBe(true);
    expect(newLife(event("session.start"), [...WINDOW]).began).toBe(true);
    expect(newLife(event("tool.start"), [...WINDOW]).began).toBe(false);
  });

  it("starts with no tool, no failure, no waits, and the given window", () => {
    expect(newLife(event("pane.spawned"), [5, 9])).toEqual({
      began: true,
      lastToolAt: undefined,
      failed: undefined,
      waits: [],
      window: [5, 9],
    });
  });
});

describe("chargeToil starting", () => {
  it("charges the gap from the spawn to the first tool as starting", () => {
    const life = startedLife();
    expect(charge(life, event("tool.start", { tool: "Bash" }), 40, 10)).toEqual(
      [["starting", 7]],
    );
    expect(uncovered).toHaveBeenCalledWith([10, 40], []);
  });

  it("counts a tool end as the first tool too", () => {
    const life = startedLife();
    expect(charge(life, event("tool.end", { tool: "Bash" }), 40, 10)).toEqual([
      ["starting", 7],
    ]);
  });

  it("charges no starting for a life that did not begin at a spawn", () => {
    const life = newLife(event("tool.start"), [...WINDOW]);
    expect(charge(life, event("tool.start", { tool: "Bash" }), 40, 10)).toEqual(
      [],
    );
  });

  it("charges no starting after the first tool has run", () => {
    const life = startedLife();
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "success" }),
      20,
      10,
    );
    expect(charge(life, event("tool.start", { tool: "Read" }), 40, 25)).toEqual(
      [],
    );
  });
});

describe("chargeToil retrying", () => {
  it("charges the gap from a failed tool's end to the next start of the same tool", () => {
    const life = startedLife();
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "failure" }),
      20,
      10,
    );
    expect(charge(life, event("tool.start", { tool: "Bash" }), 50, 30)).toEqual(
      [["retrying", 7]],
    );
    expect(uncovered).toHaveBeenCalledWith([20, 50], []);
  });

  it("charges nothing when the next tool is a different one", () => {
    const life = startedLife();
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "failure" }),
      20,
      10,
    );
    expect(charge(life, event("tool.start", { tool: "Read" }), 50, 30)).toEqual(
      [],
    );
  });

  it("charges nothing after a success, which clears the failure", () => {
    const life = startedLife();
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "failure" }),
      20,
      10,
    );
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "success" }),
      25,
      22,
    );
    expect(charge(life, event("tool.start", { tool: "Bash" }), 50, 30)).toEqual(
      [],
    );
  });
});

describe("chargeToil stopping", () => {
  it("charges the gap from the last tool to a pane closing as stopping", () => {
    const life = startedLife();
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "success" }),
      20,
      10,
    );
    expect(charge(life, event("pane.closed"), 90, 0)).toEqual([
      ["stopping", 7],
    ]);
    expect(uncovered).toHaveBeenCalledWith([20, 90], []);
  });

  it("charges stopping at a session stop too", () => {
    const life = startedLife();
    charge(
      life,
      event("tool.end", { tool: "Bash", outcome: "success" }),
      20,
      10,
    );
    expect(charge(life, event("session.stop"), 60, 0)).toEqual([
      ["stopping", 7],
    ]);
  });

  it("charges no stopping when no tool ever ran", () => {
    expect(charge(startedLife(), event("pane.closed"), 90, 0)).toEqual([]);
  });
});

describe("chargeToil gaps", () => {
  it("clips a gap to the window and leaves out the waits it passes over", () => {
    const life = newLife(event("pane.spawned"), [20, 80]);
    life.waits.push([30, 40]);
    charge(life, event("tool.start", { tool: "Bash" }), 100, 0);
    expect(uncovered).toHaveBeenCalledWith([20, 80], [[30, 40]]);
  });

  it("charges nothing, without asking for holes, for a gap outside the window", () => {
    const life = newLife(event("pane.spawned"), [200, 300]);
    expect(charge(life, event("tool.start", { tool: "Bash" }), 100, 0)).toEqual(
      [["starting", 0]],
    );
    expect(uncovered).not.toHaveBeenCalled();
  });
});
