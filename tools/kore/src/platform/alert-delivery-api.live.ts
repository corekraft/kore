// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import type { Runner } from "../runtime/index.js";

// The reads and the scale-down behind the live alert proof. Grafana is read from inside the grafana pod,
// which holds the admin password in its environment (ADR 0177 moved the Service rules into Grafana): the
// password is read there and never crosses into an argument, an output or this process. Kubernetes is read
// and scaled with kubectl.

export type RuleState = "absent" | "loaded" | "firing";

/** The default rule the live proof fires: notify-only, on a Service with no available replica (ADR 0114). */
export const alertName = "ServiceUnavailable";

/** The annotation a run writes on each Deployment before it scales it to zero: the replica count a later run restores. */
export const replicasAnnotation = "kore.dev/alert-proof-replicas";

/** The names the proof's report gives each read and write, as an operator reads them. */
export const callLabels = {
  rules: "Grafana GET /api/prometheus/grafana/api/v1/rules",
  deployments: "kubectl get deployments",
  annotate: "kubectl annotate deployment",
  scale: "kubectl scale deployment",
  alerts: "Grafana GET /api/alertmanager/grafana/api/v2/alerts",
  contactPoints: "Grafana GET /api/v1/provisioning/contact-points",
  inbox: "inbox API read",
};

export interface DeploymentState {
  replicas: number;
  /** The replica count a run recorded before it scaled the Deployment to zero; present only while that run is unfinished. */
  recorded?: number;
}

export interface ClusterApi {
  /** Grafana GET /api/prometheus/grafana/api/v1/rules: whether the service's group holds the alert, and whether it is firing. */
  ruleState(service: string, alert: string): Promise<RuleState>;
  /** Grafana GET /api/alertmanager/grafana/api/v2/alerts: the receivers of the alert for the service, once it is there. */
  alertReceivers(alert: string, service: string): Promise<string[] | undefined>;
  /** Grafana GET /api/v1/provisioning/contact-points: the names only, never the settings. */
  contactPointNames(): Promise<string[]>;
  /** kubectl get deployments in the namespace: each name with its replica count and any recorded count. */
  deployments(namespace: string): Promise<Record<string, DeploymentState>>;
  /** kubectl annotate: records the replica count to restore on one Deployment. */
  record(namespace: string, name: string, replicas: number): Promise<void>;
  /** kubectl annotate with the key removed: clears the record once the Deployment is restored. */
  forget(namespace: string, name: string): Promise<void>;
  /** kubectl scale deployment: one Deployment to the given replica count. */
  scale(namespace: string, name: string, replicas: number): Promise<void>;
}

export interface ClusterApiOptions {
  kubeContext: string;
  cwd: string;
}

const observabilityNamespace = "observability";
const grafanaPod = "deploy/grafana";
const grafanaContainer = "grafana";
const grafanaUrl = "http://grafana.observability.svc:80";
const authorisedScript =
  'wget -q -O - --header="Authorization: Basic $(printf \'%s\' "admin:$GF_SECURITY_ADMIN_PASSWORD" | base64 | tr -d \'\\n\')" "$1"';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(label + " answer is not JSON");
  }
}

export function parseRuleState(
  body: unknown,
  service: string,
  alert: string,
): RuleState {
  const groups = field(field(body, "data"), "groups");
  if (!Array.isArray(groups)) {
    throw new Error("Grafana rules answer holds no rule groups");
  }
  const group = groups.find(
    (item) => field(item, "name") === "kore.service." + service,
  );
  const rule = listOf(field(group, "rules")).find(
    (item) => field(item, "name") === alert,
  );
  if (rule === undefined) {
    return "absent";
  }
  return field(rule, "state") === "firing" ? "firing" : "loaded";
}

export function parseAlertReceivers(
  body: unknown,
  alert: string,
  service: string,
): string[] | undefined {
  const found = listOf(body).find((item) => {
    const labels = field(item, "labels");
    return (
      field(labels, "alertname") === alert &&
      field(labels, "service") === service
    );
  });
  if (found === undefined) {
    return undefined;
  }
  return listOf(field(found, "receivers"))
    .map((receiver) => field(receiver, "name"))
    .filter((name): name is string => typeof name === "string");
}

