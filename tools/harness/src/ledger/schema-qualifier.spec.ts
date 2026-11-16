import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-16T10:00:00.000Z" };

describe("qualifier warning events", () => {
  it("are a kind a tool may record, never one only the poller writes", () => {
    expect(KINDS).toContain("qualifier.warned");
    expect(POLLER_KINDS).not.toContain("qualifier.warned");
  });

  it("records a warning with the idea, its issue number and the warning it names", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "qualifier.warned",
          idea: "#866",
          number: 866,
          label: "guard-metric: friction.total",
        },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses a warning with no issue number", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "qualifier.warned",
          label: "guard-metric: friction.total",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "number" });
  });
});
