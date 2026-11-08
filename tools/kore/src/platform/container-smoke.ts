// Docs: docs/decisions/0036-rollout-feasibility-and-container-smoke.md

/**
 * Pure logic for the opt-in container smoke: turn rendered workloads into
 * `docker run` invocations of the pinned image, and judge what it logged.
 */

type Json = Record<string, unknown>;

export interface SmokeTarget {
  /** `Kind namespace/name`. */
  workload: string;
  container: string;
  image: string;
  command: string[];
  args: string[];
  env: Record<string, string>;
  /** Mount paths backed by PVCs or emptyDirs, served as tmpfs. */
  scratch: string[];
  /** Why this container cannot run outside the cluster. */
  skip?: string;
}

const workloadKinds = ["Deployment", "StatefulSet", "DaemonSet", "Job"];

const failurePatterns: [RegExp, string][] = [
  [/address already in use/i, "address already in use"],
  [
    /\blevel="?fatal"?|"level"\s*:\s*"fatal"|^\s*fatal\b|\bFATAL\b|^panic:/,
    "fatal log line",
  ],
];

/** Problems in a container's startup logs; empty when it looks healthy. */
export function classifySmokeLogs(logs: string): string[] {
  return logs
    .split("\n")
    .flatMap((line) =>
      failurePatterns
        .filter(([pattern]) => pattern.test(line))
        .map(([, reason]) => `${reason}: ${line.trim()}`),
    );
}

function obj(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

const clusterVolumes = [
  ["secret", "Secret"],
  ["configMap", "ConfigMap"],
  ["projected", "projected"],
  ["downwardAPI", "downwardAPI"],
  ["hostPath", "hostPath"],
] as const;

function describe(
  workload: string,
  podSpec: Json,
  container: Json,
): SmokeTarget {
  const name = String(container["name"]);
  const image = String(container["image"]);
  const volumes = new Map(
    list(podSpec["volumes"]).map((v) => [String(v["name"]), v]),
  );
  const env: Record<string, string> = {};
  const scratch: string[] = [];
  let skip: string | undefined;

  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    skip = `image ${image} is not pinned by digest, and the smoke never runs a tag`;
  }
  for (const entry of list(container["env"])) {
    if (entry["valueFrom"] !== undefined) {
      skip ??= `env ${String(entry["name"])} reads a cluster resource`;
    } else {
      env[String(entry["name"])] =
        typeof entry["value"] === "string" ? entry["value"] : "";
    }
  }
  for (const mount of list(container["volumeMounts"])) {
    const volume = volumes.get(String(mount["name"])) ?? {};
    const cluster = clusterVolumes.find(([key]) => volume[key] !== undefined);
    if (cluster) {
      skip ??= `${cluster[1]} volume ${String(mount["name"])} needs cluster resources`;
    } else {
      scratch.push(String(mount["mountPath"]));
    }
  }

  const target: SmokeTarget = {
    workload,
    container: name,
    image,
    command: strings(container["command"]),
    args: strings(container["args"]),
    env,
    scratch,
  };
  return skip === undefined ? target : { ...target, skip };
}

/** Every container of every workload in the rendered manifests. */
export function smokeTargets(manifests: unknown[]): SmokeTarget[] {
  return manifests.map(obj).flatMap((manifest) => {
    if (!workloadKinds.includes(String(manifest["kind"]))) {
      return [];
    }
    const metadata = obj(manifest["metadata"]);
    const workload = `${String(manifest["kind"])} ${String(metadata["namespace"])}/${String(metadata["name"])}`;
    const podSpec = obj(obj(obj(manifest["spec"])["template"])["spec"]);
    return list(podSpec["containers"]).map((container) =>
      describe(workload, podSpec, container),
    );
  });
}

/**
 * Arguments for a detached, read-only run of the pinned image. There is no
 * `--rm`: a crashed container keeps its logs, and the caller removes it.
 */
export function dockerRunArgs(target: SmokeTarget, name: string): string[] {
  const [entrypoint, ...command] = target.command;
  return [
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    ...target.scratch.flatMap((path) => ["--tmpfs", path]),
    ...Object.entries(target.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    ...(entrypoint === undefined ? [] : ["--entrypoint", entrypoint]),
    target.image,
    ...command,
    ...target.args,
  ];
}
