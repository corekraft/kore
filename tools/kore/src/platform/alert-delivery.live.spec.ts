import assert from "node:assert/strict";
import test from "node:test";
import { alertContactPoint, loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { clusterApi } from "./alert-delivery-api.js";
import {
  type HttpGet,
  inboxReader,
  inboxSetup,
} from "./alert-delivery-inbox.js";
import { proveAlertDelivery } from "./alert-delivery.js";
import { renderDelivery, redact } from "./alert-delivery-report.js";

// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
// Docs: infra/plans/15-next-horizon.md (Step 6 item 4: the live delivery proof)
// Live and opt-in: needs a converged local profile with platform-portal on and the alert address set at
// run time (KORE_ALERT_EMAIL_ADDRESSES and KORE_ALERT_SMTP_*). It fires the default ServiceUnavailable rule
// on one delivered Service by scaling its Deployments to zero, then restores them. It reads Prometheus and
// Grafana from inside the prometheus-server pod, and reads the owner's inbox through its API only when
// KORE_ALERT_INBOX_API_URL and KORE_ALERT_INBOX_API_KEY are both set; otherwise the inbox check is skipped
// and reported as such. It prints the contact point's name and the status, and no address, key or message
// body. ONE RUN AT A TIME on an idle host: stop writer and challenger panes first. Run with KORE_RUN_LIVE=1
// (npm run test:live:alert-delivery in tools/kore). KORE_ALERT_SERVICE names the Service (default
// golden-path-example).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 30 * 60 * 1000,
};

// Grafana's and the inbox's answers are read as text; no header or body is ever logged by this file.
const fetchGet: HttpGet = async (url, headers) => {
  const response = await fetch(url, { headers: { ...headers } });
  return { status: response.status, body: await response.text() };
};

function secretsIn(env: NodeJS.ProcessEnv): string[] {
  const addresses = (env["KORE_ALERT_EMAIL_ADDRESSES"] ?? "").split(/[;,]/);
  return [
    env["KORE_ALERT_INBOX_API_URL"] ?? "",
    env["KORE_ALERT_INBOX_API_KEY"] ?? "",
    ...addresses.map((address) => address.trim()),
  ];
}

test(
  "a delivered service's alert is fired, follows the metrics store to Grafana, and reaches the contact point",
  live,
  async () => {
    const repository = await loadRepository(liveEnvironment());
    const { kubeContext, name } = repository.environment;
    const contactPoint = alertContactPoint(repository.environment);
    assert.ok(
      contactPoint !== undefined,
      "alerts have no contact point: set KORE_ALERT_EMAIL_ADDRESSES and KORE_ALERT_SMTP_HOST, _PORT and _FROM in the shell that runs kore, with platform-portal on",
    );
    const service = process.env["KORE_ALERT_SERVICE"] ?? "golden-path-example";
    const setup = inboxSetup(process.env);
    const secrets = secretsIn(process.env);
    try {
      const report = await proveAlertDelivery(
        {
          api: clusterApi(new ProcessRunner(), {
            kubeContext,
            cwd: repository.root,
          }),
          inbox: setup.ok
            ? { kind: "read", reader: inboxReader(setup.settings, fetchGet) }
            : { kind: "skipped", reason: setup.reason },
          now: () => Date.now(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        {
          service,
          namespace: service + "--" + name,
          contactPoint,
          alertSeconds: 900,
          deliverySeconds: 300,
          pollSeconds: 15,
        },
      );
      process.stdout.write(renderDelivery(report, secrets) + "\n");
      assert.notEqual(report.status, "failed", report.detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redact(message, secrets));
    }
  },
);
