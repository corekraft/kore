import { expect, test, vi } from "vitest";
import * as images from "./index.js";
import * as imageLock from "./image-lock.js";
import * as platformImageLock from "./platform-image-lock.js";
import * as managedLock from "./managed-lock.js";
import * as renderedImages from "./rendered-images.js";
import * as localImage from "./local-image.js";
import * as localImageArgs from "./local-image-args.js";
import * as imagePrune from "./image-prune.js";
import * as registry from "./registry.js";
import * as localSigner from "./local-signer.js";
import * as registryService from "./registry-service.js";
import * as registryAuth from "./registry-auth.js";
import * as registryTls from "./registry-tls.js";
import * as k3dRegistryTrust from "./k3d-registry-trust.js";
import * as registryClient from "./registry-client.js";
import * as localPublish from "./local-publish.js";
import * as registryRotation from "./registry-rotation.js";
import * as releaseImage from "./release-image.js";

vi.mock("./image-lock.js");
vi.mock("./platform-image-lock.js");
vi.mock("./managed-lock.js");
vi.mock("./rendered-images.js");
vi.mock("./local-image.js");
vi.mock("./local-image-args.js");
vi.mock("./image-prune.js");
vi.mock("./registry.js");
vi.mock("./local-signer.js");
vi.mock("./registry-service.js");
vi.mock("./registry-auth.js");
vi.mock("./registry-tls.js");
vi.mock("./k3d-registry-trust.js");
vi.mock("./registry-client.js");
vi.mock("./local-publish.js");
vi.mock("./registry-rotation.js");
vi.mock("./release-image.js");

test("the images barrel exposes exactly the public surface, each name from the module that owns it", () => {
  const owners: Record<string, unknown> = {
    imageForApplication: imageLock.imageForApplication,
    loadImageLock: imageLock.loadImageLock,
    platformImageLockErrors: platformImageLock.platformImageLockErrors,
    managedLockErrors: managedLock.managedLockErrors,
    renderedImages: renderedImages.renderedImages,
    unapprovedImages: renderedImages.unapprovedImages,
    buildAndSignLocalImage: localImage.buildAndSignLocalImage,
    localSignArgs: localImage.localSignArgs,
    imageDigestFromRegistryHead: localImageArgs.imageDigestFromRegistryHead,
    localDockerBuildArgs: localImageArgs.localDockerBuildArgs,
    pruneStaleImageTags: imagePrune.pruneStaleImageTags,
    localRegistryReference: registry.localRegistryReference,
    stopRegistryForward: registry.stopRegistryForward,
    ensureLocalSigningPublicKey: localSigner.ensureLocalSigningPublicKey,
    swapLocalSigningKey: localSigner.swapLocalSigningKey,
    withLocalSigner: localSigner.withLocalSigner,
    verifiedRegistryAddress: registryService.verifiedRegistryAddress,
    ensureRegistryAuth: registryAuth.ensureRegistryAuth,
    koreManagesRegistryAuth: registryAuth.koreManagesRegistryAuth,
    loadRegistryCredential: registryAuth.loadRegistryCredential,
    registryAddress: registryAuth.registryAddress,
    registryPullSecret: registryAuth.registryPullSecret,
    registryPullSecretName: registryAuth.registryPullSecretName,
    withSecretsRedacted: registryAuth.withSecretsRedacted,
    ensureRegistryTrust: registryTls.ensureRegistryTrust,
    loadRegistryCa: registryTls.loadRegistryCa,
    registryTrustProblem: registryTls.registryTrustProblem,
    k3dTrustDirectory: k3dRegistryTrust.k3dTrustDirectory,
    k3dTrustVolumeArgs: k3dRegistryTrust.k3dTrustVolumeArgs,
    writeK3dRegistriesConfig: k3dRegistryTrust.writeK3dRegistriesConfig,
    withRegistryClient: registryClient.withRegistryClient,
    publishedDigest: localPublish.publishedDigest,
    publishImageCopy: localPublish.publishImageCopy,
    withPublishSession: localPublish.withPublishSession,
    rotateRegistryCredentials: registryRotation.rotateRegistryCredentials,
    assertReleaseAutomationImage: releaseImage.assertReleaseAutomationImage,
    isReleaseAutomationSigner: releaseImage.isReleaseAutomationSigner,
  };

  expect(Object.keys(images).sort()).toEqual(Object.keys(owners).sort());
  for (const [name, owner] of Object.entries(owners)) {
    expect((images as Record<string, unknown>)[name]).toBe(owner);
  }
});
