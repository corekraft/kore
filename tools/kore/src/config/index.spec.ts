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
import { otlpByName, otlpHostname } from "./platform-domain.js";
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
vi.mock("./keycloak-operator-probe.js", () => ({
  keycloakOperatorProbeHelmArgs: vi.fn(),
}));
vi.mock("./prometheus-memory.js", () => ({
  prometheusPortalHelmArgs: vi.fn(),
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
  apiserverReadyFlag: "platform-apiserver-ready",
  autoscalingFlag: "autoscaling-defaults",
  componentGatedOff: vi.fn(),
  readinessGatedOff: vi.fn(),
  driftListingMappingsFlag: "drift-listing-mappings",
  enabledComponents: vi.fn(),
  featureEnabled: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassChangeFlag: "gateway-class-change-release",
  gatewayClassName: vi.fn(),
  gatewayRollbackOrderFlag: "gateway-rollback-order",
  ingressFlag: "ingress-agentgateway",
  keycloakRealmWaitFlag: "platform-keycloak-realm-wait",
  keycloakWaitFlag: "platform-keycloak-wait",
  localImageReuseFlag: "local-image-reuse",
  organizationServiceApisFlag: "platform-organization-service-apis",
  platformArgocdDeliveryFlag: "platform-argocd-delivery",
  platformDnsFlag: "platform-dns",
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
vi.mock("./registry-name.js", () => ({
  registryByName: vi.fn(),
  registryHostname: vi.fn(),
}));
vi.mock("./validate.js", () => ({ validateRepository: vi.fn() }));

const entryPoints = [
  "RunTimeFileError",
  "absolute",
  "agentgatewayMeshEnrollmentFlag",
  "alertEmailHelmArgs",
  "alertForwardingHelmArgs",
  "apiserverReadyFlag",
  "appliedFlags",
  "approvedImageList",
  "auditEvidence",
  "autoscalingFlag",
  "backstageHostname",
  "chartDeliveryValues",
  "chartRepositoryUrls",
  "checkAppRecords",
  "checkCrdOwnership",
  "checkOrganizationRecords",
  "committedFraction",
  "componentGatedOff",
  "componentValues",
  "componentVersion",
  "configDeliveryRelease",
  "crdGroupErrors",
  "crdNameFormatErrors",
  "crdOwners",
  "dashboardSidecarHelmArgs",
  "databaseRoutesDeliveryArgs",
  "driftListingMappingsFlag",
  "enabledComponents",
  "evaluateAudit",
  "exemptionCheckMode",
  "exists",
  "expandVersions",
  "featureEnabled",
  "featureHelmArgs",
  "findRoot",
  "flagEntry",
  "gatewayClassChangeFlag",
  "gatewayClassName",
  "gatewayEntryPort",
  "gatewayRollbackOrderFlag",
  "helmInstalledComponents",
  "ingressFlag",
  "internalGateway",
  "isLocalProvider",
  "keycloakHostname",
  "keycloakOperatorProbeHelmArgs",
  "keycloakRealmWaitFlag",
  "keycloakWaitFlag",
  "loadRepository",
  "loadRunTimeFile",
  "loadServiceRegistrations",
  "localCaConfigMap",
  "localImageReuseFlag",
  "localSigner",
  "managedCluster",
  "missingRunTimeValues",
  "neverRetires",
  "noMatchPolicy",
  "nodeBudget",
  "nodeCount",
  "notApplicableReason",
  "orderedComponents",
  "organizationServiceApisFlag",
  "otlpByName",
  "otlpHostname",
  "patchableKinds",
  "platformArgocdDeliveryFlag",
  "platformClaimErrors",
  "platformDnsFlag",
  "platformDomainOrigin",
  "platformDomainVariable",
  "platformHelmArgs",
  "platformPlan",
  "platformPortalFlag",
  "policyPromotionErrors",
  "portalStagedInstallFlag",
  "probeFields",
  "probeNames",
  "prometheusPortalHelmArgs",
  "promoteConstraint",
  "providerCrdGroupErrors",
  "providerOwnsCrd",
  "readinessGatedOff",
  "recordPromotionEvidence",
  "registeredServiceHelmArgs",
  "registryByName",
  "registryConsumers",
  "registryHelmArgs",
  "registryHostname",
  "registryPlan",
  "registryPruneFlag",
  "registryTailnetForwardFlag",
  "releaseOwner",
  "releaseRecoveryArgocdRefusalFlag",
  "renderedCrdNames",
  "rollbackConstraint",
  "runTimeDomainErrors",
  "runTimeFilePath",
  "runTimeNeededBy",
  "runTimeValues",
  "sessionCookieViolations",
  "signinAwaitsPortal",
  "smtpSecretName",
  "smtpSecretNamespace",
  "startsAfterDelivery",
  "trustedSigners",
  "validateRepository",
];

test("the config barrel exposes exactly the entry points other domains use", () => {
  expect(Object.keys(config).sort()).toEqual(entryPoints);
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
  expect(config.otlpByName).toBe(otlpByName);
  expect(config.otlpHostname).toBe(otlpHostname);
  expect(config.approvedImageList).toBe(approvedImageList);
  expect(config.featureEnabled).toBe(featureEnabled);
  expect(config.managedCluster).toBe(managedCluster);
  expect(config.validateRepository).toBe(validateRepository);
  expect(config.exists).toBe(exists);
});
