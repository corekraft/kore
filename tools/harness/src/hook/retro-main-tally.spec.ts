// The scan's roll-up of the main session's figures (#940): summed over the main
// sessions only, poll minutes to four places, and zeros when there is none.

import { describe, expect, it } from "vitest";
import { MainSessionTally } from "./retro-main-tally.js";

const figures = (
  pollMs: number,
  reads: number,
  signed: number,
  raw: number,
) => ({
  pollMs,
  reads,
  signed,
  raw,
});

describe("MainSessionTally: the main session's figures, summed over the main sessions", () => {
  it("sums the figures of each session with no spawn-brief name, and counts those sessions", () => {
    const tally = new MainSessionTally();
    tally.add({ sessionName: undefined, main: figures(60_000, 1, 2, 3) });
    tally.add({ sessionName: undefined, main: figures(120_000, 4, 0, 1) });
    expect(tally.report()).toEqual({
      sessions: 2,
      pollMinutes: 3,
      paneReads: 5,
      signedSends: 2,
      rawSends: 4,
    });
  });

  it("leaves out a session a spawn brief names, whatever its own figures say", () => {
    const tally = new MainSessionTally();
    tally.add({ sessionName: "w1", main: figures(999_000, 9, 9, 9) });
    expect(tally.report()).toEqual({
      sessions: 0,
      pollMinutes: 0,
      paneReads: 0,
      signedSends: 0,
      rawSends: 0,
    });
  });

  it("rounds poll minutes to four places, so the report stays readable", () => {
    const tally = new MainSessionTally();
    tally.add({ sessionName: undefined, main: figures(100_000, 0, 0, 0) });
    expect(tally.report().pollMinutes).toBe(1.6667);
  });
});
