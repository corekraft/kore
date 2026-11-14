// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expect, test, vi } from "vitest";
import * as flag from "./index.js";
import { unprovenFlags, unprovenLine } from "./audit.js";
import { FlagError, environments, readOverlay, withFlagOn } from "./overlay.js";
import { findProof } from "./proof.js";

vi.mock("./audit.js");
vi.mock("./overlay.js");
vi.mock("./proof.js");

test("the flag barrel exposes exactly the overlay, proof and audit entry points", () => {
  expect(Object.keys(flag).sort()).toEqual(
    [
      "FlagError",
      "environments",
      "findProof",
      "readOverlay",
      "unprovenFlags",
      "unprovenLine",
      "withFlagOn",
    ].sort(),
  );
});

test("the flag barrel re-exports each module's own function, not a copy", () => {
  expect(flag.FlagError).toBe(FlagError);
  expect(flag.environments).toBe(environments);
  expect(flag.readOverlay).toBe(readOverlay);
  expect(flag.withFlagOn).toBe(withFlagOn);
  expect(flag.findProof).toBe(findProof);
  expect(flag.unprovenFlags).toBe(unprovenFlags);
  expect(flag.unprovenLine).toBe(unprovenLine);
});
