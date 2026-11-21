// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { expect, test } from "vitest";
import type { ClusterApi, RuleState } from "./alert-delivery-api.js";
import {
  proveAlertDelivery,
  type DeliveryOptions,
  type InboxCheck,
} from "./alert-delivery.js";
import { renderDelivery } from "./alert-delivery-report.js";

const options: DeliveryOptions = {
  service: "golden-path-example",
  namespace: "golden-path-example--local",
  contactPoint: "kore-platform-email",
  alertSeconds: 900,
  deliverySeconds: 300,
  pollSeconds: 15,
};

interface Plan {
  rules?: RuleState[];
  receivers?: (string[] | undefined)[];
  contactPoints?: string[];
  deployments?: Record<string, number>;
  refuseRestore?: boolean;
}

// The last value repeats once the list runs out, so a poll that never changes is a poll that never ends.
function sequence<T>(values: readonly T[]): () => T {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] as T;
    index += 1;
    return value;
  };
}

function fakeApi(plan: Plan, scaled: string[]): ClusterApi {
  const rule = sequence<RuleState>(plan.rules ?? ["firing"]);
  const receivers = sequence<string[] | undefined>(
    plan.receivers ?? [["kore-platform-email"]],
  );
  return {
    ruleState: async () => rule(),
    alertReceivers: async () => receivers(),
    contactPointNames: async () =>
      plan.contactPoints ?? ["kore-platform-email"],
    deployments: async () => plan.deployments ?? { "golden-path-example": 2 },
    scale: async (namespace, name, replicas) => {
      if (replicas > 0 && plan.refuseRestore === true) {
        throw new Error("kubectl refused");
      }
      scaled.push(namespace + "/" + name + "=" + String(replicas));
    },
  };
}

function inboxReading(arrived: boolean[], since: number[] = []): InboxCheck {
  const next = sequence(arrived);
  return {
    kind: "read",
    reader: {
      arrivedSince: async (time: number) => {
        since.push(time);
        return next();
      },
    },
  };
}

function inboxFailing(message: string): InboxCheck {
  return {
    kind: "read",
    reader: {
      arrivedSince: async () => {
        throw new Error(message);
      },
    },
  };
}

function clock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

async function prove(plan: Plan, inbox: InboxCheck = inboxReading([true])) {
  const scaled: string[] = [];
  const api = fakeApi(plan, scaled);
  const time = clock();
  const report = await proveAlertDelivery(
    { api, inbox, now: time.now, sleep: time.sleep },
    options,
  );
  return { report, scaled };
}

async function messageOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no error";
}

const scaledToZero = [
  "golden-path-example--local/golden-path-example=0",
  "golden-path-example--local/golden-path-example=2",
];

test("fails at rule not loaded, firing nothing, when the metrics store has no rule for the service", async () => {
  const { report, scaled } = await prove({ rules: ["absent"] });
  expect(report).toEqual({
    service: "golden-path-example",
    contactPoint: "kore-platform-email",
    status: "failed",
    stage: "rule not loaded",
    detail:
      "Prometheus has no ServiceUnavailable rule in group kore.service.golden-path-example; check that the service-observability chart is delivered and the metrics store mounts kore-service-rules",
    rule: "not loaded",
    inbox: "not checked",
    calls: ["Prometheus GET /api/v1/rules"],
  });
  expect(scaled).toEqual([]);
});

test("fails at rule not loaded when the rule loads but never fires, and restores the Deployments", async () => {
  const { report, scaled } = await prove({ rules: ["loaded"] });
  expect(report.stage).toBe("rule not loaded");
  expect(report.detail).toBe(
    "ServiceUnavailable was loaded but did not fire within 900 s after golden-path-example's Deployments were scaled to zero",
  );
  expect(report.rule).toBe("loaded");
  expect(scaled).toEqual(scaledToZero);
});

test("fails at alert not forwarded when Grafana never shows the alert", async () => {
  const { report, scaled } = await prove({ receivers: [undefined] });
  expect(report.status).toBe("failed");
  expect(report.stage).toBe("alert not forwarded");
  expect(report.detail).toBe(
    "Grafana shows no ServiceUnavailable alert for golden-path-example within 900 s; the metrics store did not forward it",
  );
  expect(report.rule).toBe("firing");
  expect(scaled).toEqual(scaledToZero);
});

test("fails at contact point failed when Grafana routes the alert to another receiver", async () => {
  const { report } = await prove({ receivers: [["kore-other"]] });
  expect(report.stage).toBe("contact point failed");
  expect(report.detail).toBe(
    "Grafana routed ServiceUnavailable for golden-path-example to kore-other, not to kore-platform-email",
  );
});

test("fails at contact point failed when Grafana routes the alert to no receiver", async () => {
  const { report } = await prove({ receivers: [[]] });
  expect(report.stage).toBe("contact point failed");
  expect(report.detail).toBe(
    "Grafana routed ServiceUnavailable for golden-path-example to no receiver, not to kore-platform-email",
  );
});

