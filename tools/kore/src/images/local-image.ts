import { join } from "node:path";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import type { Repository } from "../config/index.js";
import {
  imageDigestFromRegistryHead,
  localDockerBuildArgs,
  minikubeImageLoadArgs,
  minikubeImagePublishArgs,
} from "./local-image-args.js";
import { withLocalSigner, type LocalSigner } from "./local-signer.js";
import { localRegistryReference } from "./registry.js";
import type { Runner } from "../runtime/index.js";

export {
  imageDigestFromRegistryHead,
  localDockerBuildArgs,
  localSigningConfigArgs,
  minikubeImageLoadArgs,
  minikubeImagePublishArgs,
} from "./local-image-args.js";

export interface BuiltLocalImage {
  image: LockedImage;
  publicKey: string;
}

const manifestAccept =
  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";

async function loadIntoMinikube(
  repository: Repository,
  runner: Runner,
  application: string,
  imageTag: string,
): Promise<void> {
  await runner.run(
    "docker",
    localDockerBuildArgs(join(repository.root, "apps", application), imageTag),
    { capture: false, cwd: repository.root },
  );
  await runner.run(
    "minikube",
    minikubeImageLoadArgs(repository.environment.cluster.profile, imageTag),
    { capture: false },
  );
}

async function publishToLocalRegistry(
  repository: Repository,
  runner: Runner,
  entry: ImageLockEntry,
  imageTag: string,
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
  const separator = entry.image.indexOf("/");
  if (separator < 1 || !clusterIp) {
    throw new Error(
      "local registry service or image repository path is unavailable",
    );
  }
  const repositoryPath = entry.image
    .slice(separator + 1)
    .replace(/:[^/:]+$/, "");
  await runner.run(
    "minikube",
    minikubeImagePublishArgs(
      repository.environment.cluster.profile,
      imageTag,
      clusterIp,
      `${repositoryPath}:kore-local`,
    ),
    { capture: true },
  );
  return repositoryPath;
}

async function publishedDigest(repositoryPath: string): Promise<string> {
  const manifestPath = repositoryPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const manifest = await fetch(
    `http://127.0.0.1:30500/v2/${manifestPath}/manifests/kore-local`,
    { method: "HEAD", headers: { Accept: manifestAccept } },
  );
  return imageDigestFromRegistryHead(
    manifest.status,
    `docker-content-digest: ${manifest.headers.get("docker-content-digest") ?? ""}`,
  );
}

async function signImage(
  repository: Repository,
  runner: Runner,
  image: LockedImage,
  signer: LocalSigner,
): Promise<void> {
  const signingReference = await localRegistryReference(
    repository,
    runner,
    image.reference,
  );
  await runner.run(
    "cosign",
    [
      "sign",
      "--key",
      signer.key,
      "--signing-config",
      signer.signingConfig,
      "--allow-http-registry",
      "--yes",
      signingReference,
    ],
    { capture: false, env: signer.env },
  );
}

async function buildAndSign(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
  signer: LocalSigner,
): Promise<BuiltLocalImage> {
  const imageTag = `kore-local/${application}:kore-local`;
  await localRegistryReference(repository, runner, `${entry.image}:kore-local`);
  await loadIntoMinikube(repository, runner, application, imageTag);
  const repositoryPath = await publishToLocalRegistry(
    repository,
    runner,
    entry,
    imageTag,
  );
  const digest = await publishedDigest(repositoryPath);
  const image: LockedImage = {
    reference: `${entry.image}@${digest}`,
    digest,
    signer: "local-kore-key",
  };
  await signImage(repository, runner, image, signer);
  return { image, publicKey: signer.publicKey };
}

export async function buildAndSignLocalImage(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
): Promise<BuiltLocalImage> {
  return await withLocalSigner(repository, runner, (signer) =>
    buildAndSign(repository, runner, application, entry, signer),
  );
}
