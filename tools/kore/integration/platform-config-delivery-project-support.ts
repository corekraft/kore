import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  databaseRoutesDeliveryArgs,
  enabledComponents,
  findRoot,
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../src/config/index.js";
import { composeChartDelivery } from "../src/platform/index.js";

const run = promisify(execFile);

/** The local repository with every flag the catalog gates a component on set to `on`, Argo CD delivery staying on. */
export async function withFlags(on: boolean): Promise<Repository> {
  const repository = await loadRepository("local");
  const flags = new Set([
    ...Object.keys(repository.environment.features ?? {}),
    ...repository.catalog.components.flatMap((c) =>
      c.featureFlag === undefined ? [] : [c.featureFlag],
    ),
  ]);
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...Object.fromEntries([...flags].map((flag) => [flag, on])),
        [platformArgocdDeliveryFlag]: true,
      },
    },
    // With every flag on, database-backups is on, so the chart needs the facts kore would hand it (ADR 0155).
    ...(on
      ? { backupFacts: { targetKind: "interim" as const, services: {} } }
      : {}),
  };
}

/** The repository with the delivery values `kore` composes from a lock covering every argocd-owned component. */
export async function composed(repository: Repository): Promise<Repository> {
  const digest = `sha256:${"a".repeat(64)}`;
  const dir = await mkdtemp(join(tmpdir(), "kore-delivery-schema-"));
  const lockPath = join(dir, "platform-charts.lock.json");
  await writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      entries: Object.fromEntries(
        argocdOwned(repository).map((name) => [
          name,
          { chart: `registry.example.com/charts/${name}`, digest },
        ]),
      ),
    }),
  );
  return composeChartDelivery(repository, lockPath);
}

/** The names of the enabled components Argo CD owns. */
export const argocdOwned = (repository: Repository): string[] =>
  enabledComponents(repository)
    .filter((c) => c.owner === "argocd")
    .map((c) => c.name);

/** Renders the delivery chart with the values `kore` composes, plus any extra Helm arguments, so Helm checks them against the chart's schema. */
export async function renderDelivery(
  repository: Repository,
  extra: string[] = [],
): Promise<{
  handedOver: string[];
  applications: string[];
  docs: string[];
}> {
  const { chartDelivery } = await composed(repository);
  assert.ok(chartDelivery);
  const { stdout } = await run("helm", [
    "template",
    "kore-config-delivery",
    join(await findRoot(), "infra/charts/platform-config-delivery"),
    "--set-json",
    `charts=${JSON.stringify(chartDelivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(chartDelivery.namespaces)}`,
    "--set-string",
    `gatewayClassName=${chartDelivery.gatewayClassName}`,
    "--set-string",
    `platformDomain=${chartDelivery.platformDomain}`,
    "--set-string",
    `platformHostname=${chartDelivery.platformHostname}`,
    "--set-json",
    `releaseValues=${JSON.stringify(chartDelivery.releaseValues)}`,
    ...databaseRoutesDeliveryArgs(chartDelivery),
    ...(chartDelivery.inClusterCa === true
      ? ["--set", "inClusterCa=true"]
      : []),
    ...(chartDelivery.workloadDefaults === true
      ? ["--set", "workloadDefaults=true"]
      : []),
    ...(chartDelivery.pvcOwnership === true
      ? ["--set", "pvcOwnership=true"]
      : []),
    ...(chartDelivery.syncWindow === true ? ["--set", "syncWindow=true"] : []),
    ...(chartDelivery.serviceClassInstances === true
      ? ["--set", "serviceClassInstances=true"]
      : []),
    ...(chartDelivery.databaseRoleSplit === true
      ? ["--set", "databaseRoleSplit=true"]
      : []),
    ...extra,
  ]);
  return {
    handedOver: argocdOwned(repository),
    docs: stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc)),
    applications: [
      ...stdout.matchAll(
        /^kind: Application\n {0}metadata:\n {2}name: (.+)$/gm,
      ),
    ].map((m) => m[1]!),
  };
}

/** The lines of one top-level field of the rendered AppProject spec, up to the next field. */
function section(project: string, field: string, next: string): string {
  const start = project.indexOf(`\n  ${field}:`);
  const end = project.indexOf(`\n  ${next}:`, start);
  assert.ok(start >= 0 && end > start, `${field} sits before ${next}`);
  return project.slice(start, end);
}

/** What the AppProject lets an Application in it apply, read from its own whitelist and destinations. */
export function admitted(project: string) {
  const whitelist = section(project, "clusterResourceWhitelist", "roles");
  const destinations = section(
    project,
    "destinations",
    "clusterResourceWhitelist",
  );
  return {
    whitelist,
    clusterKinds: [...whitelist.matchAll(/- group: (.*)\n\s+kind: (\S+)/g)].map(
      (m) => `${m[1]!.replaceAll('"', "")}/${m[2]!}`,
    ),
    destinations: [...destinations.matchAll(/ namespace: "(.+)"/g)].map(
      (m) => m[1]!,
    ),
  };
}

export const appProject = (docs: string[]) =>
  docs.find((d) => /^kind: AppProject$/m.test(d))!;
