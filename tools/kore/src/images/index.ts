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
export {
  ensureRegistryTrust,
  loadRegistryCa,
  registryTrustProblem,
} from "./registry-tls.js";
export { withRegistryClient } from "./registry-client.js";
export { minikubeRegistrySessionArgs, shellQuote } from "./local-image-args.js";
export { publishedDigest, withPublishSession } from "./local-publish.js";
export { localSignArgs, minikubeImagePublishArgs } from "./local-image.js";
export type { RegistryClient } from "./registry-client.js";
export type { RegistryDependencies } from "./registry.js";
export { rotateRegistryCredentials } from "./registry-rotation.js";
export type { RotationResult } from "./registry-rotation.js";
export {
  assertReleaseAutomationImage,
  isReleaseAutomationSigner,
} from "./release-image.js";
