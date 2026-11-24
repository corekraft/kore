import { expect, test, vi } from "vitest";

// The barrel only re-exports. Each module it names is an automock, so this spec
// tests the barrel's own surface and nothing the modules do (ADR 0098).
vi.mock("./bootstrap.js");
vi.mock("./readiness-manifest.js");
vi.mock("./lifecycle.js");
vi.mock("./render.js");
vi.mock("./patches.js");
vi.mock("./crd-ownership-status.js");
vi.mock("./status.js");
vi.mock("./up.js");
vi.mock("./chart-delivery.js");
vi.mock("./fingerprint.js");
vi.mock("./reconcile.js");
vi.mock("./admission-gate.js");
vi.mock("./image-inventory.js");
vi.mock("./readiness-gateway.js");
vi.mock("./release-recovery.js");
vi.mock("./helm.js");
vi.mock("./capacity-status.js");
vi.mock("./evidence-reader.js");

const barrel = await import("./index.js");

test("the platform barrel exposes exactly the runtime names its callers use", () => {
  expect(Object.keys(barrel).sort()).toEqual(
    [
      "ChartPackagingError",
      "activationLabel",
      "admissionGate",
      "admissionGateStatusName",
      "applyProbePatches",
      "argsFingerprint",
      "assertAdmissionGateOpen",
      "bootstrapControllers",
      "capacityWarningPercent",
      "chartLockDrift",
      "chartLockDriftMessage",
      "closeGateIfDegraded",
      "composeChartDelivery",
      "composeGoldenPathDelivery",
      "ensureClosedAdmissionGate",
      "envOption",
      "fetchMainChartLock",
      "helmEnv",
      "helmTemplateArgs",
      "helmUpgradeArgs",
      "imageInventoryStatusName",
      "platformClaimsStatus",
      "platformDestroy",
      "platformGeneration",
      "platformRender",
      "platformStatus",
      "platformStatusReport",
      "platformStop",
      "platformUp",
      "readAdmissionGate",
      "readEvidence",
      "readinessFailureSummary",
      "recoverRelease",
      "releaseMatchesFingerprint",
      "routeHostErrors",
      "upChartLockDrift",
      "waitForHTTPRoute",
      "withAbsoluteChart",
    ].sort(),
  );
});
