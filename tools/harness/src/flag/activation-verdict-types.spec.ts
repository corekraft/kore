// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { describe, expect, it } from "vitest";
import { ACTIVATION_DEFAULTS } from "./activation-verdict-types.js";

describe("ACTIVATION_DEFAULTS", () => {
  it("holds the thresholds the owner decided on #1486, one value for every app", () => {
    expect(ACTIVATION_DEFAULTS).toEqual({
      maxErrorRatio: 0.05,
      errorRatioAboveBaseline: 0.02,
      p95BaselineMultiple: 2,
      p95FloorMs: 250,
      minRequests: 100,
      minDarkSpanMs: 30 * 60_000,
      minFlagProofSpanMs: 60 * 60_000,
      failedMeasurementTolerance: 3,
      minFreeDiskRatio: 0.2,
    });
  });
});
