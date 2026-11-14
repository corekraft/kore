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
vi.mock("./approved.js", () => ({ approvedImageList: vi.fn() }));
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
  componentGatedOff: vi.fn(),
  enabledComponents: vi.fn(),
  featureEnabled: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassName: vi.fn(),
  ingressFlag: "ingress-agentgateway",
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
  policyWarnings: vi.fn(),
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
    "approvedImageList",
    "auditEvidence",
    "checkCrdOwnership",
    "componentGatedOff",
    "componentValues",
    "componentVersion",
    "crdGroupErrors",
    "crdNameFormatErrors",
    "crdOwners",
    "enabledComponents",
    "evaluateAudit",
    "exists",
    "expandVersions",
    "featureEnabled",
    "featureHelmArgs",
    "findRoot",
    "gatewayClassName",
    "ingressFlag",
    "isLocalProvider",
    "loadRepository",
    "localSigner",
    "managedCluster",
    "noMatchPolicy",
    "orderedComponents",
    "patchableKinds",
    "policyPromotionErrors",
    "policyWarnings",
    "probeFields",
    "probeNames",
    "promoteConstraint",
    "providerCrdGroupErrors",
    "providerOwnsCrd",
    "recordPromotionEvidence",
    "registryConsumers",
    "registryHelmArgs",
    "registryPlan",
    "renderedCrdNames",
    "rollbackConstraint",
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
