import type { Repository } from "../config/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appUp } from "../app/index.js";
import {
  loadImageLock,
  type ImageLockEntry,
  type LockedImage,
} from "../images/index.js";
import {
  buildAndSignLocalImage,
  type BuiltLocalImage,
} from "../images/index.js";
import { syncLocalSecrets } from "../security/index.js";
import {
  platformDestroy,
  platformStop,
  platformUp,
} from "../platform/index.js";
import type { Runner } from "../runtime/index.js";

export interface LocalLifecycleDependencies {
  platformUp?: typeof platformUp;
  appUp?: (
    repository: Repository,
    runner: Runner,
    name: string,
    image?: LockedImage,
    publicKey?: string,
  ) => Promise<void>;
  buildImage?: (
    repository: Repository,
    runner: Runner,
    name: string,
    entry: ImageLockEntry,
  ) => Promise<BuiltLocalImage>;
  syncSecrets?: typeof syncLocalSecrets;
  platformStop?: typeof platformStop;
  platformDestroy?: typeof platformDestroy;
}

function assertLocalMinikube(repository: Repository): void {
  if (repository.environment.provider !== "minikube") {
    throw new Error(
      "local lifecycle commands only manage Minikube environments",
    );
  }
}

export async function localUp(
  repository: Repository,
  runner: Runner,
  dependencies: LocalLifecycleDependencies = {},
): Promise<void> {
  assertLocalMinikube(repository);
  const lock = await loadImageLock(repository.root);
  await (dependencies.platformUp ?? platformUp)(repository, runner);
  await (dependencies.syncSecrets ?? syncLocalSecrets)(repository, runner);
  const localEntries: Record<string, ImageLockEntry> = {};
  const localLockPath = join(
    repository.root,
    ".kore",
    "state",
    "local-images.lock.json",
  );
  await mkdir(join(repository.root, ".kore", "state"), { recursive: true });
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
      built.publicKey,
    );
  }
}

export async function localDown(
  repository: Repository,
  runner: Runner,
  options: { prune: boolean; purgeData: boolean },
  dependencies: LocalLifecycleDependencies = {},
): Promise<void> {
  assertLocalMinikube(repository);
  if (options.purgeData && !options.prune)
    throw new Error(
      "--purge-data requires --prune; local down only destroys the cluster with --prune",
    );
  if (options.prune) {
    await (dependencies.platformDestroy ?? platformDestroy)(
      repository,
      runner,
      { yes: true, purgeData: options.purgeData },
    );
  } else {
    await (dependencies.platformStop ?? platformStop)(repository, runner);
  }
}
