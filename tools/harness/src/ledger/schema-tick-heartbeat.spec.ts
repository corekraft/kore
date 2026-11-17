import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-16T10:00:00.000Z" };

describe("tick heartbeat events", () => {
  it("are kinds the loop may record, never ones only the poller writes", () => {
    expect(KINDS).toContain("tick.started");
    expect(KINDS).toContain("tick.stopped");
    expect(POLLER_KINDS).not.toContain("tick.started");
    expect(POLLER_KINDS).not.toContain("tick.stopped");
  });

  it("records a heartbeat and a stop with only the stamp, as the loop writes them", () => {
    expect(parseEvent({ ...stamp, kind: "tick.started" }, "input").ok).toBe(
      true,
    );
    expect(parseEvent({ ...stamp, kind: "tick.stopped" }, "input").ok).toBe(
      true,
    );
  });
});
