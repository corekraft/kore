// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import { expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  clusterApi,
  parseAlertReceivers,
  parseContactPointNames,
  parseRuleState,
} from "./alert-delivery-api.live.js";

const kubeContext = "k3d-kore-local";
const cwd = "/repo";
const inPod = [
  "--context",
  kubeContext,
  "--namespace",
  "observability",
  "exec",
  "deploy/prometheus-server",
  "--container",
  "prometheus-server",
  "--",
];
const plainScript = 'wget -q -O - "$1"';
const authorisedScript =
  'wget -q -O - --header="Authorization: Basic $(printf \'%s\' "admin:$(cat /etc/kore/grafana-admin/admin-password)" | base64 | tr -d \'\\n\')" "$1"';

const rulesBody = {
  status: "success",
  data: {
    groups: [
      {
        name: "kore.service.golden-path-example",
        rules: [
          {
            type: "alerting",
            name: "ServiceUnavailable",
            state: "firing",
            labels: { service: "golden-path-example" },
          },
        ],
      },
    ],
  },
};

const alertsBody = [
  {
    labels: { alertname: "ServiceUnavailable", service: "golden-path-example" },
    receivers: [{ name: "kore-platform-email" }],
    status: { state: "active" },
  },
];

function runnerReturning(stdout: string) {
  const run = vi.fn<Runner["run"]>(async () => ({
    stdout,
    stderr: "",
    code: 0,
  }));
  const runner: Runner = { run };
  return { run, runner };
}

async function messageOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no error";
}

test("reads the Prometheus rules from inside the prometheus-server pod, with no secret in the arguments", async () => {
  const { run, runner } = runnerReturning(JSON.stringify(rulesBody));
  const api = clusterApi(runner, { kubeContext, cwd });
  expect(await api.ruleState("golden-path-example", "ServiceUnavailable")).toBe(
    "firing",
  );
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      ...inPod,
      "sh",
      "-c",
      plainScript,
      "sh",
      "http://127.0.0.1:9090/api/v1/rules",
    ],
    { capture: true, cwd },
  );
});

test("reads Grafana's alerts with the admin password taken inside the pod, never as an argument", async () => {
  const { run, runner } = runnerReturning(JSON.stringify(alertsBody));
  const api = clusterApi(runner, { kubeContext, cwd });
  expect(
    await api.alertReceivers("ServiceUnavailable", "golden-path-example"),
  ).toEqual(["kore-platform-email"]);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      ...inPod,
      "sh",
      "-c",
      authorisedScript,
      "sh",
      "http://grafana.observability.svc:80/api/alertmanager/grafana/api/v2/alerts",
    ],
    { capture: true, cwd },
  );
});

test("reads the contact point names from Grafana's provisioning API", async () => {
  const { run, runner } = runnerReturning(
    JSON.stringify([{ name: "kore-platform-email", type: "email" }]),
  );
  const api = clusterApi(runner, { kubeContext, cwd });
  expect(await api.contactPointNames()).toEqual(["kore-platform-email"]);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      ...inPod,
      "sh",
      "-c",
      authorisedScript,
      "sh",
      "http://grafana.observability.svc:80/api/v1/provisioning/contact-points",
    ],
    { capture: true, cwd },
  );
});

test("refuses a read whose answer is not JSON, without echoing the answer", async () => {
  const { runner } = runnerReturning("<html>secret-page</html>");
  const api = clusterApi(runner, { kubeContext, cwd });
  expect(
    await messageOf(
      api.alertReceivers("ServiceUnavailable", "golden-path-example"),
    ),
  ).toBe("Grafana alerts answer is not JSON");
});

test("lists each Deployment's replicas, one when its spec leaves them unset", async () => {
  const { run, runner } = runnerReturning(
    JSON.stringify({
      items: [
        { metadata: { name: "golden-path-example" }, spec: { replicas: 2 } },
        { metadata: { name: "kore-worker" } },
      ],
    }),
  );
  const api = clusterApi(runner, { kubeContext, cwd });
  expect(await api.deployments("golden-path-example--local")).toEqual({
    "golden-path-example": { replicas: 2 },
    "kore-worker": { replicas: 1 },
  });
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      kubeContext,
      "--namespace",
      "golden-path-example--local",
      "get",
      "deployments",
      "--output",
      "json",
    ],
    { capture: true, cwd },
  );
});

test("scales one Deployment with an exact kubectl command naming its namespace and context", async () => {
  const { run, runner } = runnerReturning("");
  const api = clusterApi(runner, { kubeContext, cwd });
  await api.scale("golden-path-example--local", "golden-path-example", 0);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      kubeContext,
      "--namespace",
      "golden-path-example--local",
      "scale",
      "deployment",
      "golden-path-example",
      "--replicas=0",
    ],
    { capture: true, cwd },
  );
});

test("reads the rule as firing, loaded when pending, and absent for another service", () => {
  expect(
    parseRuleState(rulesBody, "golden-path-example", "ServiceUnavailable"),
  ).toBe("firing");
  const pending = {
    data: {
      groups: [
        {
          name: "kore.service.golden-path-example",
          rules: [
            { type: "alerting", name: "ServiceUnavailable", state: "pending" },
          ],
        },
      ],
    },
  };
  expect(
    parseRuleState(pending, "golden-path-example", "ServiceUnavailable"),
  ).toBe("loaded");
  expect(parseRuleState(rulesBody, "other", "ServiceUnavailable")).toBe(
    "absent",
  );
});

test("refuses a rules answer with no rule groups", () => {
  expect(() =>
    parseRuleState({}, "golden-path-example", "ServiceUnavailable"),
  ).toThrow("Prometheus rules answer holds no rule groups");
});

test("names the receivers of the alert for its service, and none for an absent alert", () => {
  expect(
    parseAlertReceivers(
      alertsBody,
      "ServiceUnavailable",
      "golden-path-example",
    ),
  ).toEqual(["kore-platform-email"]);
  expect(
    parseAlertReceivers(
      alertsBody,
      "ServiceHighErrorRatio",
      "golden-path-example",
    ),
  ).toBe(undefined);
  expect(
    parseAlertReceivers([], "ServiceUnavailable", "golden-path-example"),
  ).toBe(undefined);
});

test("reads only contact point names, never their settings", () => {
  const names = parseContactPointNames([
    {
      name: "kore-platform-email",
      type: "email",
      settings: { addresses: "owner@example.invalid" },
    },
  ]);
  expect(names).toEqual(["kore-platform-email"]);
  expect(JSON.stringify(names)).not.toContain("example.invalid");
});
