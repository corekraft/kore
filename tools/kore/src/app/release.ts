import { registryPlan, type Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";

export function releaseArgs(
  repository: Repository,
  name: string,
  release: string,
  chartPath: string,
  image?: LockedImage,
): string[] {
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
