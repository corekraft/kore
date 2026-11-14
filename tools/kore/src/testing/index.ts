export {
  digest,
  gateOutput,
  healthyReadinessOutput,
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  pushPassword,
  readPassword,
  releaseNotFound,
  releaseSigner,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
} from "./app-fixtures.js";
export type { Call } from "./app-fixtures.js";
export {
  fakeRunner,
  fast,
  k3dRepository,
  list,
  ok,
  testHome,
  text,
  trustVolumeArgs,
} from "./k3d-cluster.fixtures.js";
export {
  gatedOffReleaseAbsent,
  healthyDaemonSetOutput,
  healthyWebhookOutput,
  withHealthyWebhooks,
} from "./webhook-fixtures.js";
export {
  loadManagedLocal,
  managedClusterSettings,
} from "./managed-local.fixtures.js";
export {
  CIPHERTEXT,
  FakeRunner,
  NOW,
  PLAINTEXT,
  RECIPIENT,
  exportOptions,
  useExportRepository,
} from "./data-export.fixtures.js";
export { registryCaPem, registryTlsSecret } from "./registry-tls-fixtures.js";
export { readyRows } from "./platform-readiness.fixtures.js";
export { healthyClusterOutput } from "./platform-resilience.fixtures.js";
// Test-only surface (#491): the integration specs for readiness, status and
// probes run the real platform units together through this barrel. Production
// code never imports it, so the platform barrel stays as it is.
export { reconcileComponent } from "../platform/reconcile.js";
export { readinessFailure } from "../platform/readiness.js";
export { retryBudget } from "../platform/readiness-poll.js";
export { openApplicationAdmission } from "../platform/readiness-gate.js";
export { gatewayCheck, waitForGateway } from "../platform/readiness-gateway.js";
export { backupStatus } from "../platform/backup-status.js";
export {
  capacityStatus,
  parseCpu,
  parseMemory,
} from "../platform/capacity-status.js";
export { crdOwnershipStatus } from "../platform/crd-ownership-status.js";
export {
  admissionVerdict,
  deployedImage,
  ephemeralContainerVerdict,
  runningPodWithImage,
  scaleDeployment,
} from "../platform/admission-probe.js";
export {
  publishSignedCopy,
  publishUntrustedCopies,
} from "../platform/admission-probe-copies.js";
export {
  evaluateReadiness,
  readinessEvidenceName,
  readinessEvidenceObject,
} from "../platform/readiness-manifest.js";
export { withAbsoluteChart } from "../platform/helm.js";
export { manifestImages } from "../config/manifest-images.js";
