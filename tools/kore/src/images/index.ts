// Docs: docs/decisions/0015-local-signed-image-delivery.md
export { imageForApplication, loadImageLock } from "./image-lock.js";
export type { ImageLockEntry, LockedImage } from "./image-lock.js";
export { buildAndSignLocalImage } from "./local-image.js";
export type { BuiltLocalImage } from "./local-image.js";
export { localRegistryReference } from "./registry.js";
export { ensureLocalSigningPublicKey } from "./local-signer.js";
export { verifiedRegistryAddress } from "./registry-service.js";
