// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import type { ClusterApi } from "./alert-delivery-api.live.js";
import type { InboxReader } from "./alert-delivery-inbox.live.js";

// The shapes the live alert proof takes in and gives back, kept apart so the proof module stays within its size.

export type Stage =
  "rule not loaded" | "alert not forwarded" | "contact point failed";

export interface DeliveryOptions {
  service: string;
  /** The Service's namespace, <service>--<environment>. */
  namespace: string;
  contactPoint: string;
  /** Seconds the alert gets to fire and reach Grafana. */
  alertSeconds: number;
  /** Seconds the inbox gets to show the alert message. */
  deliverySeconds: number;
  pollSeconds: number;
}

export type InboxCheck =
  { kind: "read"; reader: InboxReader } | { kind: "skipped"; reason: string };

export interface DeliveryDeps {
  api: ClusterApi;
  inbox: InboxCheck;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface DeliveryReport {
  service: string;
  contactPoint: string;
  status: "delivered" | "failed" | "not confirmed";
  stage?: Stage;
  detail: string;
  rule: "not loaded" | "loaded" | "firing";
  inbox: string;
  /** The Grafana, Prometheus, kubectl and inbox reads used, each once, in order. */
  calls: string[];
}
