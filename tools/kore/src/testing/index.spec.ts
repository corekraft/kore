// The testing barrel: the one import path the specs and fixtures use for the test-only surface.
// Every module it forwards from is mocked to hand back tagged strings, so the test proves the
// barrel forwards each name from the module that exports it, and nothing else.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { expect, test, vi } from "vitest";

const FORWARDS: Record<string, readonly string[]> = {
  "./app-fixtures.js": [
    "digest",
    "gateOutput",
    "healthyReadinessOutput",
    "healthyRunner",
    "lockedImage",
    "passthroughRegistry",
    "pushPassword",
    "readPassword",
    "releaseNotFound",
    "releaseSigner",
    "removeReleaseLocks",
    "repositoryTrustingRelease",
    "writeReleaseLock",
  ],
  "./k3d-cluster.fixtures.js": [
    "fakeRunner",
    "fast",
    "k3dRepository",
    "list",
    "ok",
    "testHome",
    "text",
    "trustVolumeArgs",
  ],
  "./webhook-fixtures.js": [
    "gatedOffReleaseAbsent",
    "healthyDaemonSetOutput",
    "healthyWebhookOutput",
    "withHealthyWebhooks",
  ],
  "./managed-local.fixtures.js": ["loadManagedLocal", "managedClusterSettings"],
  "./data-export.fixtures.js": [
    "CIPHERTEXT",
    "FakeRunner",
    "NOW",
    "PLAINTEXT",
    "RECIPIENT",
    "exportOptions",
    "useExportRepository",
  ],
  "./registry-tls-fixtures.js": ["registryCaPem", "registryTlsSecret"],
  "./platform-readiness.fixtures.js": ["readyRows"],
  "./platform-resilience.fixtures.js": ["healthyClusterOutput"],
  "../platform/reconcile.js": [
    "reconcileComponent",
    "recoverUndeployedRelease",
  ],
  "../platform/readiness.js": ["readinessFailure"],
  "../platform/readiness-poll.js": ["retryBudget"],
  "../platform/readiness-gate.js": ["openApplicationAdmission"],
  "../platform/readiness-gateway.js": ["gatewayCheck", "waitForGateway"],
  "../platform/backup-status.js": ["backupStatus"],
  "../platform/capacity-status.js": [
    "capacityStatus",
    "parseCpu",
    "parseMemory",
  ],
  "../platform/crd-ownership-status.js": ["crdOwnershipStatus"],
  "../platform/admission-probe.js": [
    "admissionVerdict",
    "deployedImage",
    "ephemeralContainerVerdict",
    "runningPodWithImage",
    "scaleDeployment",
  ],
  "../platform/admission-probe-copies.js": [
    "publishSignedCopy",
    "publishUntrustedCopies",
  ],
  "../platform/readiness-manifest.js": [
    "evaluateReadiness",
    "readinessEvidenceName",
    "readinessEvidenceObject",
  ],
  "../platform/helm.js": [
    "withAbsoluteChart",
    "helmEnv",
    "helmTemplateArgs",
    "helmUpgradeArgs",
  ],
  "../platform/k3d-fixtures.js": [
    "nodePortService",
    "runningK3d",
    "runningK3dCluster",
  ],
  "../config/manifest-images.js": ["manifestImages"],
  "../platform/image-inventory.js": ["imageInventory", "imageInventoryStatus"],
  "../platform/gate-proof-access.js": [
    "grantProofGateAccess",
    "proofGateAccess",
    "revokeProofGateAccess",
  ],
  "../platform/admission-gate.js": [
    "activationLabel",
    "admissionGateStatus",
    "assertAdmissionGateOpen",
    "closedAdmissionGate",
    "ensureClosedAdmissionGate",
    "openAdmissionGate",
    "platformGeneration",
    "readAdmissionGate",
  ],
  "../platform/admission-gate-support.js": [
    "gateCrdJson",
    "currentGateParameters",
  ],
  "../platform/fail-fast.fixtures.js": [
    "crashLoop",
    "liveCniFailure",
    "liveSandboxOom",
    "oci",
    "pod",
    "reconcile",
    "sandboxOom",
    "Scenario",
    "waiting",
  ],
  "../platform/bootstrap.js": ["bootstrapControllers"],
  "../platform/enrollment.js": ["enrollPlatformNamespaces"],
  "../platform/gated-release.js": ["managedNamespaces"],
  "../platform/fingerprint.js": ["desiredFingerprint"],
  "../platform/status.js": ["platformStatus"],
  "../platform/render.js": ["platformRender"],
  "../platform/ingress-measurement.js": ["IngressMeasurement", "ingressRoutes"],
  "../platform/ingress-measurement.fixtures.js": [
    "FakeLoad",
    "expectedStatus",
    "fixture",
    "metrics",
    "ok as measurementOk",
    "options",
    "sampleResponses",
  ],
};

