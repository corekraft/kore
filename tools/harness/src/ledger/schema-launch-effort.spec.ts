import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const launch = {
  source: "herdr",
  kind: "session.launch",
  occurredAt: "2026-01-02T03:04:05.000Z",
  role: "writer",
  tier: "claude-sonnet-5-5",
};

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("session.launch effort", () => {
  it("parses a launch with its effort, as input and as stored", () => {
    expect(parseEvent({ ...launch, effort: "medium" }, "input").ok).toBe(true);
    expect(
      parseEvent(
        {
          ...launch,
          effort: "medium",
          schema: 1,
          id: "e1",
          recordedAt: "2026-01-02T03:04:06.000Z",
        },
        "stored",
      ).ok,
    ).toBe(true);
  });

  it("still parses a launch written before the field existed, which reads as an unknown effort", () => {
    const result = parseEvent(launch, "input");
    expect(result.ok).toBe(true);
    expect(result.ok && result.event).not.toHaveProperty("effort");
  });

  it("accepts every level the spawn can set", () => {
    for (const level of ["low", "medium", "high", "xhigh", "max"]) {
      expect(parseEvent({ ...launch, effort: level }, "input").ok).toBe(true);
    }
  });

  it("refuses an effort the spawn cannot set, naming the field", () => {
    expect(rejected({ ...launch, effort: "ultra" }).field).toBe("effort");
  });

  it("refuses an effort on any other kind of event", () => {
    const other = {
      source: "herdr",
      kind: "session.start",
      occurredAt: "2026-01-02T03:04:05.000Z",
    };
    expect(rejected({ ...other, effort: "high" }).field).toBe("effort");
  });
});