test("fails at contact point failed when Grafana has no contact point of that name", async () => {
  const { report } = await prove({ contactPoints: [] });
  expect(report.stage).toBe("contact point failed");
  expect(report.detail).toBe(
    "Grafana has no contact point kore-platform-email; its provisioning did not load",
  );
});

test("fails at contact point failed when no alert message reaches the inbox within the budget", async () => {
  const { report } = await prove({}, inboxReading([false]));
  expect(report.status).toBe("failed");
  expect(report.stage).toBe("contact point failed");
  expect(report.inbox).toBe("not arrived");
  expect(report.detail).toBe(
    "no ServiceUnavailable message reached the inbox within 300 s after the alert fired",
  );
});

test("reports delivered when the inbox holds the alert message", async () => {
  const { report } = await prove({}, inboxReading([false, true]));
  expect(report).toEqual({
    service: "golden-path-example",
    contactPoint: "kore-platform-email",
    status: "delivered",
    detail:
      "Grafana routed ServiceUnavailable to kore-platform-email and the inbox holds its message",
    rule: "firing",
    inbox: "arrived",
    calls: [
      "Prometheus GET /api/v1/rules",
      "kubectl get deployments",
      "kubectl scale deployment",
      "Grafana GET /api/alertmanager/grafana/api/v2/alerts",
      "Grafana GET /api/v1/provisioning/contact-points",
      "inbox API read",
    ],
  });
});

test("reports not confirmed, not failed, and says Grafana offers no delivery state when the inbox check is skipped", async () => {
  const reason =
    "KORE_ALERT_INBOX_API_URL and KORE_ALERT_INBOX_API_KEY are unset";
  const { report } = await prove({}, { kind: "skipped", reason });
  expect(report.status).toBe("not confirmed");
  expect(report.stage).toBe(undefined);
  expect(report.inbox).toBe("skipped: " + reason);
  expect(report.detail).toBe(
    "Grafana routed ServiceUnavailable to kore-platform-email and the contact point exists; Grafana's API offers no delivery state to read",
  );
});

test("reports not confirmed when the inbox cannot be read, and names the read's own message", async () => {
  const { report } = await prove(
    {},
    inboxFailing(
      "the inbox API did not answer; check KORE_ALERT_INBOX_API_URL and the network",
    ),
  );
  expect(report.status).toBe("not confirmed");
  expect(report.inbox).toBe("not checked");
  expect(report.detail).toBe(
    "Grafana routed ServiceUnavailable to kore-platform-email; the inbox could not be read: the inbox API did not answer; check KORE_ALERT_INBOX_API_URL and the network",
  );
});

test("counts only messages sent after the Deployments were scaled to zero", async () => {
  const since: number[] = [];
  await prove({}, inboxReading([true], since));
  expect(since).toEqual([1_000_000]);
});

test("names the Grafana and Prometheus calls used, each once, in order", async () => {
  const { report } = await prove({}, inboxReading([true]));
  expect(report.calls).toEqual([
    "Prometheus GET /api/v1/rules",
    "kubectl get deployments",
    "kubectl scale deployment",
    "Grafana GET /api/alertmanager/grafana/api/v2/alerts",
    "Grafana GET /api/v1/provisioning/contact-points",
    "inbox API read",
  ]);
});

test("scales only the Deployments that run, to zero, then restores each to its own replica count", async () => {
  const { scaled } = await prove({
    deployments: { "golden-path-example": 2, "kore-worker": 0 },
  });
  expect(scaled).toEqual(scaledToZero);
});

test("restores the Deployments even when a stage fails", async () => {
  const { report, scaled } = await prove({ receivers: [undefined] });
  expect(report.stage).toBe("alert not forwarded");
  expect(scaled).toEqual(scaledToZero);
});

test("fails loudly, naming the Deployment to scale back by hand, when a restore is refused", async () => {
  const scaled: string[] = [];
  const time = clock();
  const pending = proveAlertDelivery(
    {
      api: fakeApi({ refuseRestore: true }, scaled),
      inbox: inboxReading([true]),
      now: time.now,
      sleep: time.sleep,
    },
    options,
  );
  expect(await messageOf(pending)).toBe(
    "could not restore golden-path-example in golden-path-example--local to 2 replicas; scale it back by hand: kubectl refused",
  );
});

test("never prints the inbox URL, its key or the alert address, even inside an error", async () => {
  const url = "https://inbox.example.invalid/v0/messages";
  const key = "key-example";
  const address = "owner@example.invalid";
  const { report } = await prove(
    {},
    inboxFailing("GET " + url + " with " + key + " for " + address + " failed"),
  );
  const text = renderDelivery(report, [url, key, address]);
  expect(text).not.toContain(url);
  expect(text).not.toContain(key);
  expect(text).not.toContain(address);
  expect(text).toContain(
    "detail: Grafana routed ServiceUnavailable to kore-platform-email; the inbox could not be read: GET [redacted] with [redacted] for [redacted] failed",
  );
});
