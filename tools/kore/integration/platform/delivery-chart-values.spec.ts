import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "vitest";
import {
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../../src/config/index.js";
import {
  composeChartDelivery,
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";
import { localPlatform } from "../local-platform-support.js";
import {
  schemaProblems,
  unadmitted,
  valueProblems,
} from "./delivery-matrix-checks-support.js";
import { portProblems } from "./delivery-matrix-ports-support.js";
import { flagSets, repositoryFor } from "./delivery-matrix-support.js";

const platform = await localPlatform();

// The composed values the delivery releases take when the flag is on. Their
// charts' schemas are closed, so any key kore passes that the schema does not
// name is refused by Helm before a cluster is reached.

const digest = (fill: string) => `sha256:${fill.repeat(64)}`;

const handedOver = [
  "opa-authorizer",
  "kore-postgresql-api",
  "kore-policy-templates",
  "kore-policy-constraints",
  "kore-local-tls",
  "kore-platform-config",
];

const chartDelivery = {
  charts: Object.fromEntries(
    handedOver.map((name) => [
      name,
      { chart: `registry.example/charts/${name}`, digest: digest("a") },
    ]),
  ),
  namespaces: Object.fromEntries(handedOver.map((name) => [name, name])),
  gatewayClassName: "istio",
  platformDomain: platform.domain,
  platformHostname: `*.platform.${platform.domain}`,
};

const goldenPathDelivery = {
  repoURL: "https://github.com/corekraft/kore.git",
  revision: "a".repeat(40),
  environment: "local",
  templateImages: {
    "static-frontend": {
      image: "ghcr.io/corekraft/static-frontend",
      digest: digest("1"),
    },
    "kotlin-bff": {
      image: "ghcr.io/corekraft/kotlin-bff",
      digest: digest("2"),
    },
  },
  ingress: { platformDomain: platform.domain, gatewayClassName: "istio" },
};

async function localWithFlagOn(): Promise<Repository> {
  const repository = await loadRepository("local");
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: true,
      },
    },
    chartDelivery,
    goldenPathDelivery,
  };
}

for (const name of ["kore-config-delivery", "kore-golden-path-delivery"]) {
  test(`${name} renders from its chart with the flag on, so its composed values validate against the chart schema before any cluster is reached`, async () => {
    const repository = await localWithFlagOn();
    const component = repository.catalog.components.find(
      (c) => c.name === name,
    );
    if (component === undefined) {
      throw new Error(`${name} is not in the component catalog`);
    }
    // helm template validates values against values.schema.json and fails
    // with the schema error; a clean render means the values are accepted.
    await promisify(execFile)(
      "helm",
      withAbsoluteChart(
        repository,
        component,
        helmTemplateArgs(repository, component),
      ),
    );
  });
}

test("kore-config-delivery composed from the local overlay renders the platform-config Application with the overlay's gateway values, which the Helm path gives that release", async () => {
  const flagged = await localWithFlagOn();
  const directory = await mkdtemp(join(tmpdir(), "chart-lock-"));
  const lockPath = join(directory, "platform-charts.lock.json");
  await writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      entries: Object.fromEntries(
        handedOver.map((name) => [
          name,
          { chart: `registry.example/charts/${name}`, digest: digest("a") },
        ]),
      ),
    }),
  );
  const repository = await composeChartDelivery(
    { ...flagged, chartDelivery: undefined },
    lockPath,
  );
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-config-delivery",
  )!;
  const { stdout } = await promisify(execFile)(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
  );
  const application = stdout
    .split("\n---\n")
    .find((doc) => /^ {2}name: kore-platform-config$/m.test(doc))!;
  const values: {
    gateway: { port: number; service: { type: string; nodePort: number } };
    features: Record<string, boolean>;
  } = JSON.parse(/^ {6}valuesObject: (.+)$/m.exec(application)![1]!);
  assert.equal(values.gateway.service.type, "NodePort");
  assert.equal(values.gateway.service.nodePort, 30443);
  assert.equal(values.gateway.port, platform.gatewayPort);
  assert.equal(
    values.features["platform-argocd-delivery"],
    true,
    "the feature flags reach the Application as the Helm path passes them",
  );
});

// The flag matrix: under each set of flags, the repository's charts are
// rendered as Argo CD renders them. Live runs found faults a render shows; each
// check fails on the fault it would have found (#1340 schema, #1343 AppProject
// kind, #1345 derived hostname, #1347 Gateway Service port name).
const checks: [string, typeof schemaProblems][] = [
  [
    "the delivery chart's schema accepts every enabled component",
    schemaProblems,
  ],
  [
    "every kind and namespace a delivered chart renders is admitted by the AppProject",
    unadmitted,
  ],
  [
    "every delivered chart renders from its Application's values, with the derived values non-empty",
    valueProblems,
  ],
  [
    "every Service port a Gateway or Route refers to exists and is named",
    portProblems,
  ],
];

for (const set of flagSets) {
  describe(`with ${set.label}`, () => {
    for (const [name, check] of checks) {
      test(
        name,
        async () => {
          assert.deepEqual(await check(set, await repositoryFor(set)), []);
        },
        180_000,
      );
    }
  });
}
