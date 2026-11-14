// Docs: infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation
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
  componentGatedOff,
  enabledComponents,
  featureEnabled,
  featureHelmArgs,
  gatewayClassName,
  ingressFlag,
} from "./features.js";
export { managedCluster } from "./managed-cluster.js";
export type { ManagedCluster } from "./managed-cluster.js";
export { findRoot } from "./config.js";
export { validateRepository } from "./validate.js";
export { exists } from "./files.js";
