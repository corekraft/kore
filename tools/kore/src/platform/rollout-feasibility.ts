// Docs: docs/decisions/0036-rollout-feasibility-and-container-smoke.md

/**
 * Offline checks that a rendered workload can roll out, and a node can drain,
 * on an environment with a fixed node count. Inputs are parsed manifests.
 */

type Json = Record<string, unknown>;

const hostnameKey = "kubernetes.io/hostname";

function obj(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

function labelsOf(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function selects(selector: unknown, labels: Record<string, string>): boolean {
  const entries = Object.entries(labelsOf(obj(selector)["matchLabels"]));
  return entries.length > 0 && entries.every(([k, v]) => labels[k] === v);
}

/** An int-or-percent as the controllers resolve it. */
function resolve(value: unknown, total: number, fallback: number): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d+%$/.test(value)) {
    return Math.ceil((total * Number.parseInt(value, 10)) / 100);
  }
  return fallback;
}

interface Workload {
  kind: string;
  id: string;
  replicas: number;
  /** Extra pods the controller may run during a rollout. */
  surge: number;
  labels: Record<string, string>;
  selfAntiAffinity: boolean;
  /** Selectors of required hostname anti-affinity terms. */
  antiSelectors: unknown[];
  hostPorts: number[];
}

const workloadKinds = ["Deployment", "StatefulSet", "DaemonSet"];

function id(manifest: Json): string {
  const metadata = obj(manifest["metadata"]);
  const namespace =
    typeof metadata["namespace"] === "string"
      ? `${metadata["namespace"]}/`
      : "";
  return `${namespace}${String(metadata["name"])}`;
}

function surgeOf(kind: string, spec: Json, replicas: number): number {
  if (kind === "Deployment") {
    const strategy = obj(spec["strategy"]);
    return strategy["type"] === "Recreate"
      ? 0
      : resolve(obj(strategy["rollingUpdate"])["maxSurge"], replicas, 1);
  }
  if (kind === "DaemonSet") {
    const strategy = obj(spec["updateStrategy"]);
    return strategy["type"] === "OnDelete"
      ? 0
      : resolve(obj(strategy["rollingUpdate"])["maxSurge"], replicas, 0);
  }
  return 0;
}

function describe(manifest: Json): Workload {
  const kind = String(manifest["kind"]);
  const spec = obj(manifest["spec"]);
  const template = obj(spec["template"]);
  const podSpec = obj(template["spec"]);
  const labels = labelsOf(obj(template["metadata"])["labels"]);
  const replicas = typeof spec["replicas"] === "number" ? spec["replicas"] : 1;

  const antiSelectors = list(
    obj(obj(podSpec["affinity"])["podAntiAffinity"])[
      "requiredDuringSchedulingIgnoredDuringExecution"
    ],
  )
    .filter((term) => term["topologyKey"] === hostnameKey)
    .map((term) => term["labelSelector"]);
  const selfAntiAffinity = antiSelectors.some((selector) =>
    selects(selector, labels),
  );

  const hostPorts = [
    ...list(podSpec["containers"]),
    ...list(podSpec["initContainers"]),
  ]
    .flatMap((container) => list(container["ports"]))
    .map((port) => port["hostPort"])
    .filter((port): port is number => typeof port === "number" && port > 0);

  return {
    kind,
    id: id(manifest),
    replicas,
    surge: surgeOf(kind, spec, replicas),
    labels,
    selfAntiAffinity,
    antiSelectors,
    hostPorts,
  };
}

function workloadProblems(workload: Workload, nodes: number): string[] {
  const { kind, id: name, replicas, surge, hostPorts } = workload;
  const label = `${kind} ${name}`;

  if (kind === "DaemonSet") {
    // One pod per node already; a surge pod shares the node with the old one.
    return surge > 0 && hostPorts.length > 0
      ? [
          `${label}: maxSurge ${surge} starts a new pod beside the old one, and both claim hostPort ${hostPorts[0]}. Set maxSurge to 0 so the old pod is replaced first.`,
        ]
      : [];
  }

  const peak = replicas + surge;
  let constraint: string | undefined;
  if (workload.selfAntiAffinity) {
    constraint = "required hostname anti-affinity against its own pods";
  } else if (hostPorts.length > 0) {
    constraint = `hostPort ${hostPorts[0]}`;
  }
  if (!constraint || peak <= nodes) {
    return [];
  }
  const cause =
    surge > 0 && replicas <= nodes
      ? `a rollout runs ${peak} pods (${replicas} replicas plus maxSurge ${surge})`
      : `it has ${replicas} replicas`;
  const fix = workload.selfAntiAffinity
    ? "Drop the anti-affinity for this environment, or set maxSurge to 0."
    : "Set maxSurge to 0, or drop the hostPort.";
  return [
    `${label}: ${cause} but the environment has ${nodes} node${nodes === 1 ? "" : "s"}, and each pod needs its own node (${constraint}). The rollout cannot progress. ${fix}`,
  ];
}

/**
 * The running pods' anti-affinity applies to the surge pod too, even when the
 * new template drops the rule.
 */
function inheritedProblems(
  workload: Workload,
  previous: Workload[],
  nodes: number,
): string[] {
  const { kind, id: name, replicas, surge } = workload;
  if (kind !== "Deployment" || surge === 0 || replicas + surge <= nodes) {
    return [];
  }
  const old = previous.find((p) => p.kind === kind && p.id === name);
  if (
    workload.selfAntiAffinity ||
    !old?.antiSelectors.some((selector) => selects(selector, workload.labels))
  ) {
    return [];
  }
  return [
    `${kind} ${name}: the running pods carry required hostname anti-affinity that selects the new pods, so with maxSurge ${surge} the surge pod cannot schedule beside them on ${nodes} node${nodes === 1 ? "" : "s"}, even though the new template drops the rule. Set maxSurge to 0 so the old pod is replaced first.`,
  ];
}

function budgetProblems(manifest: Json, workloads: Workload[]): string[] {
  const spec = obj(manifest["spec"]);
  const minAvailable = spec["minAvailable"];
  if (minAvailable === undefined) {
    return [];
  }
  return workloads
    .filter((workload) => selects(spec["selector"], workload.labels))
    .filter(
      (workload) =>
        resolve(minAvailable, workload.replicas, 0) >= workload.replicas,
    )
    .map(
      (workload) =>
        `PodDisruptionBudget ${id(manifest)}: minAvailable ${JSON.stringify(minAvailable)} covers every replica of ${workload.kind} ${workload.id} (${workload.replicas}), so a node drain can never evict its pod. Lower minAvailable or use maxUnavailable.`,
    );
}

function workloadsOf(manifests: unknown[]): Workload[] {
  return manifests
    .map(obj)
    .filter((doc) => workloadKinds.includes(String(doc["kind"])))
    .map(describe);
}

/**
 * Reasons a rollout or drain cannot progress on a cluster of `nodes` nodes.
 * `previous` is the manifests of the release already running, if any.
 */
export function rolloutProblems(
  manifests: unknown[],
  nodes: number,
  previous: unknown[] = [],
): string[] {
  const documents = manifests.map(obj);
  const workloads = workloadsOf(manifests);
  const running = workloadsOf(previous);
  return [
    ...workloads.flatMap((workload) => [
      ...workloadProblems(workload, nodes),
      ...inheritedProblems(workload, running, nodes),
    ]),
    ...documents
      .filter((doc) => doc["kind"] === "PodDisruptionBudget")
      .flatMap((doc) => budgetProblems(doc, workloads)),
  ];
}
