// The scan's roll-up of the main session's figures (#940), as a unit: the transcripts,
// the session analysis and the locations are mocked, so only the scan's tally runs.
// The analysis's own figures are in retro-session-main.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { scan } from "./retro-scan.js";
import { add, wireSessions } from "./retro-scan-support.js";

const locations = vi.hoisted(() => ({ add: vi.fn(), sorted: vi.fn() }));

vi.mock("./retro-transcript.js", () => ({
  parseTranscript: vi.fn(),
  timestamps: vi.fn(),
}));
vi.mock("./retro-session.js", () => ({ SessionAnalysis: vi.fn() }));
vi.mock("./retro-locations.js", () => ({
  RuleLocations: vi.fn(function () {
    return locations;
  }),
}));

const scanOf = (ids: string[]) =>
  scan(
    ids.map((id) => ({ id, text: "" })),
    {},
  );

beforeEach(wireSessions);

describe("scan: the main session's figures are summed over the main sessions only", () => {
  it("sums poll minutes, reads and sends over the main sessions, and leaves a role session out", () => {
    add("main-a", {
      sessionName: undefined,
      main: { pollMs: 300_000, reads: 2, signed: 1, raw: 0 },
    });
    add("main-b", {
      sessionName: undefined,
      main: { pollMs: 60_000, reads: 1, signed: 0, raw: 3 },
    });
    add("role-w1", {
      sessionName: "w1",
      main: { pollMs: 999_999, reads: 9, signed: 9, raw: 9 },
    });
    expect(scanOf(["main-a", "main-b", "role-w1"]).mainSession).toEqual({
      sessions: 2,
      pollMinutes: 6,
      paneReads: 3,
      signedSends: 1,
      rawSends: 3,
    });
  });

  it("reports zeros, not an absent figure, when no main session is in the window", () => {
    add("role-w2", {
      sessionName: "w2",
      main: { pollMs: 0, reads: 0, signed: 0, raw: 0 },
    });
    expect(scanOf(["role-w2"]).mainSession).toEqual({
      sessions: 0,
      pollMinutes: 0,
      paneReads: 0,
      signedSends: 0,
      rawSends: 0,
    });
  });
});
