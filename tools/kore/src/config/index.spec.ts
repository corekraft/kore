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

vi.mock("./approved.js");
vi.mock("./config.js");
vi.mock("./crd-ownership.js");
vi.mock("./features.js");
vi.mock("./files.js");
vi.mock("./image-trust.js");
vi.mock("./managed-cluster.js");
vi.mock("./patch-validation.js");
vi.mock("./policy-promotion.js");
vi.mock("./policy-promotion-change.js");
vi.mock("./provider.js");
vi.mock("./registry-address.js");
vi.mock("./validate.js");

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
