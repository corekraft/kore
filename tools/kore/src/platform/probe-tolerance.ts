/**
 * Offline check that no rendered liveness probe gives up too quickly. On a
 * loaded developer laptop the kubelet's probe request can take longer than the
 * Kubernetes default of one second, which kills a healthy controller.
 */

type Json = Record<string, unknown>;

const defaultTimeoutSeconds = 1;

function obj(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function podSpec(manifest: Json): Json {
  const spec = obj(manifest["spec"]);
  const template = obj(spec["template"]);
  return obj(
    template["spec"] === undefined
      ? obj(obj(obj(spec["jobTemplate"])["spec"])["template"])["spec"]
      : template["spec"],
  );
}

/**
 * Problems for every container whose liveness `timeoutSeconds` is under
 * `floor`. `allowed` maps "<component>: <Kind>/<name> container <container>"
 * to the reason a chart cannot be tuned; an entry with no reason does not
 * count, and an entry that is no longer needed is reported so the list shrinks.
 */
export function livenessProbeProblems(
  component: string,
  manifests: unknown[],
  floor: number,
  allowed: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const raw of manifests) {
    const manifest = obj(raw);
    const kind = text(manifest["kind"]);
    const name = text(obj(manifest["metadata"])["name"]);
    for (const container of list(podSpec(manifest)["containers"])) {
      const probe = container["livenessProbe"];
      if (probe === undefined) {
        continue;
      }
      const timeout = obj(probe)["timeoutSeconds"];
      const seconds =
        typeof timeout === "number" ? timeout : defaultTimeoutSeconds;
      const id = `${component}: ${kind}/${name} container ${text(container["name"])}`;
      const reason = allowed[id];
      if (seconds >= floor) {
        if (reason !== undefined) {
          problems.push(
            `${id} is allowlisted but its liveness timeout ${seconds} already meets ${floor}; remove the entry`,
          );
        }
        continue;
      }
      if (reason === undefined || reason.trim() === "") {
        problems.push(
          `${id} livenessProbe timeoutSeconds ${seconds} is below ${floor}`,
        );
      }
    }
  }
  return problems;
}
