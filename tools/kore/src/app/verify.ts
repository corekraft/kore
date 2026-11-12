import { join } from "node:path";
import {
  isLocalProvider,
  trustedSigners,
  type Repository,
} from "../config/index.js";
import {
  koreManagesRegistryAuth,
  loadRegistryCa,
  loadRegistryCredential,
  localRegistryReference,
  withRegistryClient,
  type LockedImage,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";

export function verifyLockedImageArgs(
  image: LockedImage,
  publicKey?: string,
  registryCaFile?: string,
): string[] {
  return [
    "verify",
    // The internal registry is TLS-only; cosign verifies it against its CA
    // (ADR 0058). External registries use the system roots.
    ...(registryCaFile ? ["--registry-cacert", registryCaFile] : []),
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
  return isLocalProvider(repository.environment) &&
    image.signer === "local-kore-key"
    ? localPublicKeyPath(repository.root)
    : undefined;
}

/**
 * An image is verified only against signers the environment's image policy
 * admits, so a managed environment never accepts the local key and a stray
 * lock entry fails here, naming the signer, instead of in cosign.
 */
export function assertTrustedSigner(
  repository: Repository,
  image: LockedImage,
): void {
  if (!trustedSigners(repository).includes(image.signer)) {
    throw new Error(
      `image signer ${image.signer} is not trusted by environment ${repository.environment.name}; its image policy admits only its configured authority (the local key is never trusted by a managed environment). Rebuild or relock the image with that identity`,
    );
  }
}

/** Verifies the image signature against the registry-resolved reference. */
export async function verifyImage(
  repository: Repository,
  runner: Runner,
  image: LockedImage,
  publicKeyOverride?: string,
): Promise<void> {
  assertTrustedSigner(repository, image);
  const verificationImage = {
    ...image,
    reference: await localRegistryReference(
      repository,
      runner,
      image.reference,
    ),
  };
  const publicKey = publicKeyOverride ?? localPublicKey(repository, image);
  if (
    !isLocalProvider(repository.environment) ||
    !koreManagesRegistryAuth(repository)
  ) {
    await runner.run(
      "cosign",
      verifyLockedImageArgs(verificationImage, publicKey),
      { capture: false },
    );
    return;
  }
  const credential = await loadRegistryCredential(repository, runner, "read");
  const ca = await loadRegistryCa(repository, runner);
  await withRegistryClient(credential, ca, async (client) => {
    await runner.run(
      "cosign",
      verifyLockedImageArgs(verificationImage, publicKey, client.caFile),
      { capture: false, env: { ...process.env, ...client.env } },
    );
  });
}
