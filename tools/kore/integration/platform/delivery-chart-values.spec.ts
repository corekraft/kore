import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "vitest";
import {
  gatewayClassName,
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../../src/config/index.js";
import {
  composeChartDelivery,
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";
import {
  argocdOwned,
  renderDelivery,
} from "../platform-config-delivery-project-support.js";
import { localPlatform } from "../local-platform-support.js";
import {
  deliveredApplications,
  matrixFlags,
  renderDelivered,
  unadmitted,
  withOnly,
} from "./delivery-matrix-support.js";
import {
  generatedPorts,
  merge,
  overlayPorts,
} from "./gateway-service-ports-support.js";

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

// The flag matrix: with each of the flags that gate a delivered release on, and
// with all of them off, the repository's charts are rendered as Argo CD renders
// them. A live run found five faults a render shows; each case here fails on
// the fault it would have found (#1340, #1343, #1345, #1346, #1347).
const matrix: [string, string | undefined][] = [
  ["every flag off", undefined],
  ...matrixFlags.map((flag): [string, string] => [`${flag} on`, flag]),
];

for (const [label, flag] of matrix) {
  describe(`with ${label}`, () => {
    test("the delivery chart's schema accepts every component the flag enables, and delivers exactly those", async () => {
      const repository = await withOnly(flag);
      const { applications } = await renderDelivery(repository);
      assert.deepEqual(
        [...applications].sort(),
        [...argocdOwned(repository)].sort(),
      );
    }, 120_000);

    test("every kind and namespace a delivered release renders is admitted by the AppProject", async () => {
      assert.deepEqual(await unadmitted(await withOnly(flag)), []);
    }, 120_000);

    test("each delivered release renders from the Application's own values, and the derived values reach the releases that require them", async () => {
      const repository = await withOnly(flag);
      const { docs } = await renderDelivery(repository);
      const applications = deliveredApplications(docs);
      const parameters = (name: string) =>
        applications.find((a) => a.name === name)!.parameters;
      assert.deepEqual(parameters("kore-platform-config"), {
        "gateway.className": gatewayClassName(repository.environment),
        "gateway.hostname": platform.domain,
        "gateway.platformHostname": `*.platform.${platform.domain}`,
      });
      assert.deepEqual(parameters("kore-local-tls"), {
        "gateway.hostname": platform.domain,
      });
      // A chart's required value that the Application leaves out fails here.
      for (const application of applications) {
        await renderDelivered(repository, application);
      }
    }, 120_000);

    test("every port of the Service the Gateway publishes is named once merged with the controller's own ports", async () => {
      const repository = await withOnly(flag);
      const { docs } = await renderDelivery(repository);
      const application = deliveredApplications(docs).find(
        (a) => a.name === "kore-platform-config",
      )!;
      const { text } = await renderDelivered(repository, application);
      const merged = merge(
        generatedPorts(
          application.parameters["gateway.className"]!,
          repository.environment.gateway.port,
        ),
        overlayPorts(text),
      );
      assert.deepEqual(
        merged.filter((p) => !p.name),
        [],
        "a Service with more than one port names each",
      );
    }, 120_000);
  });
}
