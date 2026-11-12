import type { Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import {
  loadRegistryCredential,
  minikubeRegistrySessionArgs,
  shellQuote,
  verifiedRegistryAddress,
  withSecretsRedacted,
  type LockedImage,
} from "../images/index.js";
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
  registryAddress: string,
  username: string,
): string[] {
  return minikubeRegistrySessionArgs(profile, registryAddress, username, [
    `nerdctl --namespace k8s.io pull ${shellQuote(reference)}`,
  ]);
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
  const credential = await loadRegistryCredential(repository, runner, "read");
  await withSecretsRedacted([credential.password], () =>
    runner.run(
      "minikube",
      minikubeImagePullArgs(
        minikubeCluster(repository.environment).profile,
        staged.reference,
        address,
        credential.username,
      ),
      { capture: false, input: `${credential.password}\n` },
    ),
  );
  return staged;
}
