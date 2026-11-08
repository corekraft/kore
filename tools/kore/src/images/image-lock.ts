import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ImageLockEntry {
  image: string;
  digest: string;
  signer: string;
}

export interface ImageLock {
  version: 1;
  authorizedSigners: string[];
  entries: Record<string, ImageLockEntry>;
}

export interface LockedImage {
  reference: string;
  digest: string;
  signer: string;
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const imagePattern = /^[^@\s/]+(?:\/[^@\s]+)+$/;

function validate(lock: unknown, source: string): ImageLock {
  if (!lock || typeof lock !== "object") {
    throw new Error(`image lock ${source} must be an object`);
  }
  const candidate = lock as Partial<ImageLock>;
  if (
    candidate.version !== 1 ||
    !candidate.entries ||
    typeof candidate.entries !== "object" ||
    !Array.isArray(
      (candidate as ImageLock & { authorizedSigners?: unknown })
        .authorizedSigners,
    ) ||
    !(candidate as ImageLock).authorizedSigners.length
  ) {
    throw new Error(
      `image lock ${source} must have version 1, authorized signers, and entries`,
    );
  }
  for (const [application, entry] of Object.entries(candidate.entries)) {
    if (
      !/^[a-z0-9-]+$/.test(application) ||
      !entry ||
      typeof entry !== "object"
    ) {
      throw new Error(
        `image lock ${source} has an invalid entry for ${application}`,
      );
    }
    const value = entry as ImageLockEntry;
    const repositoryPart = value.image.slice(value.image.lastIndexOf("/") + 1);
    if (!imagePattern.test(value.image) || repositoryPart.includes(":")) {
      throw new Error(
        `image lock ${source} entry ${application} must use an internal image without a tag`,
      );
    }
    if (!digestPattern.test(value.digest)) {
      throw new Error(
        `image lock ${source} entry ${application} has an invalid digest`,
      );
    }
    if (!value.signer?.trim()) {
      throw new Error(
        `image lock ${source} entry ${application} has no signer`,
      );
    }
    if (!(candidate as ImageLock).authorizedSigners.includes(value.signer)) {
      throw new Error(
        `image lock ${source} entry ${application} has an unauthorized signer`,
      );
    }
  }
  return candidate as ImageLock;
}

export async function loadImageLock(
  root: string,
  path = "infra/catalog/images.lock.json",
): Promise<ImageLock> {
  const source = join(root, path);
  let contents: string;
  try {
    contents = await readFile(source, "utf8");
  } catch (error) {
    throw new Error(`image lock is required at ${source}: ${String(error)}`);
  }
  try {
    return validate(JSON.parse(contents), source);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `image lock ${source} is invalid`,
    );
  }
}

export function imageForApplication(
  lock: ImageLock,
  application: string,
): LockedImage {
  const entry = lock.entries[application];
  if (!entry) {
    throw new Error(`no locked image for application ${application}`);
  }
  return {
    reference: `${entry.image}@${entry.digest}`,
    digest: entry.digest,
    signer: entry.signer,
  };
}
