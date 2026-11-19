// Docs: infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation
import { expect, test, vi } from "vitest";
import * as config from "./index.js";
import { approvedImageList } from "./approved.js";
import { checkCrdOwnership } from "./crd-ownership.js";
import { exists } from "./files.js";
import { featureEnabled } from "./features.js";
import { findRoot, loadRepository } from "./config.js";
import { isLocalProvider } from "./provider.js";
import { managedCluster } from "./managed-cluster.js";
import { patchableKinds } from "./patch-validation.js";
import { registryPlan } from "./registry-address.js";
import { trustedSigners } from "./image-trust.js";
import { evaluateAudit } from "./policy-promotion.js";
import { promoteConstraint } from "./policy-promotion-change.js";
import { validateRepository } from "./validate.js";

// Factories, not automocks: each module exports exactly the names the barrel
// re-exports, and no real module graph loads here.
vi.mock("./alert-email.js", () => ({
  alertEmailHelmArgs: vi.fn(),
  smtpSecretName: "grafana-smtp",
  smtpSecretNamespace: "observability",
}));
vi.mock("./alert-forwarding.js", () => ({
  alertForwardingHelmArgs: vi.fn(),
}));
vi.mock("./dashboard-sidecar.js", () => ({
  dashboardSidecarHelmArgs: vi.fn(),
}));
vi.mock("./approved.js", () => ({ approvedImageList: vi.fn() }));
vi.mock("./chart-delivery.js", () => ({
  chartDeliveryValues: vi.fn(),
  chartRepositoryUrls: vi.fn(),
}));
vi.mock("./config.js", () => ({
  absolute: vi.fn(),
  componentValues: vi.fn(),
  componentVersion: vi.fn(),
  expandVersions: vi.fn(),
  findRoot: vi.fn(),
  loadRepository: vi.fn(),
  orderedComponents: vi.fn(),
}));
vi.mock("./crd-ownership.js", () => ({
  checkCrdOwnership: vi.fn(),
  crdGroupErrors: vi.fn(),
  crdNameFormatErrors: vi.fn(),
  crdOwners: vi.fn(),
  providerCrdGroupErrors: vi.fn(),
  providerOwnsCrd: vi.fn(),
  renderedCrdNames: vi.fn(),
}));
vi.mock("./features.js", () => ({
  agentgatewayMeshEnrollmentFlag: "agentgateway-mesh-enrollment",
  autoscalingFlag: "autoscaling-defaults",
  componentGatedOff: vi.fn(),
  enabledComponents: vi.fn(),
  featureEnabled: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassChangeFlag: "gateway-class-change-release",
  gatewayClassName: vi.fn(),
  gatewayRollbackOrderFlag: "gateway-rollback-order",
  ingressFlag: "ingress-agentgateway",
  localImageReuseFlag: "local-image-reuse",
  organizationServiceApisFlag: "platform-organization-service-apis",
  platformArgocdDeliveryFlag: "platform-argocd-delivery",
  platformPortalFlag: "platform-portal",
  registryPruneFlag: "registry-tag-pruning",
}));
vi.mock("./ownership.js", () => ({
  helmInstalledComponents: vi.fn(),
  releaseOwner: vi.fn(),
}));
vi.mock("./files.js", () => ({ exists: vi.fn() }));
vi.mock("./image-trust.js", () => ({
  localSigner: "local-kore-key",
  noMatchPolicy: vi.fn(),
  trustedSigners: vi.fn(),
}));
vi.mock("./managed-cluster.js", () => ({ managedCluster: vi.fn() }));
vi.mock("./patch-validation.js", () => ({
  patchableKinds: vi.fn(),
  probeFields: vi.fn(),
  probeNames: vi.fn(),
}));
vi.mock("./policy-promotion.js", () => ({
  auditEvidence: vi.fn(),
  evaluateAudit: vi.fn(),
  policyPromotionErrors: vi.fn(),
}));
vi.mock("./policy-promotion-change.js", () => ({
  promoteConstraint: vi.fn(),
  recordPromotionEvidence: vi.fn(),
  rollbackConstraint: vi.fn(),
}));
vi.mock("./provider.js", () => ({ isLocalProvider: vi.fn() }));
vi.mock("./registry-address.js", () => ({
  registryConsumers: [],
  registryHelmArgs: vi.fn(),
  registryPlan: vi.fn(),
}));
vi.mock("./validate.js", () => ({ validateRepository: vi.fn() }));

test("the config barrel exposes exactly the entry points other domains use", () => {
  expect(Object.keys(config).sort()).toEqual([
    "absolute",
    "agentgatewayMeshEnrollmentFlag",
    "alertEmailHelmArgs",
    "alertForwardingHelmArgs",
    "approvedImageList",
    "auditEvidence",
    "autoscalingFlag",
    "chartDeliveryValues",
    "chartRepositoryUrls",
    "checkCrdOwnership",
    "componentGatedOff",
    "componentValues",
    "componentVersion",
    "configDeliveryRelease",
    "crdGroupErrors",
    "crdNameFormatErrors",
    "crdOwners",
    "dashboardSidecarHelmArgs",
    "defaultPlatformDomain",
    "enabledComponents",
    "evaluateAudit",
    "exemptionCheckMode",
    "exists",
    "expandVersions",
    "featureEnabled",
    "featureHelmArgs",
    "findRoot",
    "gatewayClassChangeFlag",
    "gatewayClassName",
    "gatewayRollbackOrderFlag",
    "helmInstalledComponents",
    "ingressFlag",
    "isLocalProvider",
    "loadRepository",
    "localImageReuseFlag",
    "localSigner",
    "managedCluster",
    "noMatchPolicy",
    "orderedComponents",
    "organizationServiceApisFlag",
    "patchableKinds",
    "platformArgocdDeliveryFlag",
    "platformClaimErrors",
    "platformHelmArgs",
    "platformPlan",
    "platformPortalFlag",
    "policyPromotionErrors",
    "probeFields",
    "probeNames",
    "promoteConstraint",
    "providerCrdGroupErrors",
    "providerOwnsCrd",
    "recordPromotionEvidence",
    "registeredServiceHelmArgs",
    "registryConsumers",
    "registryHelmArgs",
    "registryPlan",
    "registryPruneFlag",
    "releaseOwner",
    "renderedCrdNames",
    "rollbackConstraint",
    "sessionCookieViolations",
    "smtpSecretName",
    "smtpSecretNamespace",
    "trustedSigners",
    "validateRepository",
  ]);
});

test("each entry point is the function its own unit defines, not a copy", () => {
  expect(config.isLocalProvider).toBe(isLocalProvider);
  expect(config.loadRepository).toBe(loadRepository);
  expect(config.findRoot).toBe(findRoot);
  expect(config.checkCrdOwnership).toBe(checkCrdOwnership);
  expect(config.trustedSigners).toBe(trustedSigners);
  expect(config.promoteConstraint).toBe(promoteConstraint);
  expect(config.evaluateAudit).toBe(evaluateAudit);
  expect(config.registryPlan).toBe(registryPlan);
  expect(config.patchableKinds).toBe(patchableKinds);
  expect(config.approvedImageList).toBe(approvedImageList);
  expect(config.featureEnabled).toBe(featureEnabled);
  expect(config.managedCluster).toBe(managedCluster);
  expect(config.validateRepository).toBe(validateRepository);
  expect(config.exists).toBe(exists);
});
