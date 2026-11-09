import { join } from "node:path";
import type { Component } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { Crd } from "./crd-compat.js";

type ChartComponent = Pick<
  Component,
  "name" | "kind" | "namespace" | "repository" | "chart" | "values"
>;

/** Remote Helm charts; a local chart changes with the repository, so git diff covers it. */
export function helmChartComponents<T extends ChartComponent>(
  components: T[],
): T[] {
  return components.filter((component) => component.kind === "helm");
}

function templateArgs(
  root: string,
  component: ChartComponent,
  version: string,
): string[] {
  const oci = component.repository?.startsWith("oci://") === true;
  return [
    "template",
    component.name,
    oci ? component.repository! : component.chart!,
    "--namespace",
    component.namespace,
    "--include-crds",
    ...(oci || !component.repository ? [] : ["--repo", component.repository]),
    "--version",
    version,
    ...(component.values ?? []).flatMap((values) => [
      "--values",
      join(root, values),
    ]),
  ];
}

/**
 * The CRDs a chart renders at `version`. Read-only: `helm template` renders
 * locally and `yq` converts, so no cluster is contacted.
 */
export async function chartCrds(
  runner: Runner,
  root: string,
  component: ChartComponent,
  version: string,
): Promise<Crd[]> {
  const rendered = await runner.run(
    "helm",
    templateArgs(root, component, version),
    { capture: true, cwd: root },
  );
  const crds = await runner.run(
    "yq",
    [
      "eval-all",
      "--output-format=json",
      "--indent=0",
      'select(.kind == "CustomResourceDefinition")',
    ],
    { capture: true, input: rendered.stdout },
  );
  return crds.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Crd);
}
