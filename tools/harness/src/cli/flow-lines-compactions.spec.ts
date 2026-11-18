// The compaction count's line in the flow report's text: the total over sessions, or
// insufficient with why it is not read. Real module; the figures are fixtures.

import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { compactionLine } from "./flow-lines.js";

describe("compactionLine prints the compaction count or why it is not read", () => {
  it("prints the total and the sessions it covers", () => {
    const compactions: FlowReport["compactions"] = {
      status: "ok",
      compactions: 3,
      sessions: 2,
      perSession: { a: 2, b: 1 },
    };

    expect(compactionLine(compactions)).toBe(
      "Compactions: 3 over 2 session(s) (a 2, b 1)",
    );
  });

  it("says insufficient and the reason, never a zero, when no session was recorded", () => {
    expect(
      compactionLine({
        status: "insufficient",
        reason: "no session recorded in the window",
      }),
    ).toBe("Compactions: insufficient, no session recorded in the window");
  });
});
