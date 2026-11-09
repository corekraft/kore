import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Helpers for the opt-in live admission specs (`*.integration.spec.ts`). They
// only ever dry-run admission or push throwaway test images; nothing here
// deploys a workload.

export interface AdmissionVerdict {
  admitted: boolean;
  detail: string;
}

/** What the API server says when a webhook, or its absence, refuses a request. */
const WEBHOOK_REFUSAL =
  /admission webhook|failed calling webhook|denied the request/i;

export function scope(repository: Repository, namespace: string): string[] {
  return [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    namespace,
  ];
}

export interface ProbeOptions {
  /** Where the probed image sits in the pod; defaults to a main container. */
  placement?: "container" | "initContainer";
  /** The main container's image when `placement` is `initContainer`. */
  trusted?: string;
  /** The ServiceAccount the probe pod names; omitted, the pod names none. */
  serviceAccountName?: string;
}

/** Runs `kubectl`; a webhook refusal is a verdict, anything else is rethrown. */
export async function verdictOf(
  runner: Runner,
  args: string[],
  input?: string,
): Promise<AdmissionVerdict> {
  try {
    const result = await runner.run("kubectl", args, {
      capture: true,
      ...(input === undefined ? {} : { input }),
    });
    return { admitted: true, detail: result.stdout.trim() };
  } catch (error) {
    if (
      error instanceof CommandError &&
      WEBHOOK_REFUSAL.test(error.result.stderr)
    ) {
      return { admitted: false, detail: error.result.stderr.trim() };
    }
    throw error;
  }
}

/**
 * Server dry-runs a Pod with `image` in `namespace` and says whether admission
 * accepts it. A webhook refusal is a verdict; any other failure is rethrown so
 * an unreachable cluster is never mistaken for a denial. With an init
 * container placement the image runs only there, beside a `trusted` main
 * container, so only the probed image can cause a denial.
 */
export async function admissionVerdict(
  repository: Repository,
  runner: Runner,
  namespace: string,
  image: string,
  options: ProbeOptions = {},
): Promise<AdmissionVerdict> {
  const initial = options.placement === "initContainer";
  if (initial && options.trusted === undefined) {
    throw new Error(
      "an init container probe needs a `trusted` main container image so that only the probed image can cause a denial",
    );
  }
  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: `kore-admission-probe-${Date.now().toString(36)}` },
    spec: {
      restartPolicy: "Never",
      ...(options.serviceAccountName === undefined
        ? {}
        : { serviceAccountName: options.serviceAccountName }),
      containers: [{ name: "probe", image: initial ? options.trusted : image }],
      ...(initial ? { initContainers: [{ name: "init-probe", image }] } : {}),
    },
  };
  return await verdictOf(
    runner,
    [
      ...scope(repository, namespace),
      "create",
      "--dry-run=server",
      "--filename=-",
    ],
    JSON.stringify(pod),
  );
}

/**
 * The name of a Running pod whose first container runs `image`, the target of
 * an ephemeral container probe. It is found by image so no label convention
 * is assumed.
 */
export async function runningPodWithImage(
  repository: Repository,
  runner: Runner,
  namespace: string,
  image: string,
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...scope(repository, namespace),
      "get",
      "pods",
      "--field-selector=status.phase=Running",
      `--output=jsonpath={.items[?(@.spec.containers[0].image=="${image}")].metadata.name}`,
    ],
    { capture: true },
  );
  const name = stdout.trim().split(/\s+/)[0] ?? "";
  if (name === "") {
    throw new Error(
      `no Running pod of ${image} in namespace ${namespace}; run \`kore app up ${namespace} --environment ${repository.environment.name}\` first so a signed workload is running`,
    );
  }
  return name;
}

/**
 * Server dry-runs adding an ephemeral container of `image` to the running
 * pod, the same request as `kubectl debug`, and says whether admission accepts
 * it. Nothing is attached: a dry run persists no change.
 */
export async function ephemeralContainerVerdict(
  repository: Repository,
  runner: Runner,
  namespace: string,
  pod: string,
  image: string,
): Promise<AdmissionVerdict> {
  return await verdictOf(runner, [
    ...scope(repository, namespace),
    "patch",
    `pod/${pod}`,
    "--subresource=ephemeralcontainers",
    "--dry-run=server",
    "--patch",
    JSON.stringify({
      spec: { ephemeralContainers: [{ name: "probe", image }] },
    }),
  ]);
}

/** The image the application's workload runs: the kore-signed digest. */
export async function deployedImage(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...scope(repository, namespace),
      "get",
      "deployment",
      "--output=jsonpath={.items[0].spec.template.spec.containers[0].image}",
    ],
    { capture: true },
  );
  const image = stdout.trim();
  if (image === "") {
    throw new Error(
      `no workload Deployment in namespace ${namespace}; run \`kore app up ${namespace} --environment ${repository.environment.name}\` first so a kore-signed image exists to compare against`,
    );
  }
  return image;
}

function splitDigest(image: string): { repository: string; digest: string } {
  const at = image.indexOf("@sha256:");
  if (at === -1) {
    throw new Error(
      `${image} carries no sha256 digest; pass the digest-qualified image the workload runs`,
    );
  }
  return { repository: image.slice(0, at), digest: image.slice(at + 8) };
}

/**
 * The signed image's repository addressed by tag alone. `kore-local` is the
 * tag `kore app image` publishes beside every digest, so the reference names
 * the signed content without pinning it.
 */
export function tagOnlyReference(image: string, tag = "kore-local"): string {
  return `${splitDigest(image).repository}:${tag}`;
}

/**
 * The same repository with one digest character changed: a well-formed digest
 * for content nobody pushed or signed.
 */
export function modifiedDigestReference(image: string): string {
  const { repository, digest } = splitDigest(image);
  const last = digest.slice(-1);
  const replacement = last === "0" ? "1" : "0";
  return `${repository}@sha256:${digest.slice(0, -1)}${replacement}`;
}

/** Scales one Deployment; the caller waits for the result and restores it. */
export async function scaleDeployment(
  repository: Repository,
  runner: Runner,
  namespace: string,
  name: string,
  replicas: number,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      ...scope(repository, namespace),
      "scale",
      `deployment/${name}`,
      `--replicas=${replicas}`,
    ],
    { capture: true },
  );
}

export {
  publishSignedCopy,
  publishUntrustedCopies,
} from "./admission-probe-copies.js";
export type {
  ProbeDependencies,
  UntrustedImages,
} from "./admission-probe-copies.js";
