import type { Clock, FileSystem } from "../runtime/index.js";

/** A lock older than this was left by a poller that died, and is taken over. */
export const STALE_LOCK_MS = 60_000;

export type Held =
  | {
      ok: true;
      /** Stamps the lock with the current time, so a long poll is not mistaken for a dead one. */
      refresh(): Promise<void>;
      release(): Promise<void>;
    }
  | { ok: false; message: string };

const isExists = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "EEXIST";

async function isStale(
  fs: FileSystem,
  clock: Clock,
  path: string,
): Promise<boolean> {
  const taken = Date.parse(await fs.readFile(path).catch(() => ""));
  // Unreadable or empty content cannot be aged, so it cannot be honoured either.
  return Number.isNaN(taken) || clock.now().getTime() - taken > STALE_LOCK_MS;
}

/**
 * Takes an exclusive lock file with an exclusive create, so two pollers cannot
 * both read the ledger and append the same transitions. A stale lock is
 * removed and taken with the same exclusive create; losing that race is busy.
 */
export async function acquire(
  fs: FileSystem,
  clock: Clock,
  path: string,
): Promise<Held> {
  const busy = {
    ok: false as const,
    message: `Another poll holds ${path}. Wait for it, or delete the file if no poll is running.`,
  };
  for (const attempt of [0, 1]) {
    try {
      await fs.createFile(path, clock.now().toISOString());
      return {
        ok: true,
        refresh: () => fs.writeFile(path, clock.now().toISOString()),
        release: () => fs.remove(path),
      };
    } catch (error) {
      if (!isExists(error)) {
        throw error;
      }
    }
    if (attempt === 1 || !(await isStale(fs, clock, path))) {
      return busy;
    }
    await fs.remove(path);
  }
  return busy;
}
