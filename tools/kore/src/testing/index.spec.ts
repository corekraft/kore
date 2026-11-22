// The testing barrel: the one import path the specs and fixtures use for the test-only surface.
// Every module it forwards from is mocked to hand back tagged strings, so the test proves the
// barrel forwards each name from the module that exports it, and nothing else.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { expect, test, vi } from "vitest";

const FORWARDS: Record<string, readonly string[]> = {
  "./gateway-flags-off.fixtures.js": [
    "loadLocalGatewayFlagsOff",
    "withGatewayFlagsOff",
    "withPlatformDnsOn",
  ],
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
  "./signin-check.js": ["checkSignIn"],
  "./golden-path-signin-target.js": ["goldenPathSignInTarget"],
  "./chromium-program.js": ["chromiumProgram"],
  "./headless-browser.js": ["pinnedBrowserImage", "runHeadlessBrowser"],
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
    "envOption",
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
  "../app/install.js": ["applicationNamespaceManifest"],
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
  "../images/rendered-images.js": ["renderedImages", "unapprovedImages"],
  "../platform/container-smoke.js": [
    "classifySmokeLogs",
    "dockerRunArgs",
    "smokeTargets",
  ],
  "../platform/upstream.live.js": ["renderChart", "yamlDocuments"],
  "../platform/rollout-feasibility.js": ["rolloutProblems"],
  "../images/images.fixtures.js": [
    "baseDigest as imageBaseDigest",
    "digest as imageDigest",
    "encodeBase64",
    "entry as imageEntry",
    "fakeRunner as imageFakeRunner",
    "filesUnder",
    "kubeContext",
    "minifiedKubeconfig",
    "secretRef",
    "stubRegistry",
  ],
  "../images/local-image-context.js": ["contextInputs"],
  "../images/local-image.js": ["k3dImageImportArgs", "loadLocalImage"],
  "../images/local-publish.js": ["requireK3d"],
  "../images/local-image-args.js": [
    "k3dImagePublishArgs",
    "k3dRegistrySessionArgs",
  ],
  "../images/local-signer.js": [
    "localSigningPublicNamespace",
    "localSigningPublicSecret",
  ],
  "../images/registry-forward-owner.js": ["readForwardOwner"],
  "../images/registry.js": ["forwardResponds"],
  "../config/mirror.js": ["unmirroredImages"],
  "../config/identity.js": ["parsePrincipal", "spiffeId", "spiffePrincipal"],
  "../config/readiness-fixtures.js": ["readinessFor"],
  "../config/validation.fixtures.js": ["sound", "validationMessage"],
  "../cli/cli.js": ["main"],
  "../cli/commands.js": ["COMMANDS", "isMutating"],
  "../cli/commands-policy.js": ["policyCommand"],
  "../cli/flags.js": ["parseArgs"],
  "../cli/mutation.js": ["createMutate"],
  "../runtime/nightly-script.fixtures.js": [
    "FAKE_IDENTITY",
    "FAKE_RECIPIENT",
    "LOCAL_RECIPIENT",
    "ctx",
    "fakes",
    "files",
    "hasGnuTimeout",
    "outside",
    "run",
    "useNightlySandbox",
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

// One mock per forwarded module, registered before the barrel is imported below.
for (const path of Object.keys(FORWARDS)) {
  vi.doMock(path, () => tagged(path));
}

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
