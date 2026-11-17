// The handover count's line in the flow report's text: its count with every reason, or
// insufficient with the reason it is not read. Real module; the figures are fixtures.

import { describe, expect, it } from "vitest";
import { handoverLine } from "./flow-lines.js";
import type { FlowReport } from "../flow/index.js";

describe("handoverLine prints the handover count or why it is not read", () => {
  it("prints the count and each reason's count for a window with handovers", () => {
    const handovers: FlowReport["handovers"] = {
      status: "ok",
      handovers: 3,
      merged: 12,
      byReason: {
        "reserved-item": 0,
        "needs-info-idea": 2,
        "third-send-back": 0,
        "owner-request": 1,
        "flag-activation": 0,
        "unmapped-message": 0,
      },
    };

    expect(handoverLine(handovers)).toBe(
      "Handovers from the main session: 3 (reserved-item 0, needs-info-idea 2, third-send-back 0, owner-request 1, flag-activation 0, unmapped-message 0)",
    );
  });

  it("says insufficient and the reason, never a zero, when the window is not read", () => {
    expect(
      handoverLine({
        status: "insufficient",
        reason: "no handover reason recorded in the window",
      }),
    ).toBe(
      "Handovers from the main session: insufficient, no handover reason recorded in the window",
    );
  });
});
