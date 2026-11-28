import { dirname, isAbsolute, join, resolve } from "node:path";
import { exists } from "./files.js";
import {
  loadBackupFacts,
  loadFlagManifest,
  loadImageTrustValues,
  loadJSON,
  loadK3sHostPin,
  loadRegistryComponentValues,
  loadSopsRecipients,
  loadSuborgNames,
} from "./overlay-files.js";
import { loadServiceRegistrations } from "./service-registrations.js";
import { validateRepository } from "./validate.js";
import { ExemptionCheck } from "./exemption-check.js";
import { FileExemptionSource } from "./exemption-source.js";
import type {
  Catalog,
  Component,
  Environment,
  ReadinessManifest,
  Repository,
  SeedManifest,
  ApprovedImageManifest,
  Versions,
} from "./types.js";

export type {
  ApprovedImage,
  ApprovedImageManifest,
  BackupFacts,
  Catalog,
  Component,
  ComponentKind,
  Environment,
  FlagEntry,
  FlagKind,
  FlagManifest,
  K3dCluster,
  Phase,
  ProbePatch,
  ReadinessCapability,
  ReadinessManifest,
  ReadinessRequirement,
  Repository,
  Seed,
  SeedEvidence,
  SeedManifest,
  Versions,
} from "./types.js";
export { orderedComponents } from "./order.js";
export { exemptionCheckMode, validateRepository } from "./validate.js";

export async function findRoot(start = process.cwd()): Promise<string> {
  if (process.env.KORE_ROOT) {
    return resolve(process.env.KORE_ROOT);
  }
  let candidate = resolve(start);
  while (true) {
    if (await exists(join(candidate, "infra/catalog/components.yaml"))) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        "not inside a Kore repository (set KORE_ROOT to override)",
      );
    }
    candidate = parent;
  }
}

export async function loadRepository(
  environmentName = "local",
  start?: string,
): Promise<Repository> {
  const root = await findRoot(start);
  const [versions, seeds, readiness, approved, catalog, flags, environment] =
    await Promise.all([
      loadJSON<Versions>(join(root, "infra/catalog/versions.yaml")),
      loadJSON<SeedManifest>(join(root, "infra/catalog/seeds.yaml")),
      loadJSON<ReadinessManifest>(join(root, "infra/catalog/readiness.yaml")),
      loadJSON<ApprovedImageManifest>(
        join(root, "infra/catalog/approved-images.yaml"),
      ),
      loadJSON<Catalog>(join(root, "infra/catalog/components.yaml")),
      loadFlagManifest(root),
      loadJSON<Environment>(
        join(root, "infra/environments", environmentName, "environment.yaml"),
      ),
    ]);
  const imageTrustValues = await loadImageTrustValues(root, environment);
  const repository = {
    root,
    versions,
    seeds,
    readiness,
    approved,
    catalog,
    flags,
    environment,
    imageTrustValues,
    k3sHostPin: await loadK3sHostPin(root, environment.name),
    registryComponentValues: await loadRegistryComponentValues(
      root,
      environment,
    ),
    registeredServices: await loadServiceRegistrations(root, environmentName),
    backupFacts: await loadBackupFacts(root, environment),
    sopsRecipients: await loadSopsRecipients(root, environmentName),
    suborgs: await loadSuborgNames(
      root,
      environment,
      catalog.components.map((component) => component.namespace),
    ),
  };
  const exemptions = new ExemptionCheck(new FileExemptionSource(root));
  const warnings = await validateRepository(repository, [], (repo) =>
    exemptions.findings(repo.catalog.components ?? []),
  );
  return { ...repository, warnings };
}

export function componentVersion(
  repository: Repository,
  component: Component,
): string | undefined {
  if (component.version === "local") {
    return undefined;
  }
  return repository.versions.components[component.version]?.replace(/^v/, "");
}

export function expandVersions(repository: Repository, value: string): string {
  return Object.entries(repository.versions.components).reduce(
    (result, [key, version]) =>
      result.replaceAll(`\${${key}}`, version.replace(/^v/, "")),
    value,
  );
}

export function absolute(repository: Repository, path: string): string {
  return isAbsolute(path) ? path : join(repository.root, path);
}
