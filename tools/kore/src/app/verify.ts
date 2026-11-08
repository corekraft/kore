import { join } from "node:path";
import type { Repository } from "../config/index.js";
import { localRegistryReference, type LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

export function verifyLockedImageArgs(
  image: LockedImage,
  publicKey?: string,
): string[] {
  return [
    "verify",
    ...(/:[0-9]+\//.test(image.reference) ? ["--allow-http-registry"] : []),
    ...(publicKey
      ? ["--insecure-ignore-tlog", "--key", publicKey]
      : [
          "--certificate-identity",
          image.signer,
          "--certificate-oidc-issuer",
          "https://token.actions.githubusercontent.com",
        ]),
    image.reference,
  ];
}

export function localPublicKeyPath(root: string): string {
  return join(root, ".kore", "state", "local-signing.pub");
}

function localPublicKey(
  repository: Repository,
  image: LockedImage,
): string | undefined {
  return repository.environment.provider === "minikube" &&
    image.signer === "local-kore-key"
    ? localPublicKeyPath(repository.root)
    : undefined;
}

/** Verifies the image signature against the registry-resolved reference. */
export async function verifyImage(
  repository: Repository,
  runner: Runner,
  image: LockedImage,
  publicKeyOverride?: string,
): Promise<void> {
  const verificationImage = {
    ...image,
    reference: await localRegistryReference(
      repository,
      runner,
      image.reference,
    ),
  };
  const publicKey = publicKeyOverride ?? localPublicKey(repository, image);
  await runner.run(
    "cosign",
    verifyLockedImageArgs(verificationImage, publicKey),
    { capture: false },
  );
}
