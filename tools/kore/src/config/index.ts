// Docs: infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation
export {
  alertEmailHelmArgs,
  smtpSecretName,
  smtpSecretNamespace,
} from "./alert-email.js";
export { alertForwardingHelmArgs } from "./alert-forwarding.js";
export { dashboardSidecarHelmArgs } from "./dashboard-sidecar.js";
export { registeredServiceHelmArgs } from "./service-registrations.js";
export { isLocalProvider } from "./provider.js";
export {
  absolute,
  componentValues,
  componentVersion,
  expandVersions,
  loadRepository,
  orderedComponents,
} from "./config.js";
export {
  checkCrdOwnership,
  providerCrdGroupErrors,
  providerOwnsCrd,
  crdGroupErrors,
  crdNameFormatErrors,
  crdOwners,
  renderedCrdNames,
} from "./crd-ownership.js";
export type { CrdClaims, CrdOwnership } from "./crd-ownership.js";
export { localSigner, noMatchPolicy, trustedSigners } from "./image-trust.js";
export {
  promoteConstraint,
  recordPromotionEvidence,
  rollbackConstraint,
} from "./policy-promotion-change.js";
export type { PromotionChange } from "./policy-promotion-change.js";
export {
  auditEvidence,
  evaluateAudit,
  policyPromotionErrors,
} from "./policy-promotion.js";
export type {
  AuditEvidence,
  AuditReport,
  PromotionRecord,
} from "./policy-promotion.js";
export {
  localCaConfigMap,
  platformHelmArgs,
  platformPlan,
} from "./platform-domain.js";
export type { PlatformPlan } from "./platform-domain.js";
export { registryByName, registryHostname } from "./registry-name.js";
export {
  registryConsumers,
  registryHelmArgs,
  registryPlan,
} from "./registry-address.js";
export type {
  ApprovedImage,
  ApprovedImageManifest,
  Catalog,
  Component,
  ComponentKind,
  Environment,
  K3dCluster,
  Phase,
  ProbePatch,
  Repository,
  Seed,
  SeedManifest,
  Versions,
} from "./config.js";
export { patchableKinds, probeFields, probeNames } from "./patch-validation.js";
export { approvedImageList } from "./approved.js";
export type { ApprovedEntry } from "./approved.js";
export {
  agentgatewayMeshEnrollmentFlag,
  autoscalingFlag,
  componentGatedOff,
  enabledComponents,
  featureEnabled,
  featureHelmArgs,
  gatewayClassChangeFlag,
  gatewayRollbackOrderFlag,
  gatewayClassName,
  ingressFlag,
  localImageReuseFlag,
  organizationServiceApisFlag,
  platformArgocdDeliveryFlag,
  platformDnsFlag,
  platformPortalFlag,
  registryPruneFlag,
} from "./features.js";
export {
  chartDeliveryValues,
  chartRepositoryUrls,
  databaseRoutesDeliveryArgs,
} from "./chart-delivery.js";
export type { ChartDeliveryValues } from "./chart-delivery.js";
export type { GoldenPathDeliveryValues } from "./types.js";
export {
  configDeliveryRelease,
  helmInstalledComponents,
  releaseOwner,
} from "./ownership.js";
export { managedCluster } from "./managed-cluster.js";
export type { ManagedCluster } from "./managed-cluster.js";
export { findRoot } from "./config.js";
export { exemptionCheckMode, validateRepository } from "./validate.js";
export type { WarningSource } from "./validate.js";
export { exists } from "./files.js";
export { platformClaimErrors } from "./platform-claims.js";

// Golden-path template session cookie policy (plan 15 Step 4).
export { sessionCookieViolations } from "./template-cookie.js";
