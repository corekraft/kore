import { readFile } from "node:fs/promises";
import {
  absolute,
  chartDeliveryValues,
  componentValues,
  configDeliveryRelease,
  helmInstalledComponents,
  type Component,
  type Repository,
} from "../config/index.js";
import { featureFreeCharts } from "./feature-free-charts.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

/**
 * The text of the values a delivered release takes on the Helm path, in that
 * order: its values files, then the environment's feature flags for a local
 * chart as one JSON document. Kore never parses the files, since the delivery
 * chart's Helm render does and merges them as `--values` would; they are
 * repository files, so none holds a secret.
 */
async function valuesTexts(
  repository: Repository,
  component: Component,
): Promise<string[]> {
  const texts: string[] = [];
  for (const file of componentValues(repository, component)) {
    const path = absolute(repository, file);
    try {
      texts.push(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error(
        `${component.name} values file ${path} is unreadable: ${String(error)}; restore the file named in ${repository.environment.name}'s componentValues`,
      );
    }
  }
  const features = repository.environment.features ?? {};
  if (
    component.kind === "local-chart" &&
    !featureFreeCharts.has(component.name) &&
    Object.keys(features).length > 0
  ) {
    texts.push(JSON.stringify({ features }));
  }
  return texts;
}

/** Each delivered release's values-file texts, leaving out a release that takes none. */
async function releaseValues(
  repository: Repository,
  releases: string[],
): Promise<Record<string, string[]>> {
  const values: Record<string, string[]> = {};
  for (const component of repository.catalog.components) {
    if (!releases.includes(component.name)) {
      continue;
    }
    const texts = await valuesTexts(repository, component);
    if (texts.length > 0) {
      values[component.name] = texts;
    }
  }
  return values;
}

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
  const delivery = chartDeliveryValues(repository, lock);
  return {
    ...repository,
    chartDelivery: {
      ...delivery,
      releaseValues: await releaseValues(
        repository,
        Object.keys(delivery.charts),
      ),
    },
  };
}
