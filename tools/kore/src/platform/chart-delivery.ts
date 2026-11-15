import { readFile } from "node:fs/promises";
import {
  chartDeliveryValues,
  configDeliveryRelease,
  helmInstalledComponents,
  type Repository,
} from "../config/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

/**
 * Composes the kore-config-delivery chart's values from the release's chart
 * lock and the catalog, so a bad lock fails before `platform up` touches a
 * cluster. Only while the release is installed (the flag is on); otherwise the
 * repository is returned untouched and no file is read.
 */
export async function composeChartDelivery(
  repository: Repository,
  lockPath: string | undefined,
): Promise<Repository> {
  if (
    !helmInstalledComponents(repository, false).some(
      (component) => component.name === configDeliveryRelease,
    )
  ) {
    return repository;
  }
  if (lockPath === undefined) {
    throw new Error(
      `--platform-chart-lock <file> is required while platform-argocd-delivery is on in ${repository.environment.name}; pass the platform-charts.lock.json attached to the release`,
    );
  }
  let lock: unknown;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    throw new Error(
      `--platform-chart-lock ${lockPath} must be the platform-charts.lock.json of a release: ${String(error)}`,
    );
  }
  return {
    ...repository,
    chartDelivery: chartDeliveryValues(repository, lock),
  };
}