/** An entry is a module export name, or `<export> as <barrel name>` when the barrel renames it. */
const parse = (entry: string) => {
  const [source, alias = source] = entry.split(" as ");
  return { source, alias };
};

/** A module's stand-in: each name it exports is the string `<path>#<name>`. */
const tagged = (path: string) =>
  Object.fromEntries(
    (FORWARDS[path] ?? []).map((entry) => {
      const { source } = parse(entry);
      return [source, `${path}#${source}`];
    }),
  );

vi.mock("./app-fixtures.js", () => tagged("./app-fixtures.js"));
vi.mock("./k3d-cluster.fixtures.js", () => tagged("./k3d-cluster.fixtures.js"));
vi.mock("./webhook-fixtures.js", () => tagged("./webhook-fixtures.js"));
vi.mock("./managed-local.fixtures.js", () =>
  tagged("./managed-local.fixtures.js"),
);
vi.mock("./data-export.fixtures.js", () => tagged("./data-export.fixtures.js"));
vi.mock("./registry-tls-fixtures.js", () =>
  tagged("./registry-tls-fixtures.js"),
);
vi.mock("./platform-readiness.fixtures.js", () =>
  tagged("./platform-readiness.fixtures.js"),
);
vi.mock("./platform-resilience.fixtures.js", () =>
  tagged("./platform-resilience.fixtures.js"),
);
vi.mock("../platform/reconcile.js", () => tagged("../platform/reconcile.js"));
vi.mock("../platform/readiness.js", () => tagged("../platform/readiness.js"));
vi.mock("../platform/readiness-poll.js", () =>
  tagged("../platform/readiness-poll.js"),
);
vi.mock("../platform/readiness-gate.js", () =>
  tagged("../platform/readiness-gate.js"),
);
vi.mock("../platform/readiness-gateway.js", () =>
  tagged("../platform/readiness-gateway.js"),
);
vi.mock("../platform/backup-status.js", () =>
  tagged("../platform/backup-status.js"),
);
vi.mock("../platform/capacity-status.js", () =>
  tagged("../platform/capacity-status.js"),
);
vi.mock("../platform/crd-ownership-status.js", () =>
  tagged("../platform/crd-ownership-status.js"),
);
vi.mock("../platform/admission-probe.js", () =>
  tagged("../platform/admission-probe.js"),
);
vi.mock("../platform/admission-probe-copies.js", () =>
  tagged("../platform/admission-probe-copies.js"),
);
vi.mock("../platform/readiness-manifest.js", () =>
  tagged("../platform/readiness-manifest.js"),
);
vi.mock("../platform/helm.js", () => tagged("../platform/helm.js"));
vi.mock("../platform/k3d-fixtures.js", () =>
  tagged("../platform/k3d-fixtures.js"),
);
vi.mock("../config/manifest-images.js", () =>
  tagged("../config/manifest-images.js"),
);
vi.mock("../platform/image-inventory.js", () =>
  tagged("../platform/image-inventory.js"),
);
vi.mock("../platform/gate-proof-access.js", () =>
  tagged("../platform/gate-proof-access.js"),
);
vi.mock("../platform/admission-gate.js", () =>
  tagged("../platform/admission-gate.js"),
);
vi.mock("../platform/admission-gate-support.js", () =>
  tagged("../platform/admission-gate-support.js"),
);
vi.mock("../platform/fail-fast.fixtures.js", () =>
  tagged("../platform/fail-fast.fixtures.js"),
);
vi.mock("../platform/bootstrap.js", () => tagged("../platform/bootstrap.js"));
vi.mock("../platform/enrollment.js", () => tagged("../platform/enrollment.js"));
vi.mock("../platform/gated-release.js", () =>
  tagged("../platform/gated-release.js"),
);
vi.mock("../platform/fingerprint.js", () =>
  tagged("../platform/fingerprint.js"),
);
vi.mock("../platform/status.js", () => tagged("../platform/status.js"));
vi.mock("../platform/render.js", () => tagged("../platform/render.js"));
vi.mock("../platform/ingress-measurement.js", () =>
  tagged("../platform/ingress-measurement.js"),
);
vi.mock("../platform/ingress-measurement.fixtures.js", () =>
  tagged("../platform/ingress-measurement.fixtures.js"),
);

const testing = await import("./index.js");

test("the testing barrel forwards each name from the module that exports it, and exposes nothing else", () => {
  const expected = Object.fromEntries(
    Object.entries(FORWARDS).flatMap(([path, entries]) =>
      entries.map((entry) => {
        const { source, alias } = parse(entry);
        return [alias, `${path}#${source}`];
      }),
    ),
  );

  expect({ ...testing }).toStrictEqual(expected);
});
