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

/** The version each chart packages to from this checkout, offline, pushing nothing. */
async function checkoutVersions(
  repository: Repository,
  runner: Runner,
  lockPath: string,
): Promise<Map<string, string>> {
  const scratch = await mkdtemp(join(tmpdir(), "kore-chart-lock-"));
  try {
    const { stdout } = await runner.run(
      join(repository.root, script),
      [scratch],
      { cwd: repository.root, capture: true },
    );
    return new Map(
      stdout
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const chart = JSON.parse(line) as { name: string; version: string };
          return [chart.name, chart.version];
        }),
    );
  } catch (error) {
    throw new Error(
      `${prefix} packaging this checkout's charts to compare them with ${lockPath} failed: ${error instanceof Error ? error.message : String(error)}; install the pinned tools (mise install) and rerun`,
    );
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/**
 * Fails when a chart the delivery hands over was published from different
 * content than this checkout holds. The versions are content-addressed, so a
 * differing version means the lock points at a chart that lacks the change under
 * test. Only while the delivery release is installed and a lock is given
 * (composing the delivery values names a missing lock); a chart the environment
 * does not hand over is left out. Run before any cluster work.
 */
export async function assertChartLockMatchesCheckout(
  repository: Repository,
  runner: Runner,
  lockPath: string | undefined,
): Promise<void> {
  if (
    lockPath === undefined ||
    !helmInstalledComponents(repository, false).some(
      (component) => component.name === configDeliveryRelease,
    )
  ) {
    return;
  }
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    entries?: Record<string, { version?: unknown }>;
  };
  const checkout = await checkoutVersions(repository, runner, lockPath);
  const problems: string[] = [];
  for (const { name } of enabledComponents(repository).filter(
    (component) => component.owner === "argocd",
  )) {
    const entry = lock.entries?.[name];
    const current = checkout.get(name);
    if (entry === undefined || current === undefined) {
      continue;
    }
    if (typeof entry.version !== "string") {
      problems.push(
        `${prefix} ${name} has no version in ${lockPath}, so it cannot be compared with this checkout; republish the release`,
      );
    } else if (entry.version !== current) {
      problems.push(
        `${prefix} ${name} is ${entry.version} in ${lockPath} but ${current} in this checkout; the published chart differs from the repository; the run would not test your change. Pass the platform-charts.lock.json of a release cut from this commit, or rebuild the lock with ${script}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}
