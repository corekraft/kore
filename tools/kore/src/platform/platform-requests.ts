// The platform's own pod requests, summed from the releases the catalog renders (#1596). The sum
// is the platformRequests input of capacityFit, which subtracts it from allocatable before the
// committed share is taken (config/capacity-fit.ts). Read-only: it renders charts and reads no
// cluster. A release it cannot render offline, or a pod it cannot size, is named as missing, so
// the budget is never judged on a guess.
// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md

import {
  type Amount,
  type Component,
  cpuMillis,
  memoryMiB,
  type PlatformRequests,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  withAbsoluteChart,
} from "./helm.js";

type Json = Record<string, unknown>;

/** Renders one catalog component to its parsed manifests. Injected, so unit tests mock the render. */
export type RenderComponent = (component: Component) => Promise<unknown[]>;

const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(obj) : [];

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const count = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

/**
 * The pods a manifest runs, with the pod spec each one carries. A DaemonSet runs one pod per node;
 * a Job runs its parallelism; a kind that holds no pods has none.
 */
function podsOf(
  manifest: Json,
  nodes: number,
): { pods: number; spec: Json } | undefined {
  const spec = obj(manifest["spec"]);
  const template = obj(obj(spec["template"])["spec"]);
  switch (manifest["kind"]) {
    case "Deployment":
    case "StatefulSet":
      return { pods: count(spec["replicas"], 1), spec: template };
    case "DaemonSet":
      return { pods: nodes, spec: template };
    case "Job":
      return { pods: count(spec["parallelism"], 1), spec: template };
    case "Pod":
      return { pods: 1, spec };
    default:
      return undefined;
  }
}

/**
 * One request of one container, in its own unit. An absent or unreadable request is named in
 * `missing` and counts as nothing, so the caller never reads a pod as sized when it is not.
 */
function quantity(
  value: unknown,
  label: "cpu" | "memory",
  read: (quantityText: string) => number | undefined,
  where: string,
  missing: string[],
): number {
  const written = text(value);
  if (written === undefined) {
    missing.push(`${where} declares no ${label} request`);
    return 0;
  }
  const amount = read(written);
  if (amount === undefined) {
    missing.push(
      `${where} declares an unreadable ${label} request "${written}"`,
    );
    return 0;
  }
  return amount;
}

/** The requests of a list of containers, summed; each one's missing request is named. */
function sumContainers(
  containers: Json[],
  owner: string,
  missing: string[],
): Amount {
  const total: Amount = { cpuMillis: 0, memoryMiB: 0 };
  for (const container of containers) {
    const where = `${owner} container ${text(container["name"]) ?? "unnamed"}`;
    const requests = obj(obj(container["resources"])["requests"]);
    total.cpuMillis += quantity(
      requests["cpu"],
      "cpu",
      cpuMillis,
      where,
      missing,
    );
    total.memoryMiB += quantity(
      requests["memory"],
      "memory",
      memoryMiB,
      where,
      missing,
    );
  }
  return total;
}

/**
 * One pod's requests. The app containers and the sidecar init containers (restartPolicy Always)
 * run together, so they add up; each regular init container runs alone before them, so only the
 * largest of those counts. A pod's requests are the larger of the two (the scheduler's rule).
 */
function onePodRequests(spec: Json, owner: string, missing: string[]): Amount {
  const initContainers = list(spec["initContainers"]);
  const sidecars = initContainers.filter(
    (c) => c["restartPolicy"] === "Always",
  );
  const regularInit = initContainers.filter(
    (c) => c["restartPolicy"] !== "Always",
  );
  const running = sumContainers(
    [...list(spec["containers"]), ...sidecars],
    owner,
    missing,
  );
  const init = regularInit.map((c) => sumContainers([c], owner, missing));
  return {
    cpuMillis: Math.max(running.cpuMillis, ...init.map((a) => a.cpuMillis)),
    memoryMiB: Math.max(running.memoryMiB, ...init.map((a) => a.memoryMiB)),
  };
}

/**
 * The summed requests of every pod the rendered manifests run, each workload counted by its
 * replicas, and every pod it cannot size named in `missing`. A kind that holds no pods adds
 * nothing. `nodes` is the environment's node count, which a DaemonSet multiplies by.
 */
export function podRequests(
  manifests: readonly unknown[],
  nodes: number,
): PlatformRequests {
  const total: Amount = { cpuMillis: 0, memoryMiB: 0 };
  const missing: string[] = [];
  for (const raw of manifests) {
    const manifest = obj(raw);
    const pods = podsOf(manifest, nodes);
    if (pods === undefined) {
      continue;
    }
    const owner = `${text(manifest["kind"])}/${text(obj(manifest["metadata"])["name"]) ?? "unnamed"}`;
    const each = onePodRequests(pods.spec, owner, missing);
    total.cpuMillis += pods.pods * each.cpuMillis;
    total.memoryMiB += pods.pods * each.memoryMiB;
  }
  return { requests: total, missing };
}

/**
 * The pod requests of the components given: the caller passes the enabled ones, so a release
 * gated off adds nothing. A chart is rendered through `render`; a manifest component is named as
 * unread, since it is a URL that cannot be rendered offline. A render that fails rejects the whole
 * sum: a partial sum would read as a full one.
 */
export async function platformRequests(
  components: readonly Component[],
  nodes: number,
  render: RenderComponent,
): Promise<PlatformRequests> {
  const unread = components
    .filter((component) => component.kind === "manifest")
    .map(
      (component) =>
        `${component.name} is a manifest the platform cannot render offline, so its pod requests are not read`,
    );
  const charts = components.filter(
    (component) => component.kind !== "manifest",
  );
  const rendered = await Promise.all(charts.map((chart) => render(chart)));
  const summed = podRequests(rendered.flat(), nodes);
  return { requests: summed.requests, missing: [...unread, ...summed.missing] };
}

/**
 * The real renderer: `helm template` on the component exactly as the platform renders it, and
 * `yq` turning each document into one JSON line. It reads the repository and contacts no cluster;
 * a remote chart is fetched by helm, so it needs the network the render needs.
 */
export function helmRenderer(
  repository: Repository,
  runner: Runner,
): RenderComponent {
  return async (component) => {
    const rendered = await runner.run(
      "helm",
      withAbsoluteChart(
        repository,
        component,
        helmTemplateArgs(repository, component),
      ),
      {
        capture: true,
        cwd: repository.root,
        ...envOption(helmEnv(repository, component)),
      },
    );
    const converted = await runner.run("yq", ["-o=json", "-I=0", "."], {
      capture: true,
      input: rendered.stdout,
    });
    return converted.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as unknown);
  };
}
