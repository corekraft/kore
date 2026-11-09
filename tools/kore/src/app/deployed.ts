import type { Repository } from "../config/index.js";
import {
  isReleaseAutomationSigner,
  type LockedImage,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";

const admissionLabel = "policy.sigstore.dev/include";

export interface DeployedImage {
  /** The digest the workload release was installed with, or "unknown". */
  digest: string;
  registry: string;
  matchesLock: boolean;
  /** The identity the lock names and `kore app up` verified before Helm ran. */
  signer: string;
  signerKind: "release-automation" | "local-developer-key" | "other";
  namespaceImageEnforcement: "enrolled" | "not enrolled";
  environmentImageInventory: "audit" | "enforce";
}

async function releasedDigest(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<string> {
  // User-supplied values only: kore sets the image and platform settings, and
  // no credential, so nothing sensitive is read (never --all, never a Secret).
  const { stdout } = await runner.run(
    "helm",
    [
      "get",
      "values",
      name,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--output",
      "json",
    ],
    { capture: true },
  );
  try {
    const values = JSON.parse(stdout) as { image?: { digest?: unknown } };
    return typeof values.image?.digest === "string"
      ? values.image.digest
      : "unknown";
  } catch {
    return "unknown";
  }
}

async function namespaceEnrolled(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<boolean> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      "namespace",
      name,
      "--output",
      `jsonpath={.metadata.labels.${admissionLabel.replaceAll(".", "\\.")}}`,
    ],
    { capture: true },
  );
  return stdout.trim() === "true";
}

function signerKind(signer: string): DeployedImage["signerKind"] {
  if (isReleaseAutomationSigner(signer)) {
    return "release-automation";
  }
  return signer === "local-kore-key" ? "local-developer-key" : "other";
}

/**
 * What is actually deployed, beside what the lock says should be: the digest
 * the release carries, the registry that serves it, the signer identity the
 * lock records, and whether Policy Controller enforces in the namespace.
 */
export async function deployedImage(
  repository: Repository,
  runner: Runner,
  name: string,
  locked: LockedImage,
): Promise<DeployedImage> {
  const digest = await releasedDigest(repository, runner, name);
  return {
    digest,
    registry: locked.reference.split("/")[0] ?? "unknown",
    matchesLock: digest === locked.digest,
    signer: locked.signer,
    signerKind: signerKind(locked.signer),
    namespaceImageEnforcement: (await namespaceEnrolled(
      repository,
      runner,
      name,
    ))
      ? "enrolled"
      : "not enrolled",
    environmentImageInventory: repository.environment.imageInventory ?? "audit",
  };
}
