import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Runner } from "../runtime/index.js";
import { schemaProblems } from "./schema-compat.js";

const VERSIONS = "infra/catalog/versions.yaml";
const COMPONENTS = "infra/catalog/components.yaml";
const CONTRACT = "infra/apis/postgresql/definitions/postgresqlinstance.yaml";
const CONTRACT_NAME = "postgresqlinstance";

/** What an upgrade compares: pinned versions, owned CRDs, the application contract. */
export interface Snapshot {
  kubernetes: string;
  components: Record<string, string>;
  owns?: Record<string, string[]>;
  /** The CompositeResourceDefinition applications claim through, as JSON. */
  xrd?: unknown;
}

export interface VersionChange {
  name: string;
  from: string | undefined;
  to: string | undefined;
}

export interface UpgradeResult {
  from: string;
  changes: VersionChange[];
  problems: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parts(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(/[-+]/)[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compare(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function snapshotFrom(
  versions: unknown,
  catalog: unknown,
  xrd: unknown,
): Snapshot {
  const keys = record(record(versions).components);
  const components: Record<string, string> = {};
  const owns: Record<string, string[]> = {};
  const list = record(catalog).components;
  for (const entry of Array.isArray(list) ? list : []) {
    const component = record(entry);
    const name = String(component.name);
    const version = keys[String(component.version)];
    if (typeof version === "string") {
      components[name] = version;
    }
    owns[name] = Array.isArray(component.ownsCRDs)
      ? component.ownsCRDs.map(String)
      : [];
  }
  return {
    kubernetes: text(record(versions).kubernetes),
    components,
    owns,
    xrd,
  };
}

async function toJson(runner: Runner, yaml: string): Promise<unknown> {
  const { stdout } = await runner.run("yq", ["--output-format=json", "."], {
    capture: true,
    input: yaml,
  });
  return JSON.parse(stdout) as unknown;
}

/** The catalog snapshot recorded at release tag `ref`, read with `git show`. */
export async function snapshotAt(
  runner: Runner,
  root: string,
  ref: string,
): Promise<Snapshot> {
  const show = async (path: string): Promise<string> => {
    try {
      const { stdout } = await runner.run("git", ["show", `${ref}:${path}`], {
        capture: true,
        cwd: root,
      });
      return stdout;
    } catch (error) {
      throw new Error(
        `cannot read ${path} at ${ref}: ${error instanceof Error ? error.message : String(error)}; fetch the tag (git fetch --tags) or pass --from <tag>`,
      );
    }
  };
  return snapshotFrom(
    JSON.parse(await show(VERSIONS)) as unknown,
    JSON.parse(await show(COMPONENTS)) as unknown,
    await toJson(runner, await show(CONTRACT)),
  );
}

async function workingSnapshot(
  runner: Runner,
  root: string,
): Promise<Snapshot> {
  const read = (path: string): Promise<string> =>
    readFile(join(root, path), "utf8");
  return snapshotFrom(
    JSON.parse(await read(VERSIONS)) as unknown,
    JSON.parse(await read(COMPONENTS)) as unknown,
    await toJson(runner, await read(CONTRACT)),
  );
}

function versionProblems(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const [name, version] of Object.entries(after.components)) {
    const old = before.components[name];
    if (old !== undefined && compare(version, old) < 0) {
      problems.push(
        `${name}: ${version} is older than the supported ${old}; upgrades only move forward`,
      );
    }
  }
  const [from, to] = [parts(before.kubernetes), parts(after.kubernetes)];
  if ((to[0] ?? 0) === (from[0] ?? 0) && (to[1] ?? 0) - (from[1] ?? 0) > 1) {
    problems.push(
      `kubernetes: ${before.kubernetes} to ${after.kubernetes} skips a minor version; upgrade one minor at a time`,
    );
  }
  if (compare(after.kubernetes, before.kubernetes) < 0) {
    problems.push(
      `kubernetes: ${after.kubernetes} is older than the supported ${before.kubernetes}`,
    );
  }
  return problems;
}

function crdProblems(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const [name, crds] of Object.entries(before.owns ?? {})) {
    if (crds.length === 0) {
      continue;
    }
    if (!(name in (after.owns ?? {}))) {
      problems.push(
        `${name}: removed while it owns CRDs ${crds.join(", ")}; removing a CRD deletes its custom resources`,
      );
      continue;
    }
    for (const crd of crds.filter((c) => !after.owns![name]!.includes(c))) {
      problems.push(
        `${name}: no longer owns CRD ${crd}; hand it to another owner first`,
      );
    }
  }
  return problems;
}

function versionsOf(xrd: unknown): Map<string, unknown> {
  const versions = record(record(xrd).spec).versions;
  return new Map(
    (Array.isArray(versions) ? versions : []).map((entry) => [
      String(record(entry).name),
      record(record(record(entry).schema)).openAPIV3Schema,
    ]),
  );
}

function contractProblems(before: Snapshot, after: Snapshot): string[] {
  const next = versionsOf(after.xrd);
  const problems: string[] = [];
  for (const [name, schema] of versionsOf(before.xrd)) {
    if (!next.has(name)) {
      problems.push(
        `application contract ${CONTRACT_NAME}: version ${name} was removed; applications still claim it`,
      );
      continue;
    }
    problems.push(
      ...schemaProblems(schema, next.get(name)).map(
        (problem) =>
          `application contract ${CONTRACT_NAME} ${name}: ${problem}`,
      ),
    );
  }
  return problems;
}

/** Everything wrong with upgrading from `before` to `after`; empty means supported. */
export function upgradeProblems(before: Snapshot, after: Snapshot): string[] {
  return [
    ...versionProblems(before, after),
    ...crdProblems(before, after),
    ...contractProblems(before, after),
  ];
}

function changesBetween(before: Snapshot, after: Snapshot): VersionChange[] {
  const old: Record<string, string> = {
    ...before.components,
    kubernetes: before.kubernetes,
  };
  const next: Record<string, string> = {
    ...after.components,
    kubernetes: after.kubernetes,
  };
  return [...new Set([...Object.keys(old), ...Object.keys(next)])]
    .sort()
    .filter((name) => old[name] !== next[name])
    .map((name) => ({ name, from: old[name], to: next[name] }));
}

/**
 * Compares the catalog at release tag `from` with the working tree. Read-only:
 * it only runs `git show` and `yq`.
 */
export async function upgradeCheck(
  runner: Runner,
  root: string,
  from: string,
): Promise<UpgradeResult> {
  const before = await snapshotAt(runner, root, from);
  const after = await workingSnapshot(runner, root);
  return {
    from,
    changes: changesBetween(before, after),
    problems: upgradeProblems(before, after),
  };
}

/** The newest `v*` release tag, which is the supported previous version. */
export async function previousRelease(
  runner: Runner,
  root: string,
): Promise<string> {
  const { stdout } = await runner.run(
    "git",
    ["tag", "--list", "v*", "--sort=-v:refname"],
    { capture: true, cwd: root },
  );
  const tag = stdout.split("\n").find((line) => line.trim() !== "");
  if (!tag) {
    throw new Error(
      "no release tag found; fetch tags (git fetch --tags) or pass --from <tag>",
    );
  }
  return tag.trim();
}
