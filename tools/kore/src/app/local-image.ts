import type { Repository } from "../config/index.js";
import { verifiedRegistryAddress, type LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

export function localMinikubeImageReference(
  reference: string,
  registryAddress: string,
): string {
  const separator = reference.indexOf("/");
  if (separator < 1 || !registryAddress.trim()) {
    throw new Error("local image reference and registry address are required");
  }
  return `${registryAddress}/${reference.slice(separator + 1)}`;
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

/** Pulls the image into Minikube; other providers deploy the locked image. */
export async function stageLocalImage(
  repository: Repository,
  runner: Runner,
  image: LockedImage,
): Promise<LockedImage> {
  if (repository.environment.provider !== "minikube") {
    return image;
  }
  const address = await verifiedRegistryAddress(repository, runner);
  const staged = {
    ...image,
    reference: localMinikubeImageReference(image.reference, address),
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
