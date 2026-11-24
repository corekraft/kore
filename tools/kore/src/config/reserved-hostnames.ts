// The labels no hostname claim may take (ADR 0159): one schema-checked list the owner
// reviews, in infra/catalog. kore validate reads it, so the claim rules and the app
// model's reserved suborg names (ADR 0165) cannot drift apart: a catalog namespace
// added without a line here fails validation. Pure checks; readReservedHostnames reads
// the two files and nothing else.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schemaErrors, type SchemaNode } from "./schema-subset.js";

export type { SchemaNode } from "./schema-subset.js";

/** The reserved-name list, a repository path. */
export const reservedHostnamesPath = "infra/catalog/reserved-hostnames.json";
/** The schema the list is checked against, a repository path. */
export const reservedHostnamesSchemaPath =
  "infra/catalog/schemas/reserved-hostnames.schema.json";

/**
 * The shape of the list against its schema, then the rules the schema cannot state:
 * a name is listed once. Messages begin with the file.
 */
export function reservedListErrors(
  file: string,
  manifest: unknown,
  schema: SchemaNode,
): string[] {
  const errors = schemaErrors(schema, manifest, "").map(
    (message) => `${file}: ${message}`,
  );
  const names = namesOf(manifest);
  if (names === undefined) {
    return errors;
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      errors.push(`${file}: names repeats "${name}": remove the repeat`);
    }
    seen.add(name);
  }
  return errors;
}

/**
 * Every name the app model reserves for suborgs must be in the list: a suborg may not
 * take a namespace the catalog installs, so the list carries each one (ADR 0165).
 */
export function reservedCoverageErrors(
  file: string,
  names: ReadonlySet<string>,
  appNames: readonly string[],
): string[] {
  return appNames
    .filter((name) => !names.has(name))
    .map(
      (name) =>
        `${file}: names is missing "${name}", a suborg name the app model reserves (ADR 0165): add it, so no hostname claim takes a suborg's name`,
    );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The string names of a list that has an array of names; undefined when it has none. */
function namesOf(manifest: unknown): string[] | undefined {
  if (!isRecord(manifest) || !Array.isArray(manifest.names)) {
    return undefined;
  }
  return manifest.names.filter(
    (name): name is string => typeof name === "string",
  );
}

/** The reading of the list and its schema, from the repository root. */
export interface ReservedHostnames {
  /** The reserved labels; a malformed list still yields the names it holds as strings. */
  names: ReadonlySet<string>;
  /** Problems that fail kore validate, each naming the file. */
  errors: string[];
}

/**
 * Reads the reserved-name list and checks it against its schema. A missing or
 * unparseable list is an error that names the file, never an empty set that would
 * let every label through.
 */
export async function readReservedHostnames(
  root: string,
): Promise<ReservedHostnames> {
  const file = reservedHostnamesPath;
  let text: string;
  try {
    text = await readFile(join(root, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        names: new Set(),
        errors: [
          `${file}: the reserved-name list is missing; restore it, it names the labels no hostname claim may take (ADR 0159)`,
        ],
      };
    }
    throw error;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      names: new Set(),
      errors: [
        `${file}: the reserved-name list must be strict JSON: ${String(error)}`,
      ],
    };
  }
  const schema = JSON.parse(
    await readFile(join(root, reservedHostnamesSchemaPath), "utf8"),
  ) as SchemaNode;
  return {
    names: new Set(namesOf(manifest) ?? []),
    errors: reservedListErrors(file, manifest, schema),
  };
}
