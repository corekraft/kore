// Reads one environment's service spec files and suborg records and runs the cross-file rules
// over them (cross-file-rules.ts). Read-only: it reads the working tree and contacts no cluster.
// A record that is not valid JSON is named by an error here and judged no further; a read failure
// other than an absent file stops the check. This check judges only what it can read.
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

/** A record read as JSON: its value, and the error to report when the file is not valid JSON. */
interface JsonRead {
  value: Json;
  error?: string;
}

/**
 * A record read as JSON. A missing file reads as absent. A file that is not valid JSON reads as
 * absent and reports an error naming it. Any other read failure is rethrown with the fix, so an
 * unreadable record never passes unchecked.
 */
async function readJson(root: string, file: string): Promise<JsonRead> {
  try {
    return {
      value: JSON.parse(await readFile(join(root, file), "utf8")) as Json,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        value: undefined,
        error: `${file}: the record is not valid JSON (${error.message}); fix the JSON syntax in ${file}, then run kore validate again`,
      };
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: undefined };
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not read ${file}: ${detail}; check the file's permissions and the disk that holds it, then run kore validate again`,
      { cause: error },
    );
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
  const readErrors: string[] = [];
  const services: ServiceFacts[] = [];
  for (const [name, file] of specs) {
    const read = await readJson(root, file);
    if (read.error !== undefined) {
      readErrors.push(read.error);
    }
    if (read.value !== undefined) {
      services.push(serviceFacts(name, file, read.value));
    }
  }
  const suborgs: SuborgFacts[] = [];
  for (const [name, file] of suborgFiles) {
    const read = await readJson(root, file);
    if (read.error !== undefined) {
      readErrors.push(read.error);
    }
    suborgs.push(suborgFacts(name, file, read.value));
  }
  const report = crossFileRules({
    environment,
    organizationsDirectory: suborgsDir,
    services,
    suborgs,
  });
  return {
    errors: [...readErrors, ...report.errors],
    warnings: report.warnings,
  };
}
