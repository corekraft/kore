import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const OCCURRED = "2026-11-16T10:00:00.000Z";

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("retro.main-session records one scan's main-session figures and nothing else (#940)", () => {
  const scan = {
    source: "claude",
    kind: "retro.main-session",
    occurredAt: OCCURRED,
    windowStart: "2026-11-02T00:00:00.000Z",
    windowEnd: OCCURRED,
    pollMinutes: 12.5,
    paneReads: 3,
    signedSends: 4,
    rawSends: 1,
  };

  it("accepts a scan whose payload is its window and its five numbers", () => {
    expect(parseEvent(scan, "input")).toEqual({ ok: true, event: scan });
  });

  it("accepts zero counts, because an empty window is a measured zero", () => {
    const empty = { ...scan, pollMinutes: 0, paneReads: 0, signedSends: 0 };
    expect(parseEvent(empty, "input")).toEqual({ ok: true, event: empty });
  });

  it("refuses a negative or fractional pane read count", () => {
    expect(rejected({ ...scan, paneReads: -1 })).toEqual({
      ok: false,
      field: "paneReads",
      message:
        'Invalid event: field "paneReads" must be a non-negative whole number.',
    });
    expect(rejected({ ...scan, paneReads: 1.5 }).field).toBe("paneReads");
  });

  it("refuses a poll minutes figure that is not a finite non-negative number", () => {
    expect(rejected({ ...scan, pollMinutes: -0.5 }).field).toBe("pollMinutes");
    expect(rejected({ ...scan, pollMinutes: Number.NaN }).field).toBe(
      "pollMinutes",
    );
  });

  it("refuses a scan whose window start is not a timestamp", () => {
    expect(rejected({ ...scan, windowStart: "2026-11-02" }).field).toBe(
      "windowStart",
    );
  });

  it("refuses a scan with no window end, so a window is never open-ended by accident", () => {
    expect(rejected({ ...scan, windowEnd: undefined })).toEqual({
      ok: false,
      field: "windowEnd",
      message:
        'Invalid event: field "windowEnd" is required on retro.main-session events.',
    });
  });

  it("refuses command text, which the ledger never stores", () => {
    expect(rejected({ ...scan, command: "herdr agent read w3:p1" })).toEqual({
      ok: false,
      field: "command",
      message:
        'Invalid event: field "command" is not a ledger field and is never stored.',
    });
  });

  it("refuses the scan fields on a kind that does not carry them", () => {
    expect(rejected({ ...scan, kind: "session.stop" }).field).toBe(
      "windowStart",
    );
  });
});
