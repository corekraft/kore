import { isLocalProvider, type Repository } from "../config/index.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appUp, type AppUpOptions } from "../app/index.js";
import {
  buildAndSignLocalImage,
  loadImageLock,
  pruneStaleImageTags,
  type BuiltLocalImage,
  type ImageLockEntry,
  type LockedImage,
} from "../images/index.js";
import { syncLocalSecrets } from "../security/index.js";
import {
  platformDestroy,
  platformStop,
  platformUp,
} from "../platform/index.js";
import {
  CommandError,
  environmentStatePath,
  type Runner,
} from "../runtime/index.js";

export interface LocalLifecycleDependencies {
  platformUp?: typeof platformUp;
  appUp?: (
    repository: Repository,
    runner: Runner,
    name: string,
    image?: LockedImage,
    options?: AppUpOptions,
  ) => Promise<void>;
  buildImage?: (
    repository: Repository,
    runner: Runner,
    name: string,
    entry: ImageLockEntry,
  ) => Promise<BuiltLocalImage>;
  syncSecrets?: typeof syncLocalSecrets;
  pruneImageTags?: typeof pruneStaleImageTags;
  platformStop?: typeof platformStop;
  platformDestroy?: typeof platformDestroy;
}

function assertLocal(repository: Repository): void {
  if (!isLocalProvider(repository.environment)) {
    throw new Error(
      `local lifecycle commands only manage k3d environments; environment ${repository.environment.name} is ${repository.environment.provider}`,
    );
  }
}

/**
 * Removes the tags earlier runs left, before this run builds any. It is
 * housekeeping: a command failing here (no docker daemon) is reported and the
 * run goes on, but a bug or a refusal is not hidden.
 */
async function pruneStaleTags(
  repository: Repository,
  runner: Runner,
  dependencies: LocalLifecycleDependencies,
): Promise<void> {
  try {
    await (dependencies.pruneImageTags ?? pruneStaleImageTags)(
      repository,
      runner,
    );
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    process.stderr.write(
      `could not prune stale local image tags, continuing: ${error.message}\n`,
    );
  }
}

export async function localUp(
  repository: Repository,
  runner: Runner,
  dependencies: LocalLifecycleDependencies = {},
): Promise<void> {
  assertLocal(repository);
  const lock = await loadImageLock(repository.root);
  await (dependencies.platformUp ?? platformUp)(repository, runner);
  await (dependencies.syncSecrets ?? syncLocalSecrets)(repository, runner);
  await pruneStaleTags(repository, runner, dependencies);
  const localEntries: Record<string, ImageLockEntry> = {};
  const localLockPath = environmentStatePath(
    repository.root,
    repository.environment.name,
    "local-images.lock.json",
  );
  await mkdir(dirname(localLockPath), { recursive: true });
  // A lock from an earlier run names digests signed by a key that may have
  // vanished with its cluster; every run re-signs, so start without it.
  await rm(localLockPath, { force: true });
  for (const application of Object.keys(lock.entries).sort()) {
    const built = await (dependencies.buildImage ?? buildAndSignLocalImage)(
      repository,
      runner,
      application,
      lock.entries[application]!,
    );
    localEntries[application] = {
      image: lock.entries[application]!.image,
      digest: built.image.digest,
      signer: built.image.signer,
    };
    await writeFile(
      localLockPath,
      JSON.stringify(
        {
          version: 1,
          authorizedSigners: ["local-kore-key"],
          entries: localEntries,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await (dependencies.appUp ?? appUp)(
      repository,
      runner,
      application,
      built.image,
      { publicKey: built.publicKey },
    );
  }
}

export async function localDown(
  repository: Repository,
  runner: Runner,
  options: { prune: boolean; purgeData: boolean; force?: boolean },
  dependencies: LocalLifecycleDependencies = {},
): Promise<void> {
  assertLocal(repository);
  if (options.purgeData && !options.prune) {
    throw new Error(
      "--purge-data requires --prune; local down only destroys the cluster with --prune",
    );
  }
  if (options.prune) {
    // The signing key lives in the cluster Secret and is destroyed with it.
    const state = (file: string) =>
      environmentStatePath(repository.root, repository.environment.name, file);
    await rm(state("local-images.lock.json"), { force: true });
    await rm(state("local-signing.pub"), { force: true });
    await (dependencies.platformDestroy ?? platformDestroy)(
      repository,
      runner,
      {
        yes: true,
        purgeData: options.purgeData,
        force: options.force === true,
      },
    );
  } else {
    await (dependencies.platformStop ?? platformStop)(
      repository,
      runner,
      {},
      {
        force: options.force === true,
      },
    );
  }
}
