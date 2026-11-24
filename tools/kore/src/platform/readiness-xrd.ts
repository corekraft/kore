import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

/** The kubectl resource kind of a Crossplane XRD; a readiness entry is `<kind>/<name>`. */
const XRD_KIND = "compositeresourcedefinition.apiextensions.crossplane.io/";
const NOT_FOUND = /NotFound|not found/i;
/** How many missing fields a failure lists before it counts the rest. */
const LISTED = 5;

/** What the check reads from: the runner and the kubectl scope of the component. */
export interface XrdContext {
  runner: Runner;
  base: string[];
}

/** A readiness check: the condition it proves and a bounded evaluation. */
export interface XrdCheck {
  condition: string;
  run: (timeout: string) => Promise<void>;
}

interface Schema {
  properties?: Record<string, Schema>;
  items?: Schema;
}

interface Versioned {
  name?: string;
  schema?: { openAPIV3Schema?: Schema };
}

interface Xrd {
  metadata?: { generation?: number };
  spec?: { versions?: Versioned[] };
  status?: {
    conditions?: {
      type?: string;
      status?: string;
      message?: string;
      observedGeneration?: number;
    }[];
  };
}

interface Crd {
  spec?: { versions?: Versioned[] };
}

/**
 * Proves an XRD is rendered into its CRD, which `Established=True` does not: when
 * Crossplane cannot render a schema (for example `additionalProperties` beside
 * `properties`) the XRD keeps reading Established while its condition's
 * observedGeneration lags and the CRD keeps its old fields (#2047). Fails closed on
 * a lagging generation, a missing observedGeneration, or a declared field the CRD
 * lacks, and names the cause to read. Undefined for any other resource.
 */
export function xrdCheck(
  context: XrdContext,
  resource: string,
): XrdCheck | undefined {
  if (!resource.startsWith(XRD_KIND)) {
    return undefined;
  }
  const name = resource.slice(XRD_KIND.length);
  return {
    condition:
      "rendered into its CRD: generation observed, declared fields present",
    run: (timeout) =>
      pollUntil(timeout, () => notReadyReason(context, resource, name)),
  };
}

/** The object as JSON, or undefined when the cluster does not have it yet. */
async function read<T>(
  { runner, base }: XrdContext,
  resource: string,
): Promise<T | undefined> {
  try {
    const result = await runner.run(
      "kubectl",
      [...base, "get", resource, "--output", "json"],
      { capture: true },
    );
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

/** The path of every field a schema declares, through objects and arrays. */
function fieldPaths(node: Schema | undefined, path: string): string[] {
  if (node === undefined) {
    return [];
  }
  const own = Object.entries(node.properties ?? {}).flatMap(([name, child]) => {
    const here = path === "" ? name : `${path}.${name}`;
    return [here, ...fieldPaths(child, here)];
  });
  return [...own, ...fieldPaths(node.items, `${path}[]`)];
}

/** Declared leaves only: a parent is present once its child is, so only the deepest paths are listed. */
function leafPaths(node: Schema | undefined): string[] {
  const all = fieldPaths(node, "");
  return all.filter(
    (path) =>
      !all.some(
        (other) =>
          other !== path &&
          (other.startsWith(`${path}.`) || other.startsWith(`${path}[]`)),
      ),
  );
}

const READ_EVENTS = (name: string) =>
  `read \`kubectl describe compositeresourcedefinition ${name}\`: its EstablishComposite events name why Crossplane could not render the schema (for example additionalProperties beside properties)`;

async function notReadyReason(
  context: XrdContext,
  resource: string,
  name: string,
): Promise<string | undefined> {
  const xrd = await read<Xrd>(context, resource);
  if (xrd === undefined) {
    return `XRD ${name} does not exist yet`;
  }
  const established = xrd.status?.conditions?.find(
    (condition) => condition.type === "Established",
  );
  if (established === undefined) {
    return `XRD ${name} has no Established condition yet`;
  }
  if (established.status !== "True") {
    return `XRD ${name}: Established is ${established.status ?? "unknown"}${established.message === undefined ? "" : ` (${established.message})`}; ${READ_EVENTS(name)}`;
  }
  const generation = xrd.metadata?.generation ?? 0;
  if (established.observedGeneration === undefined) {
    return `XRD ${name} is at generation ${generation} but its Established condition observed no generation, so Crossplane has not confirmed rendering the schema; ${READ_EVENTS(name)}`;
  }
  if (established.observedGeneration < generation) {
    return `XRD ${name} is at generation ${generation} but its Established condition observed generation ${established.observedGeneration}: Crossplane has not rendered the latest schema into the CRD, though Established is True; ${READ_EVENTS(name)}`;
  }
  return missingFields(context, xrd, name);
}

async function missingFields(
  context: XrdContext,
  xrd: Xrd,
  name: string,
): Promise<string | undefined> {
  const crd = await read<Crd>(context, `crd/${name}`);
  if (crd === undefined) {
    return `CRD ${name} does not exist yet: Crossplane has not rendered XRD ${name} into it`;
  }
  const missing: string[] = [];
  for (const version of xrd.spec?.versions ?? []) {
    const established = new Set(
      fieldPaths(
        crd.spec?.versions?.find((v) => v.name === version.name)?.schema
          ?.openAPIV3Schema,
        "",
      ),
    );
    missing.push(
      ...leafPaths(version.schema?.openAPIV3Schema).filter(
        (path) => !established.has(path),
      ),
    );
  }
  if (missing.length === 0) {
    return undefined;
  }
  const listed = missing.slice(0, LISTED).join(", ");
  const rest =
    missing.length > LISTED ? `, and ${missing.length - LISTED} more` : "";
  return `CRD ${name} lacks ${missing.length} field(s) the XRD declares: ${listed}${rest}; Crossplane has not rendered the XRD's schema; ${READ_EVENTS(name)}`;
}
