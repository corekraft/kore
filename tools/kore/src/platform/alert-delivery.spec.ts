// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { expect, test, vi } from "vitest";
import {
  inboxFailing,
  inboxReading,
  prove,
  proofCalls,
  proofEvents,
} from "./alert-delivery-support.js";

// The poll is a stand-in that reads at most three times and gives up, so no test waits on a real timer.
vi.mock("./alert-delivery-poll.live.js", () => ({
  awaitValue: async (read: () => Promise<unknown>) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const value = await read();
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  },
}));

// The proof renders no text; the rendering and its redaction are tested in alert-delivery-report.spec.ts.
vi.mock("./alert-delivery-report.live.js", () => ({
  redact: vi.fn(),
  renderDelivery: vi.fn(),
}));

test("fails at rule not loaded, firing nothing, when the metrics store has no rule for the service", async () => {
  const { report, events } = await prove({ rules: ["absent"] });
  expect(report).toEqual({
    service: "golden-path-example",
    contactPoint: "kore-platform-email",
    status: "failed",
    stage: "rule not loaded",
    detail:
      "Prometheus has no ServiceUnavailable rule in group kore.service.golden-path-example; check that the service-observability chart is delivered and the metrics store mounts kore-service-rules",
    rule: "not loaded",
    inbox: "not checked",
    calls: ["kubectl get deployments", "Prometheus GET /api/v1/rules"],
  });
  expect(events).toEqual([]);
});

test("fails at rule not loaded when the rule loads but never fires, and restores the Deployments", async () => {
  const { report, events } = await prove({ rules: ["loaded"] });
  expect(report.stage).toBe("rule not loaded");
  expect(report.detail).toBe(
    "ServiceUnavailable was loaded but did not fire within 900 s after golden-path-example's Deployments were scaled to zero",
  );
  expect(report.rule).toBe("loaded");
  expect(events).toEqual(proofEvents);
});

test("fails at alert not forwarded when Grafana never shows the alert, and restores the Deployments", async () => {
  const { report, events } = await prove({ receivers: [undefined] });
  expect(report.status).toBe("failed");
  expect(report.stage).toBe("alert not forwarded");
  expect(report.detail).toBe(
    "Grafana shows no ServiceUnavailable alert for golden-path-example within 900 s; the metrics store did not forward it",
  );
  expect(report.rule).toBe("firing");
  expect(events).toEqual(proofEvents);
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
    calls: proofCalls,
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

test("names the Grafana, Prometheus and kubectl calls used, each once, in order", async () => {
  const { report } = await prove({}, inboxReading([true]));
  expect(report.calls).toEqual(proofCalls);
});

test("records each Deployment's replica count on it before scaling it to zero, then clears the record once it is restored", async () => {
  const { events } = await prove({}, inboxReading([true]));
  expect(events).toEqual(proofEvents);
});

test("scales only the Deployments that run, to zero, then restores each to its own replica count", async () => {
  const { events } = await prove({
    deployments: {
      "golden-path-example": { replicas: 2 },
      "kore-worker": { replicas: 0 },
    },
  });
  expect(events).toEqual(proofEvents);
});
