import { createHash } from "node:crypto";
import { registryPlan, type Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

export function releaseArgs(
  repository: Repository,
  name: string,
  release: string,
  chartPath: string,
  extras: { image?: LockedImage; secretVersion?: string } = {},
): string[] {
  const { image, secretVersion } = extras;
  const args = [
    "upgrade",
    "--install",
    release,
    chartPath,
    "--namespace",
    name,
    "--kube-context",
    repository.environment.kubeContext,
    "--wait",
    "--timeout",
    "10m",
    "--rollback-on-failure",
    "--set-string",
    `platform.gateway.name=${repository.environment.gateway.name}`,
    "--set-string",
    `platform.gateway.namespace=${repository.environment.gateway.namespace}`,
    "--set-string",
    `platform.gateway.hostname=${repository.environment.gateway.hostname}`,
    "--set-string",
    `platform.registry.address=${registryPlan(repository.environment).address}`,
    "--set-string",
    `platform.secretStore=${repository.environment.secrets.storeName}`,
    "--set-string",
    `platform.otlpEndpoint=${repository.environment.telemetry.otlpEndpoint}`,
  ];
  if (secretVersion) {
    args.push("--set-string", `secretVersion=${secretVersion}`);
  }
  if (image) {
    args.push(...imageReleaseArgs(repository, name, image));
  }
  if (image && repository.environment.provider === "minikube") {
    args.push(...localImagePullPolicyArgs());
  }
  return args;
}

export function imageReleaseArgs(
  _repository: Repository,
  _name: string,
  image: LockedImage,
): string[] {
  const separator = image.reference.lastIndexOf("@");
  if (separator < 1) {
    throw new Error("locked image reference must include a digest");
  }
  return [
    "--set-string",
    `image.repository=${image.reference.slice(0, separator)}`,
    "--set-string",
    `image.digest=${image.digest}`,
  ];
}

export function localImagePullPolicyArgs(): string[] {
  return ["--set-string", "image.pullPolicy=Never"];
}

/**
 * A one-way marker of the application's secret source, passed to the workload
 * chart as `secretVersion` so a rotated secret changes the pod template and the
 * pods restart onto the new value. It digests the source's rotation id (set by
 * `kore secrets`), never any secret data, and the chart knows nothing about how
 * the Secret arrives. Empty when the source has no rotation id.
 */
export async function rotationMarker(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      repository.environment.secrets.sourceNamespace,
      "get",
      "secret",
      `${name}-app`,
      "--ignore-not-found",
      "--output",
      "jsonpath={.metadata.annotations.platform\\.kore\\.dev/rotation-id}",
    ],
    { capture: true },
  );
  const id = stdout.trim();
  return id ? createHash("sha256").update(id).digest("hex").slice(0, 16) : "";
}
