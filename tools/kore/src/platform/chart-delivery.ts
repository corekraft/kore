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
import { isReleaseAutomationSigner } from "../images/index.js";
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

async function readLock(lockPath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    throw new Error(
      `--platform-chart-lock ${lockPath} must be the platform-charts.lock.json of a release: ${String(error)}`,
    );
  }
}

/** The signers a lock declares, or none when it declares no list. */
function declaredSigners(lock: unknown): unknown[] {
  if (
    typeof lock !== "object" ||
    lock === null ||
    !("authorizedSigners" in lock)
  ) {
    return [];
  }
  return Array.isArray(lock.authorizedSigners) ? lock.authorizedSigners : [];
}

/**
 * A managed environment takes only a lock that release automation signed at a
 * version tag, the one attached to a release. A main chart lock (ADR 0138), a
 * developer key's lock, or a lock that names no signer is refused before any
 * cluster call. This reads the signers the lock declares; it verifies no
 * signature, which the chart-signature check still to come will do (ADR 0147).
 */
function assertReleaseLock(
  lock: unknown,
  lockPath: string,
  repository: Repository,
): void {
  const signers = declaredSigners(lock);
  if (
    signers.length > 0 &&
    signers.every(
      (signer) =>
        typeof signer === "string" && isReleaseAutomationSigner(signer),
    )
  ) {
    return;
  }
  const named =
    signers.length === 0 ? "no signer" : signers.map(String).join(", ");
  throw new Error(
    `--platform-chart-lock ${lockPath} is not the release chart lock: it is signed by ${named}, and ${repository.environment.name} takes only a lock signed by release automation at a version tag (release.yaml@refs/tags/vX.Y.Z). Pass the platform-charts.lock.json attached to the release; a main chart lock serves a local proof only`,
  );
}

/**
 * Composes the kore-config-delivery chart's values from the release's chart
 * lock and the catalog, so a bad lock fails before `platform up` touches a
 * cluster. A managed environment refuses a lock the release did not sign,
 * whether or not the flag is on, since the lock is handed in for the run. The
 * composition itself happens only while the release is installed (the flag is
 * on); otherwise the repository is returned untouched and a local run reads no
 * file.
 */
export async function composeChartDelivery(
  repository: Repository,
  lockPath: string | undefined,
): Promise<Repository> {
  const delivered = helmInstalledComponents(repository, false).some(
    (component) => component.name === configDeliveryRelease,
  );
  const managed = repository.environment.provider === "managed";
  if (!delivered && (!managed || lockPath === undefined)) {
    return repository;
  }
  if (lockPath === undefined) {
    throw new Error(
      `--platform-chart-lock <file> is required while platform-argocd-delivery is on in ${repository.environment.name}; pass the platform-charts.lock.json attached to the release`,
    );
  }
  const lock = await readLock(lockPath);
  if (managed) {
    assertReleaseLock(lock, lockPath, repository);
  }
  if (!delivered) {
    return repository;
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
