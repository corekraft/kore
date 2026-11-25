import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  loadRepository,
  platformArgocdDeliveryFlag,
  releaseOwner,
  type Component,
  type Repository,
} from "../../src/config/index.js";
import {
  composeChartDelivery,
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";

// A chart the Argo CD Application renders must render from exactly the values
// the Application carries (helm.valuesObject, then its parameters, as
// `helm upgrade --set` would), and must render what the Helm path renders. The
// released charts are fetched by digest, so the repository's chart source
// stands in for them: the same chart, read from the working tree.

const digest = (fill: string) => `sha256:${fill.repeat(64)}`;

interface Application {
  namespace: string;
  values: Record<string, unknown>;
  parameters: [string, string][];
}

/** The flag profiles the render must hold under: every flag on, and every flag off but the handover itself. */
const profiles: Record<string, (flag: string) => boolean> = {
  "all flags on": () => true,
  "all flags off except platform-argocd-delivery": (flag) =>
    flag === platformArgocdDeliveryFlag,
};

function withFlags(
  repository: Repository,
  on: (flag: string) => boolean,
): Repository {
  const flags = new Set([
    ...Object.keys(repository.environment.features ?? {}),
    ...repository.catalog.components.flatMap((c) =>
      c.featureFlag === undefined ? [] : [c.featureFlag],
    ),
  ]);
  const features = Object.fromEntries(
    [...flags].map((flag) => [flag, on(flag)]),
  );
  return {
    ...repository,
    environment: { ...repository.environment, features },
    // With database-backups on, the chart needs the facts kore would hand it (ADR 0155).
    ...(features["database-backups"] === true
      ? { backupFacts: { targetKind: "interim" as const, services: {} } }
      : {}),
  };
}

/** A lock entry for every release the environment hands to Argo CD, so the composition reads each one. */
function lockFor(names: string[]) {
  return {
    version: 1,
    authorizedSigners: ["signer"],
    entries: Object.fromEntries(
      names.map((name) => [
        name,
        {
          chart: `registry.example/charts/${name}`,
          version: "0.0.0-0123456789ab",
          digest: digest("a"),
          signer: "signer",
        },
      ]),
    ),
  };
}

/** Each Application kore-config-delivery renders: its values, parameters and destination namespace. */
function applicationsOf(rendered: string): Map<string, Application> {
  const applications = new Map<string, Application>();
  for (const doc of rendered.split("\n---\n")) {
    const name = /^ {2}name: (.+)$/m.exec(doc)?.[1];
    if (name === undefined || !/^kind: Application$/m.test(doc)) {
      continue;
    }
    const valuesText = /^ {6}valuesObject: (.+)$/m.exec(doc)?.[1];
    applications.set(name.replace(/"/g, ""), {
      namespace: /^ {4}namespace: "?([^"\n]+)"?$/m.exec(doc)![1]!,
      values: valuesText === undefined ? {} : JSON.parse(valuesText),
      parameters: [
        ...doc.matchAll(/- name: "([^"]+)"\n\s+value: "([^"]*)"/g),
      ].map((match): [string, string] => [match[1] ?? "", match[2] ?? ""]),
    });
  }
  return applications;
}

async function renderedBy(
  repository: Repository,
  component: Component,
  args: string[],
): Promise<string> {
  const { stdout } = await promisify(execFile)(
    "helm",
    withAbsoluteChart(repository, component, args),
  );
  return stdout;
}

for (const [profile, on] of Object.entries(profiles)) {
  const flagged = withFlags(await loadRepository("local"), on);
  const handedOver = enabledComponents(flagged).filter(
    (c) => releaseOwner(flagged.environment, c) === "argocd",
  );
  const localCharts = handedOver.filter((c) => c.kind === "local-chart");

  const directory = await mkdtemp(join(tmpdir(), "argocd-render-"));
  const lockPath = join(directory, "platform-charts.lock.json");
  await writeFile(
    lockPath,
    JSON.stringify(lockFor(handedOver.map((c) => c.name))),
  );
  const repository = await composeChartDelivery(
    { ...flagged, chartDelivery: undefined },
    lockPath,
  );
  const delivery = repository.catalog.components.find(
    (c) => c.name === "kore-config-delivery",
  )!;
  const applications = applicationsOf(
    await renderedBy(
      repository,
      delivery,
      helmTemplateArgs(repository, delivery),
    ),
  );

  for (const component of localCharts) {
    const application = applications.get(component.name);
    if (application === undefined) {
      throw new Error(
        `kore-config-delivery renders no Application for ${component.name}`,
      );
    }

    test(`${component.name} renders from the values its Argo CD Application carries, with ${profile}, so Argo CD does not fail the release on a template error`, async () => {
      const valuesFile = join(directory, `${component.name}.values.json`);
      await writeFile(valuesFile, JSON.stringify(application.values));
      await renderedBy(repository, component, [
        "template",
        component.name,
        component.chart!,
        "--namespace",
        application.namespace,
        "--include-crds",
        "--values",
        valuesFile,
        ...application.parameters.flatMap(([key, value]) => [
          "--set",
          `${key}=${value}`,
        ]),
      ]);
    });

    test(`${component.name} renders under Argo CD exactly as it renders on the Helm path, with ${profile}, so the handover changes nothing it deploys`, async () => {
      const valuesFile = join(directory, `${component.name}.values.json`);
      await writeFile(valuesFile, JSON.stringify(application.values));
      const viaArgocd = await renderedBy(repository, component, [
        "template",
        component.name,
        component.chart!,
        "--namespace",
        application.namespace,
        "--include-crds",
        "--values",
        valuesFile,
        ...application.parameters.flatMap(([key, value]) => [
          "--set",
          `${key}=${value}`,
        ]),
      ]);
      const viaHelm = await renderedBy(
        repository,
        component,
        helmTemplateArgs(repository, component),
      );
      assert.equal(viaArgocd, viaHelm);
    });
  }
}
