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
export {
  nodePortService,
  runningK3d,
  runningK3dCluster,
} from "../platform/k3d-fixtures.js";
export { manifestImages } from "../config/manifest-images.js";
export {
  imageInventory,
  imageInventoryStatus,
} from "../platform/image-inventory.js";
export {
  grantProofGateAccess,
  proofGateAccess,
  revokeProofGateAccess,
} from "../platform/gate-proof-access.js";
export {
  activationLabel,
  admissionGateStatus,
  assertAdmissionGateOpen,
  closedAdmissionGate,
  ensureClosedAdmissionGate,
  openAdmissionGate,
  platformGeneration,
  readAdmissionGate,
} from "../platform/admission-gate.js";
export { gateCrdJson } from "../platform/admission-gate-support.js";
export {
  crashLoop,
  liveCniFailure,
  liveSandboxOom,
  oci,
  pod,
  reconcile,
  sandboxOom,
  Scenario,
  waiting,
} from "../platform/fail-fast.fixtures.js";
export type { FakeEvent } from "../platform/fail-fast.fixtures.js";
export { bootstrapControllers } from "../platform/bootstrap.js";
export { enrollPlatformNamespaces } from "../platform/enrollment.js";
export { managedNamespaces } from "../platform/gated-release.js";
export { currentGateParameters } from "../platform/admission-gate-support.js";
// Platform units that the integration specs of Helm, reconcile and patches run
// together (plan 14, #424). Production code never imports it, so the platform
// barrel stays as it is.
export { desiredFingerprint } from "../platform/fingerprint.js";
export { platformStatus } from "../platform/status.js";
export { platformRender } from "../platform/render.js";
export {
  IngressMeasurement,
  ingressRoutes,
} from "../platform/ingress-measurement.js";
export {
  FakeLoad,
  expectedStatus,
  fixture,
  metrics,
  ok as measurementOk,
  options,
  sampleResponses,
} from "../platform/ingress-measurement.fixtures.js";
export {
  helmEnv,
  helmTemplateArgs,
  helmUpgradeArgs,
} from "../platform/helm.js";
export { recoverUndeployedRelease } from "../platform/reconcile.js";
export type { ProbePatch } from "../platform/patches.js";
export { envOption } from "../platform/helm.js";
// Platform and image units that the integration specs of upstream charts, container
// smoke and rollout feasibility run through this barrel (plan 14, #373). Production code
// never imports it, so the platform and images barrels stay as they are.
export { renderedImages, unapprovedImages } from "../images/rendered-images.js";
export {
  classifySmokeLogs,
  dockerRunArgs,
  smokeTargets,
} from "../platform/container-smoke.js";
export { renderChart, yamlDocuments } from "../platform/upstream.live.js";
export { rolloutProblems } from "../platform/rollout-feasibility.js";
