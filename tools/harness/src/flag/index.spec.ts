// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expect, test, vi } from "vitest";
import * as flag from "./index.js";
import { unprovenFlags, unprovenLine } from "./audit.js";
import { platformWindows } from "./app-window-store.js";
import { recordAppFlagWindow } from "./app-window-writer.js";
import { FlagError, environments, readOverlay, withFlagOn } from "./overlay.js";
import { activationProof, findProof, isWaiverRefusal } from "./proof.js";
import { parseCharts, renderCharts } from "./recorded-lock.js";
import { parseReleaseLock } from "./release-lock.js";

vi.mock("./audit.js");
vi.mock("./overlay.js");
vi.mock("./proof.js");
vi.mock("./recorded-lock.js");
vi.mock("./release-lock.js");

test("the flag barrel exposes exactly the overlay, proof, audit, app window and retirement entry points", () => {
  expect(Object.keys(flag).sort()).toEqual(
    [
      "FLAG_MANIFEST",
      "FlagError",
      "activationProof",
      "assertMayTurnOn",
      "environments",
      "findProof",
      "flagRequires",
      "isWaiverRefusal",
      "parseCharts",
      "parseManifest",
      "parseReleaseLock",
      "platformWindows",
      "proofAudit",
      "progressOf",
      "readManifest",
      "readManifestText",
      "readOverlay",
      "recordAppFlagWindow",
      "recordedProofs",
      "remainingReferences",
      "renderCharts",
      "renderProgress",
      "retireRefusals",
      "retirementEnvironments",
      "unprovenFlags",
      "unprovenLine",
      "VPS_ENVIRONMENT",
      "vpsLine",
      "vpsUnprovenFlags",
      "waivedLine",
      "withFlagOn",
      "withoutFlag",
      "withoutManifestEntry",
    ].sort(),
  );
});

test("the flag barrel re-exports the app window store and writer, not copies", () => {
  expect(flag.platformWindows).toBe(platformWindows);
  expect(flag.recordAppFlagWindow).toBe(recordAppFlagWindow);
});

test("the flag barrel re-exports each module's own function, not a copy", () => {
  expect(flag.FlagError).toBe(FlagError);
  expect(flag.environments).toBe(environments);
  expect(flag.readOverlay).toBe(readOverlay);
  expect(flag.withFlagOn).toBe(withFlagOn);
  expect(flag.findProof).toBe(findProof);
  expect(flag.activationProof).toBe(activationProof);
  expect(flag.isWaiverRefusal).toBe(isWaiverRefusal);
  expect(flag.parseCharts).toBe(parseCharts);
  expect(flag.renderCharts).toBe(renderCharts);
  expect(flag.parseReleaseLock).toBe(parseReleaseLock);
  expect(flag.unprovenFlags).toBe(unprovenFlags);
  expect(flag.unprovenLine).toBe(unprovenLine);
});
