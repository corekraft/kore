export { FlagError, environments, readOverlay, withFlagOn } from "./overlay.js";
export type { Overlay } from "./overlay.js";
export { parseManifest } from "./manifest.js";
export {
  FLAG_MANIFEST,
  assertMayTurnOn,
  flagRequires,
} from "./requirements.js";
export { remainingReferences } from "./retire-references.js";
export type { Reference } from "./retire-references.js";
export { withoutManifestEntry } from "./retire-manifest.js";
export { withoutFlag } from "./retire-overlay.js";
export { retireRefusals, retirementEnvironments } from "./retire-verdict.js";
export type { RetireEnvironment, RetireFacts } from "./retire-verdict.js";
export { platformWindows } from "./app-window-store.js";
export { recordAppFlagWindow } from "./app-window-writer.js";
export type { AppWindowInput } from "./app-window-writer.js";
export {
  activationProof,
  findProof,
  isWaiverRefusal,
  recordedProofs,
} from "./proof.js";
export { readManifest, readManifestText } from "./manifest.js";
export type { FlagKind, ManifestEntry } from "./manifest.js";
export { progressOf } from "./progress.js";
export type {
  ExcludedFlag,
  FlagRow,
  ProgressInput,
  ProgressReport,
} from "./progress.js";
export { renderProgress } from "./progress-text.js";
export type { ActivationProof, Proof, ProofSource } from "./proof.js";
export { parseCharts, renderCharts } from "./recorded-lock.js";
export type { RecordedChart } from "./recorded-lock.js";
export { parseReleaseLock } from "./release-lock.js";
export type { ReleaseLock } from "./release-lock.js";
export {
  VPS_ENVIRONMENT,
  proofAudit,
  unprovenFlags,
  unprovenLine,
  vpsLine,
  vpsUnprovenFlags,
  waivedLine,
} from "./audit.js";
export type { ProofAudit, UnprovenFlag, WaivedFlag } from "./audit.js";
