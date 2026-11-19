import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../../src/config/index.js";
import {
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";

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
  platformDomain: "kore.local",
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
  ingress: { platformDomain: "kore.local", gatewayClassName: "istio" },
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
