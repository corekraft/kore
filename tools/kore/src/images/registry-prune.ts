import {
  featureEnabled,
  registryPruneFlag,
  revertKeepFlag,
  type Repository,
} from "../config/index.js";
import { RegistryPruneError } from "./registry-prune-error.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

/** kore's per-run tag. The `kore-src-*` source tags and `kore-local` are never candidates. */
const runTag = /^kore-local-[0-9a-f]{12}$/;
const digestIn = /@(sha256:[a-f0-9]{64})/;

/** How many distinct digests per service a revert can reach: the current one and the two before it. */
const revertDepth = 3;

/**
 * The release lock's history, read from git: each service's digests newest
 * first (repeats allowed), and every digest the history names, which stays
 * soaking until activation is recorded (ADR 0153; #1485).
 */
export interface RevertRecord {
  services: Map<string, string[]>;
  soaking: Set<string>;
}

/** Digests a revert needs: each service's last three distinct digests, and every digest still soaking. */
function revertKept(record: RevertRecord): Set<string> {
  const kept = new Set(record.soaking);
  for (const digests of record.services.values()) {
    for (const digest of [...new Set(digests)].slice(0, revertDepth)) {
      kept.add(digest);
    }
  }
  return kept;
}

/** What pruning needs from the registry; the push identity is the prune identity. */
export interface RegistryAdmin {
  repositories: () => Promise<string[]>;
  tags: (repository: string) => Promise<string[]>;
  digest: (repository: string, tag: string) => Promise<string>;
  /** When the tag's image was built, in epoch milliseconds. */
  created: (repository: string, tag: string) => Promise<number>;
  /** Deletes the manifest, which removes every tag on the digest. */
  remove: (repository: string, digest: string) => Promise<void>;
}

export interface RegistryPruneDependencies {
  holdsLease: () => Promise<boolean>;
  /** Every image any pod names; throws when the pods cannot be listed. */
  podImages: () => Promise<Set<string>>;
  /** Digests the image lock files reference. */
  lockedDigests: () => Promise<Set<string>>;
  /** The release lock's history; throws when it cannot be read whole. */
  revert: () => Promise<RevertRecord>;
  admin: RegistryAdmin;
  collectGarbage: () => Promise<void>;
  now: () => number;
  keepWindowMs: number;
}

/** Digests a pod names or a lock file references. */
async function protectedDigests(
  pods: Set<string>,
  dependencies: RegistryPruneDependencies,
): Promise<Set<string>> {
  const spared = new Set(await dependencies.lockedDigests());
  for (const image of pods) {
    const named = digestIn.exec(image)?.[1];
    if (named !== undefined) {
      spared.add(named);
    }
  }
  return spared;
}

/**
 * Deletes the repository's old per-run digests that nothing spares, adding to
 * `spared` every digest another tag keeps. Returns how many it deleted.
 */
async function pruneRepository(
  name: string,
  pods: Set<string>,
  spared: Set<string>,
  dependencies: RegistryPruneDependencies,
): Promise<number> {
  const { admin } = dependencies;
  const candidates: { tag: string; digest: string }[] = [];
  for (const tag of await admin.tags(name)) {
    const digest = await admin.digest(name, tag);
    const inUse = [...pods].some((image) => image.includes(`/${name}:${tag}`));
    if (runTag.test(tag) && !inUse) {
      candidates.push({ tag, digest });
    } else {
      spared.add(digest);
    }
  }
  const doomed = new Set<string>();
  for (const { tag, digest } of candidates) {
    const age = dependencies.now() - (await admin.created(name, tag));
    if (age > dependencies.keepWindowMs) {
      doomed.add(digest);
    } else {
      spared.add(digest);
    }
  }
  const deletable = [...doomed].filter((digest) => !spared.has(digest));
  for (const digest of deletable) {
    await admin.remove(name, digest);
  }
  return deletable.length;
}

/**
 * Deletes per-run tags older than the keep window from the registry, then
 * collects garbage. A delete removes every tag on a digest, so a digest is
 * spared when a pod uses it, a lock file references it, or any other tag
 * (a `kore-src-*` source tag, a young per-run tag, a signature or attestation
 * tag) names it. Behind the `registry-revert-keep` flag, a revert also needs
 * its digests (ADR 0153): each service's last three distinct digests in the
 * release lock's history and every digest still soaking are spared too, with
 * their signature and attestation tags.
 * Off unless the `registry-tag-pruning` flag is on; refuses without the host
 * lease; deletes nothing when the pods or the lock history cannot be read.
 * Returns the digests deleted.
 */
export async function pruneRegistryTags(
  repository: Repository,
  dependencies: RegistryPruneDependencies,
): Promise<number> {
  if (!featureEnabled(repository.environment, registryPruneFlag)) {
    return 0;
  }
  if (!(await dependencies.holdsLease())) {
    throw new RegistryPruneError(
      "refusing to prune registry tags without the host lease: a live run's tags would be at risk. Run it from `kore local up`, which holds the lease",
    );
  }
  const pods = await dependencies.podImages();
  const spared = await protectedDigests(pods, dependencies);
  if (featureEnabled(repository.environment, revertKeepFlag)) {
    for (const digest of revertKept(await dependencies.revert())) {
      spared.add(digest);
    }
  }
  let removed = 0;
  for (const name of await dependencies.admin.repositories()) {
    removed += await pruneRepository(name, pods, spared, dependencies);
  }
  if (removed > 0) {
    await dependencies.collectGarbage();
  }
  return removed;
}
