import { join } from "node:path";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { resolveBuildInputs } from "./local-image-base.js";
import { contextInputs, sourceTagOf } from "./local-image-context.js";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import { digestIfPublished, localRepositoryPath } from "./local-publish.js";
import type { PublishSession } from "./local-publish.js";
import { verifiedRegistryAddress } from "./registry-service.js";

// Docs: AGENTS.md "It just works." (a no-change rerun is a no-op, not a rollout)

export function applicationPath(
  repository: Repository,
  application: string,
): string {
  return join(repository.root, "apps", application);
}

/**
 * The registry tag naming everything this image is built from, or undefined
 * when any of it is unknown (no Dockerfile, a base that does not resolve):
 * the run then builds, and publishes no source tag, rather than reuse an image
 * built from inputs it cannot name.
 */
export async function sourceTag(
  repository: Repository,
  runner: Runner,
  application: string,
): Promise<string | undefined> {
  const { hash, dockerfile } = await contextInputs(
    applicationPath(repository, application),
  );
  if (hash === undefined || dockerfile === undefined) {
    return undefined;
  }
  const inputs = await resolveBuildInputs(runner, dockerfile);
  if (inputs === undefined) {
    process.stderr.write(
      `could not resolve the base image of apps/${application}; building without reusing an earlier image\n`,
    );
    return undefined;
  }
  return sourceTagOf(hash, inputs.bases, inputs.platform);
}

export interface SourceLookup {
  repositoryPath: string;
  /** The tag naming this source, when every input is known. */
  source: string | undefined;
  /** The image an earlier run published for this source, when there is one. */
  reused: LockedImage | undefined;
  lock: (digest: string) => LockedImage;
}

/**
 * Finds the image an earlier run built from the same inputs. A run reusing it
 * builds and publishes nothing, so the release's desired state does not
 * change; it still signs again, since the key may have been recreated with
 * the cluster. A registry answer other than found or not found is an error.
 */
export async function lookUpSource(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
  client: PublishSession["client"],
): Promise<SourceLookup> {
  const repositoryPath = localRepositoryPath(entry);
  const address = await verifiedRegistryAddress(repository, runner);
  const lock = (digest: string): LockedImage => ({
    // The deployed name is the registry address the nodes pull from and the
    // image policy matches, not the host the release lock records.
    reference: `${address}/${repositoryPath}@${digest}`,
    digest,
    signer: "local-kore-key",
  });
  const source = await sourceTag(repository, runner, application);
  const digest =
    source === undefined
      ? undefined
      : await digestIfPublished(repositoryPath, client, source);
  return {
    repositoryPath,
    source,
    reused: digest === undefined ? undefined : lock(digest),
    lock,
  };
}
