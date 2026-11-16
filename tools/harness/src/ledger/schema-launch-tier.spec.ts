import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const launch = {
  source: "herdr",
  kind: "session.launch",
  occurredAt: "2026-01-02T03:04:05.000Z",
  role: "judge",
  tier: "claude-sonnet-5-5",
};

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("session.launch tier source", () => {
  it("still parses a launch written before the field existed, and a stored one", () => {
    expect(parseEvent(launch, "input").ok).toBe(true);
    expect(
      parseEvent(
        {
          ...launch,
          schema: 1,
          id: "e1",
          recordedAt: "2026-01-02T03:04:06.000Z",
        },
        "stored",
      ).ok,
    ).toBe(true);
  });

  it("accepts a tier source with its reason", () => {
    expect(
      parseEvent(
        { ...launch, tierSource: "override", tierReason: "deep diff" },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses an unknown tier source", () => {
    expect(rejected({ ...launch, tierSource: "guess" }).field).toBe(
      "tierSource",
    );
  });

  it("refuses a tier source or reason on any other kind of event", () => {
    const other = { ...launch, kind: "session.start", role: undefined };
    expect(
      rejected({ ...other, tier: undefined, tierSource: "override" }).field,
    ).toBe("tierSource");
    expect(
      rejected({ ...other, tier: undefined, tierReason: "why" }).field,
    ).toBe("tierReason");
  });
});
