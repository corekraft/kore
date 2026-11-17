import { describe, expect, it } from "vitest";
import {
  TICK_HEARTBEAT_GAP_MS,
  TICK_STARTED,
  TICK_STOPPED,
  tickHeartbeat,
} from "./tick-heartbeat.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();

describe("tick heartbeat", () => {
  it("reports no tick when no loop has ever written a heartbeat, so status says nothing", () => {
    expect(tickHeartbeat([], NOW)).toEqual({ state: "none" });
    expect(
      tickHeartbeat([{ kind: "pane.spawned", occurredAt: minutesAgo(1) }], NOW),
    ).toEqual({ state: "none" });
  });

  it("reports a running tick while its latest heartbeat is inside the gap", () => {
    const lastAt = minutesAgo(1);
    expect(
      tickHeartbeat([{ kind: TICK_STARTED, occurredAt: lastAt }], NOW),
    ).toEqual({ state: "running", lastAt });
  });

  it("reports a gap, not a running tick, once the latest heartbeat is older than the gap", () => {
    const lastAt = minutesAgo(TICK_HEARTBEAT_GAP_MS / 60000 + 1);
    expect(
      tickHeartbeat([{ kind: TICK_STARTED, occurredAt: lastAt }], NOW),
    ).toEqual({ state: "gap", lastAt });
  });

  it("reports a stopped loop as stopped, never as a gap, however old its last heartbeat is", () => {
    const stoppedAt = minutesAgo(600);
    expect(
      tickHeartbeat(
        [
          { kind: TICK_STARTED, occurredAt: minutesAgo(601) },
          { kind: TICK_STOPPED, occurredAt: stoppedAt },
        ],
        NOW,
      ),
    ).toEqual({ state: "stopped", at: stoppedAt });
  });

  it("judges the latest heartbeat by time, not by the order the events were read in", () => {
    const later = minutesAgo(1);
    expect(
      tickHeartbeat(
        [
          { kind: TICK_STARTED, occurredAt: later },
          { kind: TICK_STARTED, occurredAt: minutesAgo(900) },
        ],
        NOW,
      ),
    ).toEqual({ state: "running", lastAt: later });
  });

  it("reads a restarted loop's new heartbeat over an old stop, so a restart is not a stop", () => {
    const restarted = minutesAgo(1);
    expect(
      tickHeartbeat(
        [
          { kind: TICK_STOPPED, occurredAt: minutesAgo(30) },
          { kind: TICK_STARTED, occurredAt: restarted },
        ],
        NOW,
      ),
    ).toEqual({ state: "running", lastAt: restarted });
  });
});
