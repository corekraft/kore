import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "herdr", occurredAt: "2026-11-15T10:00:00.000Z" };
const spawned = {
  ...stamp,
  kind: "spawn.unstamped",
  pane: "w3:p9",
  agent: "image-trust-writer",
  role: "writer",
};

describe("unstamped spawn events", () => {
  it("are a kind a tool records, never one only the poller writes", () => {
    expect(KINDS).toContain("spawn.unstamped");
    expect(POLLER_KINDS).not.toContain("spawn.unstamped");
  });

  it("records a spawn that named no idea, with its role and name", () => {
    expect(parseEvent(spawned, "input")).toEqual({ ok: true, event: spawned });
  });

  it("records the reason a session gave with --no-idea as its label", () => {
    const event = { ...spawned, label: "grilling session, no issue" };

    expect(parseEvent(event, "input")).toEqual({ ok: true, event });
  });

  it("refuses an unstamped spawn with no role, since the role is what the report counts by", () => {
    const { role: _role, ...noRole } = spawned;

    expect(parseEvent(noRole, "input")).toMatchObject({
      ok: false,
      field: "role",
    });
  });

  it("refuses a reason longer than 100 characters, so the ledger never drops it silently", () => {
    expect(
      parseEvent({ ...spawned, label: "x".repeat(101) }, "input"),
    ).toMatchObject({ ok: false, field: "label" });
  });
});
