import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../../src/config/index.js";
import { composeChartDelivery } from "../../src/platform/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

const run = promisify(execFile);
const digest = `sha256:${"a".repeat(64)}`;

/** The local repository with every flag the catalog gates a component on set to `on`, Argo CD delivery staying on. */
async function withFlags(on: boolean): Promise<Repository> {
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

/** Renders the delivery chart with the values `kore` composes, so Helm checks them against the chart's schema. */
async function renderDelivery(repository: Repository): Promise<{
  handedOver: string[];
  applications: string[];
}> {
  const handedOver = enabledComponents(repository)
    .filter((c) => c.owner === "argocd")
    .map((c) => c.name);
  const dir = await mkdtemp(join(tmpdir(), "kore-delivery-schema-"));
  const lockPath = join(dir, "platform-charts.lock.json");
  await writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      entries: Object.fromEntries(
        handedOver.map((name) => [
          name,
          { chart: `registry.example.com/charts/${name}`, digest },
        ]),
      ),
    }),
  );
  const { chartDelivery } = await composeChartDelivery(repository, lockPath);
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
    "--set-json",
    `releaseValues=${JSON.stringify(chartDelivery.releaseValues)}`,
  ]);
  return {
    handedOver,
    applications: [
      ...stdout.matchAll(
        /^kind: Application\n {0}metadata:\n {2}name: (.+)$/gm,
      ),
    ].map((m) => m[1]!),
  };
}

test("the delivery chart schema accepts a release for every argocd-owned catalog component when every flag is on", async () => {
  const { handedOver, applications } = await renderDelivery(
    await withFlags(true),
  );
  for (const gated of [
    "kore-policy-sync",
    "kore-hostname-ownership-templates",
    "kore-hostname-ownership",
  ]) {
    assert.ok(handedOver.includes(gated), `${gated} is handed to Argo CD`);
  }
  assert.deepEqual([...applications].sort(), [...handedOver].sort());
}, 60_000);

test("the delivery chart schema accepts the handover and creates no Application for a gated component when every flag is off", async () => {
  const { handedOver, applications } = await renderDelivery(
    await withFlags(false),
  );
  assert.equal(handedOver.includes("kore-hostname-ownership"), false);
  assert.deepEqual([...applications].sort(), [...handedOver].sort());
  assert.equal(
    applications.some((name) => name.startsWith("kore-hostname-ownership")),
    false,
  );
}, 60_000);
