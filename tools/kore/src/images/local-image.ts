import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import type { Repository } from "../config/index.js";
import {
  localDockerBuildArgs,
  k3dImageImportArgs,
  localSignArgs,
  newRunTag,
} from "./local-image-args.js";
import { withLocalSigner, type LocalSigner } from "./local-signer.js";
import { localRegistryReference } from "./registry.js";
import {
  applicationPath,
  lookUpSource,
  sourceTag,
} from "./local-image-source.js";
import {
  publishedDigest,
  publishToLocalRegistry,
  requireK3d,
  withPublishSession,
  type PublishSession,
} from "./local-publish.js";
import { CommandError, type Runner } from "../runtime/index.js";

export {
  imageDigestFromRegistryHead,
  k3dImageImportArgs,
  localDockerBuildArgs,
  k3dImagePublishArgs,
  k3dRegistrySessionArgs,
  localSignArgs,
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
    localDockerBuildArgs(applicationPath(repository, application), imageTag),
    { capture: false, cwd: repository.root },
  );
  const k3d = requireK3d(repository);
  await runner.run("k3d", k3dImageImportArgs(k3d.clusterName, imageTag), {
    capture: false,
  });
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
      kubeconfig: signer.kubeconfig,
    },
  );
}

interface Context {
  repository: Repository;
  runner: Runner;
  signer: LocalSigner;
  session: PublishSession;
}

/** Per-run tags would pile up on the host; the registry and nodes hold the image by digest. */
async function forgetHostTag(runner: Runner, imageTag: string): Promise<void> {
  try {
    await runner.run("docker", ["image", "rm", imageTag], { capture: true });
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    // Removing the tag is housekeeping; the build itself already succeeded.
  }
}

async function unchangedSourceTags(
  repository: Repository,
  runner: Runner,
  application: string,
  before: string | undefined,
): Promise<string[]> {
  if (before === undefined) {
    return [];
  }
  const after = await sourceTag(repository, runner, application);
  if (after === before) {
    return [before];
  }
  process.stderr.write(
    `apps/${application} changed during the build; this run deploys the image it built but does not tag it for reuse\n`,
  );
  return [];
}

async function buildAndSign(
  { repository, runner, signer, session }: Context,
  application: string,
  entry: ImageLockEntry,
): Promise<BuiltLocalImage> {
  const found = await lookUpSource(
    repository,
    runner,
    application,
    entry,
    session.client,
  );
  if (found.reused !== undefined) {
    await signImage(repository, runner, found.reused, signer, session.client);
    return { image: found.reused, publicKey: signer.publicKey };
  }
  // A tag of this run's own: a shared mutable tag lets a concurrent build in
  // another worktree replace the image between build, import and digest read.
  const runTag = newRunTag();
  const imageTag = `kore-local/${application}:${runTag}`;
  try {
    await localRegistryReference(
      repository,
      runner,
      `${entry.image}:${runTag}`,
    );
    await loadLocalImage(repository, runner, application, imageTag);
    // An edit during the build may not have reached the image, so the source
    // tag goes on only when the inputs are the ones the lookup named.
    const extraTags = await unchangedSourceTags(
      repository,
      runner,
      application,
      found.source,
    );
    await publishToLocalRegistry(
      repository,
      runner,
      entry,
      { imageTag, extraTags },
      session,
    );
    const digest = await publishedDigest(
      found.repositoryPath,
      session.client,
      runTag,
    );
    const image = found.lock(digest);
    await signImage(repository, runner, image, signer, session.client);
    return { image, publicKey: signer.publicKey };
  } finally {
    await forgetHostTag(runner, imageTag);
  }
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
