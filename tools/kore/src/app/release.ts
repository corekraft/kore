import {
  isLocalProvider,
  platformPlan,
  registryPlan,
  type Repository,
  internalGateway,
} from "../config/index.js";
import type { LockedImage } from "../images/index.js";

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
    `platform.gateway.name=${internalGateway(repository.environment).name}`,
    "--set-string",
    `platform.gateway.namespace=${internalGateway(repository.environment).namespace}`,
    "--set-string",
    `platform.gateway.hostname=${platformPlan(repository.environment).domain}`,
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
  if (image && isLocalProvider(repository.environment)) {
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
