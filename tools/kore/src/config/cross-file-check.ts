// Reads one environment's service spec files and suborg records and runs the cross-file rules
// over them (cross-file-rules.ts). Read-only: it reads the working tree and contacts no cluster.
// A record that does not parse is left to its own check, which names it; this check judges only
// what it can read.
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { servicesDirectory } from "./app-records.js";
import {
  crossFileRules,
  type ComponentRequests,
  type CrossFileRulesReport,
  type ServiceFacts,
  type SuborgFacts,
} from "./cross-file-rules.js";
import { organizationsDirectory } from "./organization-records.js";
import type { Environment } from "./types.js";

export interface CrossFileCheck {
  /** The repository root. */
  root: string;
  environment: Environment;
}

/** A parsed-or-absent JSON value; an object's field, when it is one. */
type Json = unknown;

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: Json): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The file names of a directory that are records, as sorted repository paths keyed by name. */
async function recordPaths(
  root: string,
  directory: string,
  isRecordName: (entry: string) => boolean,
): Promise<Map<string, string>> {
  let entries: string[];
  try {
    entries = await readdir(join(root, directory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
  const paths = new Map<string, string>();
  for (const entry of entries.sort()) {
    if (!entry.startsWith(".") && isRecordName(entry)) {
      paths.set(entry.slice(0, -".json".length), `${directory}/${entry}`);
    }
  }
  return paths;
}

/** A record read as JSON, or undefined when it cannot be read or does not parse. */
async function readJson(root: string, file: string): Promise<Json> {
  try {
    return JSON.parse(await readFile(join(root, file), "utf8")) as Json;
  } catch {
    return undefined;
  }
}

/** A spec file's facts: its organization, its grants and each component's requests as written. */
function serviceFacts(
  name: string,
  file: string,
  manifest: Json,
): ServiceFacts {
  const spec =
    isRecord(manifest) && isRecord(manifest.spec) ? manifest.spec : {};
  const components = isRecord(spec.components) ? spec.components : {};
  const requests: ComponentRequests[] = Object.entries(components).map(
    ([component, value]) => {
      const resources =
        isRecord(value) && isRecord(value.resources) ? value.resources : {};
      const written = isRecord(resources.requests) ? resources.requests : {};
      return {
        component,
        cpu: textOf(written.cpu),
        memory: textOf(written.memory),
      };
    },
  );
  const allowFrom = Array.isArray(spec.allowFrom)
    ? spec.allowFrom.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  return {
    file,
    name,
    organization: textOf(spec.organization),
    allowFrom,
    requests,
  };
}

/** A suborg record's facts: its quota's requests, when the record carries both fields. */
function suborgFacts(name: string, file: string, manifest: Json): SuborgFacts {
  const spec =
    isRecord(manifest) && isRecord(manifest.spec) ? manifest.spec : {};
  const quota = isRecord(spec.quota) ? spec.quota : {};
  const requests = isRecord(quota.requests) ? quota.requests : {};
  const cpu = textOf(requests.cpu);
  const memory = textOf(requests.memory);
  return {
    name,
    file,
    quota:
      cpu === undefined || memory === undefined ? undefined : { cpu, memory },
  };
}

/**
 * The cross-file problems of one environment: its services' spec files and its suborg
 * records, judged by the rules. An environment with neither directory has nothing to judge.
 */
export async function checkCrossFileRules(
  check: CrossFileCheck,
): Promise<CrossFileRulesReport> {
  const { root, environment } = check;
  const servicesDir = servicesDirectory(environment.name);
  const suborgsDir = organizationsDirectory(environment.name);
  const specs = await recordPaths(
    root,
    servicesDir,
    (entry) => entry.endsWith(".json") && !entry.endsWith(".release.json"),
  );
  const suborgFiles = await recordPaths(root, suborgsDir, (entry) =>
    entry.endsWith(".json"),
  );
  const services: ServiceFacts[] = [];
  for (const [name, file] of specs) {
    const manifest = await readJson(root, file);
    if (manifest !== undefined) {
      services.push(serviceFacts(name, file, manifest));
    }
  }
  const suborgs: SuborgFacts[] = [];
  for (const [name, file] of suborgFiles) {
    suborgs.push(suborgFacts(name, file, await readJson(root, file)));
  }
  return crossFileRules({
    environment,
    organizationsDirectory: suborgsDir,
    services,
    suborgs,
  });
}
