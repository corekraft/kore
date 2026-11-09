import { readFile } from "node:fs/promises";

/** Who holds a lock. Written atomically with the lock itself. */
export interface LockOwner {
  pid: number;
  host: string;
  token: string;
  acquiredAt: string;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function parseOwner(text: string): LockOwner | undefined {
  try {
    const value = JSON.parse(text) as Partial<LockOwner>;
    if (
      Number.isInteger(value.pid) &&
      typeof value.host === "string" &&
      typeof value.token === "string" &&
      typeof value.acquiredAt === "string"
    ) {
      return value as LockOwner;
    }
  } catch {
    // Malformed content is treated like a missing owner.
  }
  return undefined;
}

/** Reads the owner, or "gone" when the lock file does not exist (any more). */
export async function readLock(
  lock: string,
): Promise<LockOwner | undefined | "gone"> {
  let text: string;
  try {
    text = await readFile(lock, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return "gone";
    }
    // A legacy lock is a directory.
    if (errorCode(error) === "EISDIR") {
      return undefined;
    }
    throw error;
  }
  return parseOwner(text);
}

export async function readOwner(lock: string): Promise<LockOwner | undefined> {
  const read = await readLock(lock);
  return read === "gone" ? undefined : read;
}
