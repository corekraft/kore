import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { assertExpectedCluster } from "./cluster.js";
import {
  DATABASE,
  RETAIN_SELECTOR,
  execArgs,
  retainedClusters,
  type RetainedCluster,
} from "./export-cluster.js";
import {
  MANIFEST_SUFFIX,
  exportDirectory,
  sha256,
  type ExportManifest,
} from "./export-manifest.js";
import { exportRecipient } from "./export-recipient.js";

export interface ExportOptions {
  namespace: string;
  now?: () => Date;
}

export interface ExportEntry {
  artifact: string;
  manifest: string;
  sha256: string;
  cluster: string;
}

/** Retained claims that are not CloudNativePG data volumes, which pg_dump cannot cover. */
async function uncoveredVolumes(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<string[]> {
  const result = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      namespace,
      "get",
      "pvc",
      "--selector",
      `${RETAIN_SELECTOR},!cnpg.io/cluster`,
      "-o",
      "name",
    ],
    { capture: true },
  );
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

interface ExportWrite {
  directory: string;
  createdAt: string;
  stamp: string;
  namespace: string;
  cluster: string;
  recipient: string;
  ciphertext: string;
}

/** Writes the ciphertext, then the manifest; a failed manifest removes the artifact. */
async function writeExport(
  repository: Repository,
  write: ExportWrite,
): Promise<ExportEntry> {
  const artifact = `${write.cluster}-${write.stamp}.sql.age`;
  const manifestName = `${artifact}${MANIFEST_SUFFIX}`;
  const manifest: ExportManifest = {
    version: 1,
    environment: repository.environment.name,
    createdAt: write.createdAt,
    recipient: write.recipient,
    contents: {
      kind: "cnpg-database",
      namespace: write.namespace,
      cluster: write.cluster,
      database: DATABASE,
      format: "pg_dump-plain",
    },
    artifact: {
      file: artifact,
      sha256: sha256(write.ciphertext),
      bytes: Buffer.byteLength(write.ciphertext),
    },
  };
  await writeFile(join(write.directory, artifact), write.ciphertext, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    await writeFile(
      join(write.directory, manifestName),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    await rm(join(write.directory, artifact), { force: true });
    throw error;
  }
  return {
    artifact,
    manifest: manifestName,
    sha256: manifest.artifact.sha256,
    cluster: write.cluster,
  };
}

/** Retained clusters that can be dumped now; throws when any export would be partial. */
async function exportableClusters(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<RetainedCluster[]> {
  const clusters = await retainedClusters(repository, runner, namespace);
  if (!clusters.length) {
    throw new Error(
      `no retained CloudNativePG cluster found in namespace ${namespace}; nothing to export`,
    );
  }
  const uncovered = await uncoveredVolumes(repository, runner, namespace);
  if (uncovered.length) {
    throw new Error(
      `retained volumes outside a CloudNativePG cluster cannot be exported yet:\n${uncovered.join("\n")}\nMove their data into the database or destroy them deliberately with --purge-data`,
    );
  }
  for (const cluster of clusters) {
    if (!cluster.primary) {
      throw new Error(
        `cluster ${cluster.name} has no primary yet; wait until it is ready, then export`,
      );
    }
  }
  return clusters;
}

/**
 * Dumps each retained CloudNativePG database with pg_dump in the primary and
 * encrypts the stream with age. Plaintext only ever exists in process memory
 * and the pipes between processes.
 */
export async function exportRetainedData(
  repository: Repository,
  runner: Runner,
  options: ExportOptions,
): Promise<{ exports: ExportEntry[] }> {
  // Fail on configuration before any cluster contact.
  const recipient = await exportRecipient(repository);
  await assertExpectedCluster(repository, runner);
  const { namespace } = options;
  const clusters = await exportableClusters(repository, runner, namespace);
  const directory = exportDirectory(repository);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const stamp = createdAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  const exports: ExportEntry[] = [];
  for (const cluster of clusters) {
    const dump = await runner.run(
      "kubectl",
      execArgs(repository, namespace, cluster.primary, { stdin: false }, [
        "pg_dump",
        `--dbname=${DATABASE}`,
        "--format=plain",
      ]),
      { capture: true },
    );
    const encrypted = await runner.run(
      "age",
      ["--armor", "--recipient", recipient],
      { capture: true, input: dump.stdout },
    );
    exports.push(
      await writeExport(repository, {
        directory,
        createdAt,
        stamp,
        namespace,
        cluster: cluster.name,
        recipient,
        ciphertext: encrypted.stdout,
      }),
    );
  }
  return { exports };
}
