// The main-session setup lines in the flow report's text (#1046): each stretch with its
// derived label, the cap it was read against, or why nothing is read. The figures are fixtures.

import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { setupLines } from "./flow-lines-setups.js";

describe("setupLines prints each stretch's derived setup", () => {
  it("prints the cap and one line per stretch with its model, largest prompt and label", () => {
    const setups: FlowReport["mainSessionSetups"] = {
      status: "ok",
      compactionCap: 80_000,
      stretches: [
        {
          session: "a",
          model: "claude-opus-5-5",
          largestPrompt: 90_000,
          label: "control",
        },
        {
          session: "b",
          model: "claude-haiku-5-5",
          largestPrompt: 10,
          label: "Haiku",
        },
      ],
    };

    expect(setupLines(setups)).toEqual([
      "Main-session setups (compaction cap 80000):",
      "  a claude-opus-5-5, largest prompt 90000: control",
      "  b claude-haiku-5-5, largest prompt 10: Haiku",
    ]);
  });

  it("says the cap is not set, never a zero, and prints each stretch as not set", () => {
    const setups: FlowReport["mainSessionSetups"] = {
      status: "ok",
      compactionCap: null,
      stretches: [
        {
          session: "a",
          model: "claude-opus-5-5",
          largestPrompt: 90_000,
          label: "not set",
        },
      ],
    };

    expect(setupLines(setups)).toEqual([
      "Main-session setups (compaction cap not set):",
      "  a claude-opus-5-5, largest prompt 90000: not set",
    ]);
  });
});

describe("setupLines prints what it cannot label", () => {
  it("prints why a stretch is insufficient, with no model or prompt to show", () => {
    const setups: FlowReport["mainSessionSetups"] = {
      status: "ok",
      compactionCap: 80_000,
      stretches: [
        {
          session: "bare",
          model: null,
          largestPrompt: null,
          label: "insufficient",
          reason: "no token.split reading recorded for the session",
        },
      ],
    };

    expect(setupLines(setups)).toEqual([
      "Main-session setups (compaction cap 80000):",
      "  bare no model, largest prompt none: insufficient (no token.split reading recorded for the session)",
    ]);
  });

  it("says insufficient and the reason when no main-session stretch was recorded", () => {
    expect(
      setupLines({
        status: "insufficient",
        reason: "no main-session reading recorded in the window",
      }),
    ).toEqual([
      "Main-session setups: insufficient, no main-session reading recorded in the window",
    ]);
  });
});
