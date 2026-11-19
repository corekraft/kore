import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configDeliveryRelease,
  enabledComponents,
  helmInstalledComponents,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (immutable, content-addressed charts)

const prefix = "platform chart lock:";
const script = ".github/scripts/package-platform-charts.sh";

/** One handed-over release: the version this checkout packages to, and the lock's. */
export interface ChartLockRow {
  name: string;
  repository: string;
  lock: string;
  drift: boolean;
}

/** The versions the lock records, by release; a lock that is not a release lock is refused. */
async function lockVersions(
  lockPath: string,
): Promise<Record<string, { version?: unknown } | undefined>> {
  let lock: { entries?: unknown } | null;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8")) as typeof lock;
  } catch (error) {
    throw new Error(
      `${prefix} ${lockPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}; pass the platform-charts.lock.json attached to the release`,
    );
  }
  if (
    lock === null ||
    typeof lock.entries !== "object" ||
    lock.entries === null
  ) {
    throw new Error(
      `${prefix} ${lockPath} must be {version: 1, entries: {<release>: {chart, digest, version}}}; pass the platform-charts.lock.json attached to the release`,
    );
  }
  return lock.entries as Record<string, { version?: unknown } | undefined>;
}

/** The version each chart packages to from this checkout, offline, pushing nothing. */
async function checkoutVersions(
  repository: Repository,
  runner: Runner,
  lockPath: string,
): Promise<Map<string, string>> {
  const scratch = await mkdtemp(join(tmpdir(), "kore-chart-lock-"));
  try {
    let stdout: string;
    try {
      ({ stdout } = await runner.run(join(repository.root, script), [scratch], {
        cwd: repository.root,
        capture: true,
      }));
    } catch (error) {
      throw new Error(
        `${prefix} packaging this checkout's charts to compare them with ${lockPath} failed: ${error instanceof Error ? error.message : String(error)}; install the pinned tools (mise install) and rerun`,
      );
    }
    return new Map(
      stdout
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const chart = JSON.parse(line) as { name: string; version: string };
          return [chart.name, chart.version];
        }),
    );
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/**
 * Compares, for each release the environment hands to Argo CD (the image policy
 * and a release whose flag is off are not among them), the version this
 * checkout packages to with the lock's. The versions are content-addressed, so
 * a difference means the lock names a chart that lacks the repository's change.
 * Fails closed, naming the release, when one is missing from the lock or from
 * the packaging, since a skipped release would pass unchecked.
 */
export async function chartLockDrift(
  repository: Repository,
  runner: Runner,
  lockPath: string,
): Promise<ChartLockRow[]> {
  const entries = await lockVersions(lockPath);
  const checkout = await checkoutVersions(repository, runner, lockPath);
  return enabledComponents(repository)
    .filter((component) => component.owner === "argocd")
    .map(({ name }) => {
      const current = checkout.get(name);
      if (current === undefined) {
        throw new Error(
          `${prefix} ${name} is handed over to Argo CD but ${script} did not package it, so its version cannot be compared; add it to the script's chart list`,
        );
      }
      const entry = entries[name];
      if (entry === undefined) {
        throw new Error(
          `${prefix} ${lockPath} has no entry for ${name}, which is handed over to Argo CD; pass the platform-charts.lock.json of a release that published it`,
        );
      }
      if (typeof entry.version !== "string") {
        throw new Error(
          `${prefix} ${lockPath} has no version for ${name}, so it cannot be compared with this checkout; republish the release`,
        );
      }
      return {
        name,
        repository: current,
        lock: entry.version,
        drift: entry.version !== current,
      };
    });
}

/** What `local up` compares: nothing unless the delivery release is installed and a lock is given. */
export async function upChartLockDrift(
  repository: Repository,
  runner: Runner,
  lockPath: string | undefined,
): Promise<ChartLockRow[]> {
  if (
    lockPath === undefined ||
    !helmInstalledComponents(repository, false).some(
      (component) => component.name === configDeliveryRelease,
    )
  ) {
    return [];
  }
  return await chartLockDrift(repository, runner, lockPath);
}

/** One line per drifted release, each naming both versions, what the run would test, and the fix. */
export function chartLockDriftMessage(
  rows: readonly ChartLockRow[],
  lockPath: string,
): string {
  return rows
    .filter((row) => row.drift)
    .map(
      (row) =>
        `${prefix} ${row.name} is ${row.lock} in ${lockPath} but ${row.repository} in this checkout; the published chart differs from the repository; this run would test the published chart, not the repository's. Pass the platform-charts.lock.json of a release that contains the change, or rebuild the lock with ${script}`,
    )
    .join("\n");
}
