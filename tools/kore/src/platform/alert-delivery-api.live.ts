// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import type { Runner } from "../runtime/index.js";

// The reads and the scale-down behind the live alert proof. Prometheus and Grafana are read from inside
// the prometheus-server pod, which mounts the Grafana admin password (ADR 0128): the password is read there
// and never crosses into an argument, an output or this process. Kubernetes is read and scaled with kubectl.

export type RuleState = "absent" | "loaded" | "firing";

/** The default rule the live proof fires: notify-only, on a Service with no available replica (ADR 0114). */
export const alertName = "ServiceUnavailable";

export interface ClusterApi {
  /** Prometheus GET /api/v1/rules: whether the service's group holds the alert, and whether it is firing. */
  ruleState(service: string, alert: string): Promise<RuleState>;
  /** Grafana GET /api/alertmanager/grafana/api/v2/alerts: the receivers of the alert for the service, once it is there. */
  alertReceivers(alert: string, service: string): Promise<string[] | undefined>;
  /** Grafana GET /api/v1/provisioning/contact-points: the names only, never the settings. */
  contactPointNames(): Promise<string[]>;
  /** kubectl get deployments in the namespace: each name with its replica count. */
  deployments(namespace: string): Promise<Record<string, number>>;
  /** kubectl scale deployment: one Deployment to the given replica count. */
  scale(namespace: string, name: string, replicas: number): Promise<void>;
}

export interface ClusterApiOptions {
  kubeContext: string;
  cwd: string;
}

const observabilityNamespace = "observability";
const prometheusPod = "deploy/prometheus-server";
const prometheusContainer = "prometheus-server";
const prometheusUrl = "http://127.0.0.1:9090";
const grafanaUrl = "http://grafana.observability.svc:80";
const grafanaPasswordFile = "/etc/kore/grafana-admin/admin-password";
const plainScript = 'wget -q -O - "$1"';
const authorisedScript =
  "wget -q -O - --header=\"Authorization: Basic $(printf '%s' \"admin:$(cat " +
  grafanaPasswordFile +
  ')" | base64 | tr -d \'\\n\')" "$1"';

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
    throw new Error("Prometheus rules answer holds no rule groups");
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

export function parseDeployments(body: unknown): Record<string, number> {
  const replicas: Record<string, number> = {};
  for (const item of listOf(field(body, "items"))) {
    const name = field(field(item, "metadata"), "name");
    if (typeof name !== "string") {
      continue;
    }
    const count = field(field(item, "spec"), "replicas");
    replicas[name] = typeof count === "number" ? count : 1;
  }
  return replicas;
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
      prometheusPod,
      "--container",
      prometheusContainer,
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

export function clusterApi(
  runner: Runner,
  options: ClusterApiOptions,
): ClusterApi {
  const kubectl = (args: string[]) =>
    runner.run("kubectl", ["--context", options.kubeContext, ...args], {
      capture: true,
      cwd: options.cwd,
    });
  const inPod = (url: string, script: string, label: string) =>
    readInPod(runner, options, url, script, label);
  return {
    async ruleState(service, alert) {
      return parseRuleState(
        await inPod(
          prometheusUrl + "/api/v1/rules",
          plainScript,
          "Prometheus rules",
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
