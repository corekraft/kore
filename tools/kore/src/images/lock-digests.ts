import { access } from "node:fs/promises";
import type { Repository } from "../config/index.js";
import { environmentStatePath } from "../runtime/index.js";
import { loadImageLock } from "./image-lock.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

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
