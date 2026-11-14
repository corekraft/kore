import { describe, expect, it } from "vitest";
import { KINDS, parseEvent } from "./schema.js";

const sample = {
  source: "herdr",
  kind: "host-sample",
  occurredAt: "2026-01-02T03:04:05.000Z",
  load: 3.25,
  memory: 0.4,
  swap: 5108137984,
  sessions: 2,
  platform: true,
};

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("host-sample event", () => {
  it("is a ledger kind", () => {
    expect(KINDS).toContain("host-sample");
  });

  it("accepts a whole sample", () => {
    expect(parseEvent(sample, "input").ok).toBe(true);
  });

  it("accepts a sample whose load, memory and swap are all absent, but needs the count and the platform flag", () => {
    const { load, memory, swap, ...bare } = sample;
    expect([load, memory, swap]).toHaveLength(3);
    expect(parseEvent(bare, "input").ok).toBe(true);
    const { sessions, ...noCount } = bare;
    expect(sessions).toBe(2);
    expect(rejected(noCount).field).toBe("sessions");
    const { platform, ...noFlag } = bare;
    expect(platform).toBe(true);
    expect(rejected(noFlag).field).toBe("platform");
  });

  it.each([
    ["load", -1],
    ["load", "high"],
    ["memory", 1.5],
    ["memory", -0.1],
    ["swap", -5],
    ["swap", 1.5],
    ["sessions", -1],
    ["sessions", 1.5],
    ["platform", "yes"],
  ])("rejects %s of %j", (field, value) => {
    expect(rejected({ ...sample, [field]: value }).field).toBe(field);
  });

  it.each(["load", "memory", "swap", "sessions", "platform"])(
    "refuses %s on any other kind",
    (field) => {
      const other = {
        source: "claude",
        kind: "session.start",
        occurredAt: sample.occurredAt,
        [field]: field === "platform" ? true : 1,
      };
      expect(rejected(other).field).toBe(field);
    },
  );
});
