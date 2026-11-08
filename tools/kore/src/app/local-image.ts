import type { Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

export function localMinikubeImageReference(
  reference: string,
  registryClusterIp: string,
): string {
  const separator = reference.indexOf("/");
  if (separator < 1 || !registryClusterIp.trim()) {
    throw new Error(
      "local image reference and registry ClusterIP are required",
    );
  }
  return `${registryClusterIp}:5000/${reference.slice(separator + 1)}`;
}

export function minikubeImagePullArgs(
  profile: string,
  reference: string,
): string[] {
  return [
    "ssh",
    "--profile",
    profile,
    "--",
    `sudo nerdctl --insecure-registry --namespace k8s.io pull ${reference}`,
  ];
}

async function fetchRegistryClusterIp(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  const registry = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "kore-registry",
      "get",
      "service",
      "oci-registry",
      "--output=jsonpath={.spec.clusterIP}",
    ],
    { capture: true },
  );
  const clusterIp = registry.stdout.trim();
  if (!clusterIp) {
    throw new Error("local OCI registry has no ClusterIP");
  }
  return clusterIp;
}

/** Pulls the image into Minikube; other providers deploy the locked image. */
export async function stageLocalImage(
  repository: Repository,
  runner: Runner,
  image: LockedImage,
): Promise<LockedImage> {
  if (repository.environment.provider !== "minikube") {
    return image;
  }
  const clusterIp = await fetchRegistryClusterIp(repository, runner);
  const staged = {
    ...image,
    reference: localMinikubeImageReference(image.reference, clusterIp),
  };
  await runner.run(
    "minikube",
    minikubeImagePullArgs(
      repository.environment.cluster.profile,
      staged.reference,
    ),
    { capture: false },
  );
  return staged;
}
