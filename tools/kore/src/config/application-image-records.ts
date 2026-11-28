// Reads an environment's app records for suborg-image-policy (issue 1556): each spec
// file with the release file beside it, by service name. Read-only: it reads the
// working tree and contacts no cluster. A file that fails to parse is passed on as
// no manifest; the record check (app-records.ts) is the one that reports it.
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { servicesDirectory } from "./app-records.js";
import {
  applicationImagesOf,
  type ApplicationRecord,
} from "./application-images.js";
import { featureEnabled, suborgImagePolicyFlag } from "./features.js";
import type { ApplicationImage, Environment } from "./types.js";

const specSuffix = ".json";
const releaseSuffix = ".release.json";

/** A record file parsed, or undefined when it is missing or not strict JSON. */
async function manifest(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** The file names of the services directory; none when it does not exist. */
async function entries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * The application images of an environment's app records (issue 1556), read only
 * while suborg-image-policy is on; off, nothing is read and there are none, so the
 * repository carries no applicationImages field.
 */
export async function loadApplicationImages(
  root: string,
  environment: Pick<Environment, "name" | "features">,
): Promise<ApplicationImage[] | undefined> {
  if (!featureEnabled(environment, suborgImagePolicyFlag)) {
    return undefined;
  }
  const directory = servicesDirectory(environment.name);
  const services = (await entries(join(root, directory)))
    .filter(
      (name) => name.endsWith(specSuffix) && !name.endsWith(releaseSuffix),
    )
    .map((name) => name.slice(0, -specSuffix.length))
    .sort();
  const records: ApplicationRecord[] = [];
  for (const service of services) {
    const file = `${directory}/${service}${specSuffix}`;
    records.push({
      service,
      file,
      spec: await manifest(join(root, file)),
      release: await manifest(
        join(root, directory, `${service}${releaseSuffix}`),
      ),
    });
  }
  return applicationImagesOf(records);
}
