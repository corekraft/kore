import { access } from "node:fs/promises";
import type { Repository } from "../config/index.js";
import { environmentStatePath, type Runner } from "../runtime/index.js";
import { loadImageLock } from "./image-lock.js";
import { RegistryPruneError } from "./registry-prune-error.js";
import type { RevertRecord } from "./registry-prune.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md
// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md

/** The release lock a revert reverts: a rollback is a reverted lock (ADR 0153). */
const releaseLockPath = "infra/catalog/images.lock.json";
const sha256 = /^sha256:[a-f0-9]{64}$/;

/**
 * Every digest the catalog image lock or this environment's local lock names.
 * A lock that exists but cannot be read fails the call, so nothing is pruned
 * on a guess; a local lock not written yet is simply absent.
 */
export async function lockedDigests(
  repository: Repository,
): Promise<Set<string>> {
  const locks = [await loadImageLock(repository.root)];
  const localPath = environmentStatePath(
    repository.root,
    repository.environment.name,
    "local-images.lock.json",
  );
  const present = await access(localPath).then(
    () => true,
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    },
  );
  if (present) {
    locks.push(await loadImageLock("/", localPath));
  }
  return new Set(
    locks.flatMap((lock) =>
      Object.values(lock.entries).map((entry) => entry.digest),
    ),
  );
}

/** Each service's digest in one committed release lock. Throws when the file is not a release lock or a service names no sha256 digest. */
function digestsOf(text: string, commit: string): [string, string][] {
  const lock: unknown = JSON.parse(text);
  const entries =
    typeof lock === "object" && lock !== null && "entries" in lock
      ? lock.entries
      : undefined;
  if (typeof entries !== "object" || entries === null) {
    throw new RegistryPruneError(
      `the file at ${commit} has no entries object, so it is not a release lock; nothing is pruned on a guess`,
    );
  }
  return Object.entries(entries).map(([name, entry]) => {
    const digest: unknown =
      typeof entry === "object" && entry !== null && "digest" in entry
        ? entry.digest
        : undefined;
    if (typeof digest !== "string" || !sha256.test(digest)) {
      throw new RegistryPruneError(
        `the release lock at ${commit} names no sha256 digest for ${name}; nothing is pruned on a guess`,
      );
    }
    return [name, digest];
  });
}

/**
 * Reads the release lock's git history for the prune: each service's digests
 * newest first, and every digest the history names, which stays soaking until
 * activation is recorded (#1485). Refuses a shallow checkout, whose history is
 * incomplete, and any commit whose lock cannot be read, so the prune deletes
 * nothing on a guess.
 */
export async function readRevertRecord(
  repository: Repository,
  runner: Runner,
): Promise<RevertRecord> {
  const git = async (args: string[]): Promise<string> =>
    (
      await runner.run("git", ["-C", repository.root, ...args], {
        capture: true,
      })
    ).stdout;
  if ((await git(["rev-parse", "--is-shallow-repository"])).trim() === "true") {
    throw new RegistryPruneError(
      "refusing to prune registry tags: this checkout is shallow, so the release lock's history is incomplete and a revert's digest could be deleted. Run `git fetch --unshallow` and run it again",
    );
  }
  const commits = (await git(["log", "--format=%H", "--", releaseLockPath]))
    .split("\n")
    .filter((line) => line !== "");
  const services = new Map<string, string[]>();
  const soaking = new Set<string>();
  for (const commit of commits) {
    const text = await git(["show", `${commit}:${releaseLockPath}`]);
    for (const [name, digest] of digestsOf(text, commit)) {
      services.set(name, [...(services.get(name) ?? []), digest]);
      soaking.add(digest);
    }
  }
  return { services, soaking };
}
