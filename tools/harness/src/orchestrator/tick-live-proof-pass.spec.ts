import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import type { LiveProofs } from "./tick-live-proof.js";

const TICKET = {
  kind: "ticket",
  issue: 8,
  since: "2026-11-20",
  lane: "harness",
  horizon: "next",
  labels: ["live-proof"],
};

function ports(): TickPorts {
  return {
    queue: vi.fn().mockResolvedValue([TICKET]),
    panes: vi.fn().mockResolvedValue([]),
    ticketsOn: vi.fn().mockResolvedValue(true),
    spawn: vi.fn(),
    close: vi.fn(),
  } as unknown as TickPorts;
}

const STEP = {
  idea: "ticket-8",
  issue: 8,
  step: "spawn-live-proof" as const,
  pane: "live-proof-8",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Tick with live proofs", () => {
  it("adds the live-proof steps to the pass and tells the notifier of each", async () => {
    const live = { pass: vi.fn().mockResolvedValue([STEP]) };
    const notify = vi.fn().mockResolvedValue(undefined);
    const tick = new Tick(ports(), new Map(), undefined, undefined, {
      notify,
    }).withLiveProofs(live as unknown as LiveProofs);

    expect(await tick.pass()).toEqual([STEP]);
    expect(notify).toHaveBeenCalledWith(STEP);
  });

  it("starts nothing for a live-proof ticket when live proofs are off", async () => {
    const p = ports();

    expect(await new Tick(p).pass()).toEqual([]);
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("leaves live proofs out of a pass scoped to one idea", async () => {
    const live = { pass: vi.fn() };
    const tick = new Tick(ports()).withLiveProofs(
      live as unknown as LiveProofs,
    );

    await tick.pass("0001");

    expect(live.pass).not.toHaveBeenCalled();
  });
});
