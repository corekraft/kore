// Docs: docs/decisions/0015-local-signed-image-delivery.md
export { imageForApplication, loadImageLock } from "./image-lock.js";
export type { ImageLockEntry, LockedImage } from "./image-lock.js";
export { platformImageLockErrors } from "./platform-image-lock.js";
export { managedLockErrors } from "./managed-lock.js";
export { renderedImages, unapprovedImages } from "./rendered-images.js";
export { buildAndSignLocalImage } from "./local-image.js";
export type { BuiltLocalImage } from "./local-image.js";
export { localRegistryReference } from "./registry.js";
export { ensureLocalSigningPublicKey } from "./local-signer.js";
export { verifiedRegistryAddress } from "./registry-service.js";
export {
  ensureRegistryAuth,
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryAddress,
  registryPullSecret,
  registryPullSecretName,
  withSecretsRedacted,
} from "./registry-auth.js";
export type { RegistryCredential } from "./registry-auth.js";
export { withRegistryClient } from "./registry-client.js";
export { minikubeRegistrySessionArgs, shellQuote } from "./local-image-args.js";
