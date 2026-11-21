// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { awaitValue } from "./alert-delivery-poll.live.js";
import {
  alertName,
  callLabels,
  type RuleState,
} from "./alert-delivery-api.live.js";
import type {
  DeliveryDeps,
  DeliveryOptions,
  DeliveryReport,
  Stage,
} from "./alert-delivery-types.live.js";

// The live alert proof: fires the default ServiceUnavailable rule on one delivered Service by scaling its
// Deployments to zero, follows the alert through the metrics store, Grafana and the contact point, and
// restores the Deployments. It names the broken stage, and it reports only the contact point's name.

const grafanaDeliveryNote = "Grafana's API offers no delivery state to read";

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
    this.note(callLabels.rules);
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

  /** Records each running Deployment's replica count, then scales it to zero, so a later run can restore it. */
  private async fire(): Promise<void> {
    const { api } = this.deps;
    const { namespace } = this.options;
    this.note(callLabels.deployments);
    const original = await api.deployments(namespace);
    this.fired = this.deps.now();
    this.alertDeadline = this.fired + this.options.alertSeconds * 1000;
    for (const [name, state] of Object.entries(original)) {
      if (state.replicas > 0) {
        this.note(callLabels.annotate);
        await api.record(namespace, name, state.replicas);
        this.scaledDown.push({ name, replicas: state.replicas });
        this.note(callLabels.scale);
        await api.scale(namespace, name, 0);
      }
    }
  }

  /** Waits for the rule to fire and Grafana to show it routed to the contact point. */
  private async watchAlert(): Promise<DeliveryReport | undefined> {
    const { service, contactPoint } = this.options;
    const firing = await this.poll(async () => {
      this.note(callLabels.rules);
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
      this.note(callLabels.alerts);
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
    this.note(callLabels.contactPoints);
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
    this.note(callLabels.inbox);
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

  /** Restores the Deployments a killed run left at zero, from the count each recorded, before anything else. */
  async recover(): Promise<void> {
    this.note(callLabels.deployments);
    const found = await this.deps.api.deployments(this.options.namespace);
    const leftovers = Object.entries(found).flatMap(([name, state]) =>
      state.recorded === undefined ? [] : [{ name, replicas: state.recorded }],
    );
    await this.restoreEach(leftovers);
  }

  /** Puts back each Deployment this run scaled to zero and clears its record; a refusal throws with `stopped` appended. */
  async restore(stopped: string): Promise<void> {
    try {
      await this.restoreEach(this.scaledDown);
    } catch (error) {
      throw new Error(messageOf(error) + stopped);
    }
  }

  /** Tries every Deployment, then throws one error naming each refused restore; a record stays until its restore works. */
  private async restoreEach(
    entries: readonly { name: string; replicas: number }[],
  ): Promise<void> {
    const { api } = this.deps;
    const { namespace } = this.options;
    const refused: string[] = [];
    for (const { name, replicas } of entries) {
      try {
        this.note(callLabels.scale);
        await api.scale(namespace, name, replicas);
        this.note(callLabels.annotate);
        await api.forget(namespace, name);
      } catch (error) {
        refused.push(
          name +
            " to " +
            String(replicas) +
            " replicas (" +
            messageOf(error) +
            ")",
        );
      }
    }
    if (refused.length > 0) {
      throw new Error(
        "could not restore these Deployments in " +
          namespace +
          "; scale them back by hand: " +
          refused.join("; "),
      );
    }
  }
}

export async function proveAlertDelivery(
  deps: DeliveryDeps,
  options: DeliveryOptions,
): Promise<DeliveryReport> {
  const run = new Delivery(deps, options);
  await run.recover();
  const early = await run.preflight();
  if (early !== undefined) {
    return early;
  }
  let outcome: DeliveryReport;
  try {
    outcome = await run.fireAndCheck();
  } catch (error) {
    await run.restore("; the proof stopped first with: " + messageOf(error));
    throw error;
  }
  const { stage, detail } = outcome;
  await run.restore(
    stage === undefined
      ? ""
      : "; the proof ended at stage " + stage + ": " + detail,
  );
  return outcome;
}
