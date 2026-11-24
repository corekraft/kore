export { FlagError, environments, readOverlay, withFlagOn } from "./overlay.js";
export { assertMayTurnOn, flagRequires } from "./requirements.js";
export { platformWindows } from "./app-window-store.js";
export { recordAppFlagWindow } from "./app-window-writer.js";
export type { AppWindowInput } from "./app-window-writer.js";
export { activationProof, findProof, isWaiverRefusal } from "./proof.js";
export type { ActivationProof, Proof, ProofSource } from "./proof.js";
export { parseCharts, renderCharts } from "./recorded-lock.js";
export type { RecordedChart } from "./recorded-lock.js";
export { parseReleaseLock } from "./release-lock.js";
export type { ReleaseLock } from "./release-lock.js";
export {
  proofAudit,
  unprovenFlags,
  unprovenLine,
  waivedLine,
} from "./audit.js";
export type { ProofAudit, UnprovenFlag, WaivedFlag } from "./audit.js";
