import { join } from "node:path";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import type { Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import {
  localDockerBuildArgs,
  k3dImageImportArgs,
  localSignArgs,
  minikubeImageLoadArgs,
} from "./local-image-args.js";
import { withLocalSigner, type LocalSigner } from "./local-signer.js";
import { localRegistryReference } from "./registry.js";
import {
  publishedDigest,
  publishToLocalRegistry,
  withPublishSession,
  type PublishSession,
} from "./local-publish.js";
import type { Runner } from "../runtime/index.js";

export {
  imageDigestFromRegistryHead,
  k3dImageImportArgs,
  localDockerBuildArgs,
  k3dImagePublishArgs,
  k3dRegistrySessionArgs,
  localSignArgs,
  minikubeImageLoadArgs,
  minikubeImagePublishArgs,
} from "./local-image-args.js";

export interface BuiltLocalImage {
  image: LockedImage;
  publicKey: string;
}

/** Builds the image on the host and hands it to the cluster's nodes. */
export async function loadLocalImage(
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
  if (repository.environment.provider === "k3d") {
    const { k3d } = repository.environment;
    if (k3d === undefined) {
      throw new Error(
        `environment ${repository.environment.name} is a k3d overlay without environment.k3d settings; add environment.k3d.clusterName so the built image can be imported`,
      );
    }
    await runner.run("k3d", k3dImageImportArgs(k3d.clusterName, imageTag), {
      capture: false,
    });
    return;
  }
  await runner.run(
    "minikube",
    minikubeImageLoadArgs(
      minikubeCluster(repository.environment).profile,
      imageTag,
    ),
    { capture: false },
  );
}

async function signImage(
  repository: Repository,
  runner: Runner,
  image: LockedImage,
  signer: LocalSigner,
  client: PublishSession["client"],
): Promise<void> {
  const signingReference = await localRegistryReference(
    repository,
    runner,
    image.reference,
  );
  await runner.run(
    "cosign",
    localSignArgs(signer.key, signingReference, client.caFile),
    {
      capture: false,
      env: { ...signer.env, ...client.env },
    },
  );
}

interface Context {
  repository: Repository;
  runner: Runner;
  signer: LocalSigner;
  session: PublishSession;
}

async function buildAndSign(
  { repository, runner, signer, session }: Context,
  application: string,
  entry: ImageLockEntry,
): Promise<BuiltLocalImage> {
  const imageTag = `kore-local/${application}:kore-local`;
  await localRegistryReference(repository, runner, `${entry.image}:kore-local`);
  await loadLocalImage(repository, runner, application, imageTag);
  const repositoryPath = await publishToLocalRegistry(
    repository,
    runner,
    entry,
    imageTag,
    session,
  );
  const digest = await publishedDigest(repositoryPath, session.client);
  const image: LockedImage = {
    reference: `${entry.image}@${digest}`,
    digest,
    signer: "local-kore-key",
  };
  await signImage(repository, runner, image, signer, session.client);
  return { image, publicKey: signer.publicKey };
}

export async function buildAndSignLocalImage(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
): Promise<BuiltLocalImage> {
  return await withPublishSession(repository, runner, (session) =>
    withLocalSigner(repository, runner, (signer) =>
      buildAndSign({ repository, runner, signer, session }, application, entry),
    ),
  );
}
