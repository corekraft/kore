import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../../src/config/index.js";
import { composeChartDelivery } from "../../src/platform/index.js";

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

/** Renders the delivery chart with the values `kore` composes, so Helm checks them against the chart's schema. */
export async function renderDelivery(repository: Repository): Promise<{
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