export function parseContactPointNames(body: unknown): string[] {
  return listOf(body)
    .map((item) => field(item, "name"))
    .filter((name): name is string => typeof name === "string");
}

function recordedCount(item: unknown, name: string): number | undefined {
  const value = field(
    field(field(item, "metadata"), "annotations"),
    replicasAnnotation,
  );
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(
      "Deployment " +
        name +
        " carries " +
        replicasAnnotation +
        ", which is not a replica count; correct or remove that annotation by hand",
    );
  }
  return Number(value);
}

export function parseDeployments(
  body: unknown,
): Record<string, DeploymentState> {
  const found: Record<string, DeploymentState> = {};
  for (const item of listOf(field(body, "items"))) {
    const name = field(field(item, "metadata"), "name");
    if (typeof name !== "string") {
      continue;
    }
    const count = field(field(item, "spec"), "replicas");
    const state: DeploymentState = {
      replicas: typeof count === "number" ? count : 1,
    };
    const recorded = recordedCount(item, name);
    if (recorded !== undefined) {
      state.recorded = recorded;
    }
    found[name] = state;
  }
  return found;
}

async function readInPod(
  runner: Runner,
  options: ClusterApiOptions,
  url: string,
  script: string,
  label: string,
): Promise<unknown> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      options.kubeContext,
      "--namespace",
      observabilityNamespace,
      "exec",
      grafanaPod,
      "--container",
      grafanaContainer,
      "--",
      "sh",
      "-c",
      script,
      "sh",
      url,
    ],
    { capture: true, cwd: options.cwd },
  );
  return parseJson(stdout, label);
}

function kubernetesApi(
  runner: Runner,
  options: ClusterApiOptions,
): Pick<ClusterApi, "deployments" | "record" | "forget" | "scale"> {
  const kubectl = (args: string[]) =>
    runner.run("kubectl", ["--context", options.kubeContext, ...args], {
      capture: true,
      cwd: options.cwd,
    });
  return {
    async deployments(namespace) {
      const { stdout } = await kubectl([
        "--namespace",
        namespace,
        "get",
        "deployments",
        "--output",
        "json",
      ]);
      return parseDeployments(parseJson(stdout, "Kubernetes deployments"));
    },
    async record(namespace, name, replicas) {
      await kubectl([
        "--namespace",
        namespace,
        "annotate",
        "deployment",
        name,
        replicasAnnotation + "=" + String(replicas),
        "--overwrite",
      ]);
    },
    async forget(namespace, name) {
      await kubectl([
        "--namespace",
        namespace,
        "annotate",
        "deployment",
        name,
        replicasAnnotation + "-",
      ]);
    },
    async scale(namespace, name, replicas) {
      await kubectl([
        "--namespace",
        namespace,
        "scale",
        "deployment",
        name,
        "--replicas=" + String(replicas),
      ]);
    },
  };
}

export function clusterApi(
  runner: Runner,
  options: ClusterApiOptions,
): ClusterApi {
  const inPod = (url: string, script: string, label: string) =>
    readInPod(runner, options, url, script, label);
  return {
    ...kubernetesApi(runner, options),
    async ruleState(service, alert) {
      return parseRuleState(
        await inPod(
          grafanaUrl + "/api/prometheus/grafana/api/v1/rules",
          authorisedScript,
          "Grafana rules",
        ),
        service,
        alert,
      );
    },
    async alertReceivers(alert, service) {
      return parseAlertReceivers(
        await inPod(
          grafanaUrl + "/api/alertmanager/grafana/api/v2/alerts",
          authorisedScript,
          "Grafana alerts",
        ),
        alert,
        service,
      );
    },
    async contactPointNames() {
      return parseContactPointNames(
        await inPod(
          grafanaUrl + "/api/v1/provisioning/contact-points",
          authorisedScript,
          "Grafana contact points",
        ),
      );
    },
  };
}
