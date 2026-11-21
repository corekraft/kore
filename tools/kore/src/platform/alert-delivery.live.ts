// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { awaitValue } from "./alert-delivery-poll.live.js";
import {
  alertName,
  type ClusterApi,
  type RuleState,
} from "./alert-delivery-api.live.js";
import type { InboxReader } from "./alert-delivery-inbox.live.js";

// The live alert proof: fires the default ServiceUnavailable rule on one delivered Service by scaling its
// Deployments to zero, follows the alert through the metrics store, Grafana and the contact point, and
// restores the Deployments. It names the broken stage, and it reports only the contact point's name.

const grafanaDeliveryNote = "Grafana's API offers no delivery state to read";

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

const labels = {
  rules: "Prometheus GET /api/v1/rules",
  deployments: "kubectl get deployments",
  scale: "kubectl scale deployment",
  alerts: "Grafana GET /api/alertmanager/grafana/api/v2/alerts",
  contactPoints: "Grafana GET /api/v1/provisioning/contact-points",
  inbox: "inbox API read",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ruleWord(state: RuleState): DeliveryReport["rule"] {
  return state === "absent" ? "not loaded" : state;
}

class Delivery {
  readonly calls: string[] = [];
  rule: DeliveryReport["rule"] = "not loaded";
  inbox = "not checked";
  /** Each Deployment scaled to zero, with the replica count to restore. */
  readonly scaledDown: { name: string; replicas: number }[] = [];
  private fired = 0;
  private alertDeadline = 0;

  constructor(
    private readonly deps: DeliveryDeps,
    private readonly options: DeliveryOptions,
  ) {}

  note(label: string): void {
    if (!this.calls.includes(label)) {
      this.calls.push(label);
    }
  }

  report(
    fields: Pick<DeliveryReport, "status" | "detail"> & { stage?: Stage },
  ): DeliveryReport {
    return {
      service: this.options.service,
      contactPoint: this.options.contactPoint,
      ...fields,
      rule: this.rule,
      inbox: this.inbox,
      calls: [...this.calls],
    };
  }

  failed(stage: Stage, detail: string): DeliveryReport {
    return this.report({ status: "failed", stage, detail });
  }

  poll<T>(
    read: () => Promise<T | undefined>,
    deadline: number,
  ): Promise<T | undefined> {
    return awaitValue(read, deadline, this.deps, this.options.pollSeconds);
  }

  /** Refuses to fire when the metrics store has no rule for the service. */
  async preflight(): Promise<DeliveryReport | undefined> {
    this.note(labels.rules);
    const state = await this.deps.api.ruleState(
      this.options.service,
      alertName,
    );
    this.rule = ruleWord(state);
    if (state !== "absent") {
      return undefined;
    }
    return this.failed(
      "rule not loaded",
      "Prometheus has no " +
        alertName +
        " rule in group kore.service." +
        this.options.service +
        "; check that the service-observability chart is delivered and the metrics store mounts kore-service-rules",
    );
  }

  /** Runs every stage in order; the first that breaks ends the proof with its report. */
  async fireAndCheck(): Promise<DeliveryReport> {
    await this.fire();
    return (
      (await this.watchAlert()) ??
      (await this.checkContactPoint()) ??
      (await this.checkInbox())
    );
  }

  /** Scales every running Deployment in the namespace to zero, recording each for restore. */
  private async fire(): Promise<void> {
    const { api } = this.deps;
    this.note(labels.deployments);
    const original = await api.deployments(this.options.namespace);
    this.fired = this.deps.now();
    this.alertDeadline = this.fired + this.options.alertSeconds * 1000;
    for (const [name, replicas] of Object.entries(original)) {
      if (replicas > 0) {
        this.note(labels.scale);
        await api.scale(this.options.namespace, name, 0);
        this.scaledDown.push({ name, replicas });
      }
    }
  }

  /** Waits for the rule to fire and Grafana to show it routed to the contact point. */
  private async watchAlert(): Promise<DeliveryReport | undefined> {
    const { service, contactPoint } = this.options;
    const firing = await this.poll(async () => {
      this.note(labels.rules);
      const current = await this.deps.api.ruleState(service, alertName);
      this.rule = ruleWord(current);
      return current === "firing" ? true : undefined;
    }, this.alertDeadline);
    if (firing === undefined) {
      return this.failed(
        "rule not loaded",
        alertName +
          " was loaded but did not fire within " +
          String(this.options.alertSeconds) +
          " s after " +
          service +
          "'s Deployments were scaled to zero",
      );
    }
    const receivers = await this.poll(async () => {
      this.note(labels.alerts);
      return this.deps.api.alertReceivers(alertName, service);
    }, this.alertDeadline);
    if (receivers === undefined) {
      return this.failed(
        "alert not forwarded",
        "Grafana shows no " +
          alertName +
          " alert for " +
          service +
          " within " +
          String(this.options.alertSeconds) +
          " s; the metrics store did not forward it",
      );
    }
    if (!receivers.includes(contactPoint)) {
      return this.failed(
        "contact point failed",
        "Grafana routed " +
          alertName +
          " for " +
          service +
          " to " +
          (receivers.length > 0 ? receivers.join(", ") : "no receiver") +
          ", not to " +
          contactPoint,
      );
    }
    return undefined;
  }

  private async checkContactPoint(): Promise<DeliveryReport | undefined> {
    this.note(labels.contactPoints);
    const names = await this.deps.api.contactPointNames();
    if (names.includes(this.options.contactPoint)) {
      return undefined;
    }
    return this.failed(
      "contact point failed",
      "Grafana has no contact point " +
        this.options.contactPoint +
        "; its provisioning did not load",
    );
  }

  /** The inbox read is the only delivery evidence Grafana's API does not give (see grafanaDeliveryNote). */
  private async checkInbox(): Promise<DeliveryReport> {
    const { contactPoint, deliverySeconds } = this.options;
    const { inbox } = this.deps;
    if (inbox.kind === "skipped") {
      this.inbox = "skipped: " + inbox.reason;
      return this.report({
        status: "not confirmed",
        detail:
          "Grafana routed " +
          alertName +
          " to " +
          contactPoint +
          " and the contact point exists; " +
          grafanaDeliveryNote,
      });
    }
    this.note(labels.inbox);
    let arrived: true | undefined;
    try {
      arrived = await this.poll(
        async () => {
          const seen = await inbox.reader.arrivedSince(this.fired, alertName);
          return seen ? true : undefined;
        },
        this.deps.now() + deliverySeconds * 1000,
      );
    } catch (error) {
      this.inbox = "not checked";
      return this.report({
        status: "not confirmed",
        detail:
          "Grafana routed " +
          alertName +
          " to " +
          contactPoint +
          "; the inbox could not be read: " +
          messageOf(error),
      });
    }
    if (arrived !== true) {
      this.inbox = "not arrived";
      return this.failed(
        "contact point failed",
        "no " +
          alertName +
          " message reached the inbox within " +
          String(deliverySeconds) +
          " s after the alert fired",
      );
    }
    this.inbox = "arrived";
    return this.report({
      status: "delivered",
      detail:
        "Grafana routed " +
        alertName +
        " to " +
        contactPoint +
        " and the inbox holds its message",
    });
  }

  /** Puts each Deployment back at its replica count; a refused restore names the one to fix by hand. */
  async restore(): Promise<void> {
    for (const { name, replicas } of this.scaledDown) {
      this.note(labels.scale);
      try {
        await this.deps.api.scale(this.options.namespace, name, replicas);
      } catch (error) {
        throw new Error(
          "could not restore " +
            name +
            " in " +
            this.options.namespace +
            " to " +
            String(replicas) +
            " replicas; scale it back by hand: " +
            messageOf(error),
        );
      }
    }
  }
}

export async function proveAlertDelivery(
  deps: DeliveryDeps,
  options: DeliveryOptions,
): Promise<DeliveryReport> {
  const run = new Delivery(deps, options);
  const early = await run.preflight();
  if (early !== undefined) {
    return early;
  }
  let outcome: DeliveryReport;
  try {
    outcome = await run.fireAndCheck();
  } catch (error) {
    await run.restore();
    throw error;
  }
  await run.restore();
  return outcome;
}
