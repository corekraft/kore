// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
export { bootstrapControllers } from "./bootstrap.js";
export { platformStop, platformDestroy } from "./lifecycle.js";
export { platformRender } from "./render.js";
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
