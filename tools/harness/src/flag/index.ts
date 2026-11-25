export { FlagError, environments, readOverlay, withFlagOn } from "./overlay.js";
export { assertMayTurnOn, flagRequires } from "./requirements.js";
export { platformWindows } from "./app-window-store.js";
export { recordAppFlagWindow } from "./app-window-writer.js";
export type { AppWindowInput } from "./app-window-writer.js";
export {
  activationProof,
  findProof,
  isWaiverRefusal,
  recordedProofs,
} from "./proof.js";
export { readManifest } from "./manifest.js";
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
