// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
export { bootstrapControllers, closeGateIfDegraded } from "./bootstrap.js";
export type { GateCheckResult } from "./bootstrap.js";
export { readinessFailureSummary } from "./readiness-manifest.js";
export { platformStop, platformDestroy } from "./lifecycle.js";
export { platformRender } from "./render.js";
export { applyProbePatches } from "./patches.js";
export { platformStatusReport } from "./crd-ownership-status.js";
export type { CrdOwnershipStatus } from "./crd-ownership-status.js";
export { platformStatus } from "./status.js";
export type { ComponentStatus } from "./status.js";
export { platformUp } from "./up.js";
export { argsFingerprint } from "./fingerprint.js";
export { releaseMatchesFingerprint } from "./reconcile.js";
export {
  admissionGateStatusName,
  assertAdmissionGateOpen,
  ensureClosedAdmissionGate,
  platformGeneration,
  readAdmissionGate,
} from "./admission-gate.js";
export { imageInventoryStatusName } from "./image-inventory.js";
export type { ImageInventory, InventoriedImage } from "./image-inventory.js";
export { waitForHTTPRoute } from "./readiness-gateway.js";
export { activationLabel, admissionGate } from "./admission-gate.js";
export { recoverRelease } from "./release-recovery.js";
export {
  envOption,
  helmEnv,
  helmTemplateArgs,
  helmUpgradeArgs,
  withAbsoluteChart,
} from "./helm.js";
export { capacityWarningPercent } from "./capacity-status.js";
