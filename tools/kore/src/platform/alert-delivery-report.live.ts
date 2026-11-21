// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import { alertName } from "./alert-delivery-api.live.js";
import type { DeliveryReport } from "./alert-delivery-types.live.js";

/** Replaces every secret in the text; the empty ones are skipped. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}

/** The report as the lines an operator reads; every secret is redacted from the text. */
export function renderDelivery(
  report: DeliveryReport,
  secrets: readonly string[],
): string {
  const status =
    report.stage === undefined
      ? report.status
      : report.status + " at " + report.stage;
  return redact(
    [
      "alert: " + alertName + " on " + report.service,
      "rule: " + report.rule,
      "contact point: " + report.contactPoint,
      "status: " + status,
      "detail: " + report.detail,
      "inbox: " + report.inbox,
      "calls: " + report.calls.join("; "),
    ].join("\n"),
    secrets,
  );
}
