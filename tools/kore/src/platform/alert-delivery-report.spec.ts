// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import { expect, test } from "vitest";
import { redact, renderDelivery } from "./alert-delivery-report.live.js";
import type { DeliveryReport } from "./alert-delivery.live.js";

const delivered: DeliveryReport = {
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
};

test("redact replaces every secret in the text and leaves empty secrets out", () => {
  expect(redact("a key-example and key-example", ["key-example", ""])).toBe(
    "a [redacted] and [redacted]",
  );
});

test("renders a delivered report as exact lines naming the contact point, never an address", () => {
  expect(renderDelivery(delivered, [])).toBe(
    [
      "alert: ServiceUnavailable on golden-path-example",
      "rule: firing",
      "contact point: kore-platform-email",
      "status: delivered",
      "detail: Grafana routed ServiceUnavailable to kore-platform-email and the inbox holds its message",
      "inbox: arrived",
      "calls: Prometheus GET /api/v1/rules; kubectl get deployments; kubectl scale deployment; Grafana GET /api/alertmanager/grafana/api/v2/alerts; Grafana GET /api/v1/provisioning/contact-points; inbox API read",
    ].join("\n"),
  );
});

test("renders the failed stage after the status, so the broken stage is named first", () => {
  const failed: DeliveryReport = {
    ...delivered,
    status: "failed",
    stage: "alert not forwarded",
    detail: "Grafana shows no ServiceUnavailable alert",
    rule: "firing",
    inbox: "not checked",
  };
  expect(renderDelivery(failed, []).split("\n")[3]).toBe(
    "status: failed at alert not forwarded",
  );
});

test("renders a report with its secrets redacted from every line", () => {
  const text = renderDelivery(
    { ...delivered, detail: "sent to owner@example.invalid" },
    ["owner@example.invalid"],
  );
  expect(text).toContain("detail: sent to [redacted]");
  expect(text).not.toContain("owner@example.invalid");
});
