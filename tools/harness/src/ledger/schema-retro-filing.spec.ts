import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-15T10:00:00.000Z" };

describe("retro filing events", () => {
  it("are kinds a tool may record, never ones only the poller writes", () => {
    for (const kind of ["idea.filed", "retro.dropped"]) {
      expect(KINDS).toContain(kind);
      expect(POLLER_KINDS).not.toContain(kind);
    }
  });

  it("records an idea filed with the idea and the key it was filed under", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "idea.filed",
          idea: "0123",
          label: "retro-1-ab12cd34",
        },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("records the proposals one retro dropped with the trigger and a count", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "retro.dropped",
          label: "retro-20261115-1030",
          number: 3,
        },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses a dropped count that is missing or not positive", () => {
    const base = { ...stamp, kind: "retro.dropped", label: "retro-1" };
    expect(parseEvent(base, "input")).toMatchObject({
      ok: false,
      field: "number",
    });
    expect(parseEvent({ ...base, number: 0 }, "input")).toMatchObject({
      ok: false,
      field: "number",
    });
  });
});
