import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export async function withEnvironmentLock<T>(
  root: string,
  environment: string,
  operation: () => Promise<T>,
): Promise<T> {
  const base = join(root, ".kore", "locks");
  const lock = join(base, `${environment}.lock`);
  await mkdir(base, { recursive: true });
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      `another mutation is already running for environment ${environment}`,
    );
  }
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
