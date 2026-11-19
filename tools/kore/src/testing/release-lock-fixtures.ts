import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { defaultPlatformDomain } from "../config/index.js";

export const digest = "sha256:" + "a".repeat(64);

export const releaseSigner =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.1";

const lockDirectories: string[] = [];

/**
 * Writes an image lock like the one the release workflow emits and returns its
 * path relative to the repository root, as `appUp` takes it.
 */
export async function writeReleaseLock(
  root: string,
  signer = releaseSigner,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kore-release-lock-"));
  lockDirectories.push(directory);
  const path = join(directory, "images.lock.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      authorizedSigners: [signer],
      entries: {
        reference: {
          image: `registry.${defaultPlatformDomain}:30500/reference`,
          digest,
          signer,
        },
      },
    }),
  );
  return relative(root, path);
}

export async function removeReleaseLocks(): Promise<void> {
  await Promise.all(
    lockDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
