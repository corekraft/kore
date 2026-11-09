import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Repository } from "../config/index.js";

export const MANIFEST_SUFFIX = ".manifest.json";

/** What an export holds, enough for a restore to find its target. */
export interface ExportContents {
  kind: "cnpg-database";
  namespace: string;
  cluster: string;
  database: string;
  format: "pg_dump-plain";
}

export interface ExportManifest {
  version: 1;
  environment: string;
  createdAt: string;
  recipient: string;
  contents: ExportContents;
  artifact: { file: string; sha256: string; bytes: number };
}

/** Exports live under the gitignored `.kore/exports/<environment>/`. */
export function exportDirectory(repository: Repository): string {
  return join(repository.root, ".kore", "exports", repository.environment.name);
}

export function sha256(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** An artifact name must be a plain file name inside the export directory. */
export function assertExportFileName(name: string): void {
  if (!name || basename(name) !== name || name.startsWith(".")) {
    throw new Error(
      `--from must be a file name inside ${join(".kore", "exports", "<environment>")}, not a path: ${name}`,
    );
  }
}

function isManifest(value: unknown): value is ExportManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const manifest = value as Partial<ExportManifest>;
  const artifact = manifest.artifact;
  const contents = manifest.contents;
  return (
    manifest.version === 1 &&
    typeof manifest.environment === "string" &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.recipient === "string" &&
    typeof artifact?.file === "string" &&
    typeof artifact.sha256 === "string" &&
    typeof artifact.bytes === "number" &&
    contents?.kind === "cnpg-database" &&
    typeof contents.namespace === "string" &&
    typeof contents.cluster === "string" &&
    typeof contents.database === "string" &&
    contents.format === "pg_dump-plain"
  );
}

/**
 * Reads a manifest and its artifact and proves they belong to this
 * environment and still match. Returns undefined when they do not.
 */
export async function verifyManifest(
  repository: Repository,
  manifestFile: string,
): Promise<{ manifest: ExportManifest; artifact: string } | undefined> {
  const directory = exportDirectory(repository);
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(directory, manifestFile), "utf8"),
    );
    if (
      !isManifest(manifest) ||
      manifest.environment !== repository.environment.name ||
      basename(manifest.artifact.file) !== manifest.artifact.file
    ) {
      return undefined;
    }
    const artifact = await readFile(join(directory, manifest.artifact.file));
    if (
      sha256(artifact) !== manifest.artifact.sha256.toLowerCase() ||
      artifact.byteLength !== manifest.artifact.bytes
    ) {
      return undefined;
    }
    return { manifest, artifact: artifact.toString("utf8") };
  } catch {
    return undefined;
  }
}

/** True when an encrypted export exists whose digest still matches its manifest. */
export async function hasVerifiedExport(
  repository: Repository,
): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(exportDirectory(repository));
  } catch {
    return false;
  }
  for (const entry of entries.filter((name) =>
    name.endsWith(MANIFEST_SUFFIX),
  )) {
    if (await verifyManifest(repository, entry)) {
      return true;
    }
  }
  return false;
}

/**
 * Creation time of the newest export whose digest still matches its manifest,
 * from manifest metadata only: nothing is decrypted. Undefined when none.
 */
export async function newestVerifiedExport(
  repository: Repository,
): Promise<Date | undefined> {
  let entries: string[];
  try {
    entries = await readdir(exportDirectory(repository));
  } catch {
    return undefined;
  }
  let newest: Date | undefined;
  for (const entry of entries.filter((name) =>
    name.endsWith(MANIFEST_SUFFIX),
  )) {
    const verified = await verifyManifest(repository, entry);
    const createdAt = verified && new Date(verified.manifest.createdAt);
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      newest = !newest || createdAt > newest ? createdAt : newest;
    }
  }
  return newest;
}
