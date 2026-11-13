import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import { digestIfPublished, localRepositoryPath } from "./local-publish.js";
import type { PublishSession } from "./local-publish.js";
import { verifiedRegistryAddress } from "./registry-service.js";

// Docs: AGENTS.md "It just works." (a no-change rerun is a no-op, not a rollout)

const ignored = new Set(["node_modules", ".git"]);

async function filesOf(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // docker build then names the missing application
    }
    throw error;
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignored.has(entry.name))
      .map(async (entry) => {
        if (entry.isDirectory()) {
          return await filesOf(join(directory, entry.name));
        }
        return entry.isFile() ? [join(directory, entry.name)] : [];
      }),
  );
  return nested.flat().sort();
}

/**
 * A registry tag naming the build context's content. A docker build stamps
 * the image with a creation time, so the same source builds a new digest each
 * run; the tag lets a run find the image an earlier run built from the same
 * source. It covers more than `.dockerignore` keeps out, so a spurious change
 * only costs a rebuild, never a stale image.
 */
export async function sourceTag(context: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await filesOf(context)) {
    hash.update(`${relative(context, file)}\0`);
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return `kore-src-${hash.digest("hex").slice(0, 16)}`;
}

export function applicationPath(
  repository: Repository,
  application: string,
): string {
  return join(repository.root, "apps", application);
}

export interface SourceLookup {
  address: string;
  repositoryPath: string;
  /** The registry tag naming this source. */
  source: string;
  /** The digest an earlier run published for this source, when there is one. */
  reused: LockedImage | undefined;
  lock: (digest: string) => LockedImage;
}

/**
 * Finds the image an earlier run built from the same source. A run reusing it
 * builds and publishes nothing, so the release's desired state does not
 * change; it still signs again, since the key may have been recreated with
 * the cluster.
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
  const source = await sourceTag(applicationPath(repository, application));
  const digest = await digestIfPublished(repositoryPath, client, source);
  return {
    address,
    repositoryPath,
    source,
    reused: digest === undefined ? undefined : lock(digest),
    lock,
  };
}
