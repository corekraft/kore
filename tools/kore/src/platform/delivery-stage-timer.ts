import type { Runner } from "../runtime/index.js";
import {
  mergedMilliseconds,
  stageTimes,
  type DeliveryStage,
  type StageEnds,
  type StageTime,
} from "./delivery-stage-timeline.js";

export { deliveryStages } from "./delivery-stage-timeline.js";
export type { DeliveryStage, StageTime } from "./delivery-stage-timeline.js";

// Docs: infra/plans/15-next-horizon.md (Step 7)
//
// The delivery-stage timer (#1113): times a merged Service change to a working
// HTTPS address in six stages, each end read from cluster state. The clock starts
// at the merge, so the tenant build is never counted; a stage with no readable time
// source fails the run by name. Read-only: `kubectl get`.

export interface DeliveryTimerOptions {
  /** The Service's name, for example `shop`. */
  service: string;
  /** The Kore environment, for example `local`; the namespace is `<service>--<environment>`. */
  environment: string;
  /** The kubectl context the reads go to, for example `k3d-kore-local`. */
  kubeContext: string;
  /** The HTTPS address the Service answers on, reported as is. */
  host: string;
  /** The merge time of the Service change, RFC 3339. The clock starts here. */
  mergedAt: string;
}

export interface DeliveryTimerDeps {
  /** Milliseconds since the epoch, for the run's measuredAt. */
  now: () => number;
}

export interface DeliveryRun {
  series: "cold" | "redeploy";
  service: string;
  host: string;
  mergedAt: string;
  measuredAt: string;
  stages: StageTime[];
  totalSeconds: number;
  excluded: readonly ["tenant build"];
}

/** The two series, kept apart: a redeploy never hides a slow first delivery. */
export interface DeliveryReport {
  cold: DeliveryRun[];
  redeploy: DeliveryRun[];
}

interface Resource {
  metadata?: { creationTimestamp?: unknown };
  status?: {
    operationState?: { finishedAt?: unknown };
    conditions?: unknown;
    parents?: { conditions?: unknown[] }[];
  };
  items?: unknown;
}

export class DeliveryStageTimer {
  constructor(
    private readonly runner: Runner,
    private readonly options: DeliveryTimerOptions,
    private readonly deps: DeliveryTimerDeps,
  ) {}

  /** Reads the six time sources and returns the run in its series. */
  async measure(): Promise<DeliveryReport> {
    const merged = mergedMilliseconds(this.options.mergedAt);
    const ends = await this.stageEnds();
    const namespaceCreated = ends[0]?.[1] ?? merged;
    const run: DeliveryRun = {
      series: namespaceCreated >= merged ? "cold" : "redeploy",
      service: this.options.service,
      host: this.options.host,
      mergedAt: this.options.mergedAt,
      measuredAt: new Date(this.deps.now()).toISOString(),
      ...stageTimes(merged, ends),
      excluded: ["tenant build"],
    };
    return {
      cold: run.series === "cold" ? [run] : [],
      redeploy: run.series === "redeploy" ? [run] : [],
    };
  }

  private async stageEnds(): Promise<StageEnds> {
    const { service, environment } = this.options;
    const namespace = `${service}--${environment}`;
    const nsCreated = await this.namespaceEnd(namespace);
    const synced = await this.syncEnd(service);
    const admitted = await this.admissionEnd(service, namespace);
    const certReady = await this.certificateEnd(service, namespace);
    const { rolledOut, available } = await this.rolloutEnds(service, namespace);
    return [
      ["namespace", nsCreated],
      ["sync", synced],
      ["admission", admitted],
      ["certificate", certReady],
      ["rollout", rolledOut],
      ["readiness", available],
    ];
  }

  /** The namespace's creation time: the namespace stage's end, and the cold or redeploy test. */
  private async namespaceEnd(namespace: string): Promise<number> {
    const ns = await this.read<Resource>(
      "namespace",
      `the namespace ${namespace}`,
      ["get", "namespace", namespace, "-o", "json"],
    );
    return this.timestamp(
      "namespace",
      `namespace ${namespace} creationTimestamp`,
      ns.metadata?.creationTimestamp,
    );
  }

  /** The Argo CD sync that delivered the Service: its operation's finish. */
  private async syncEnd(service: string): Promise<number> {
    const application = `golden-path-${service}`;
    const app = await this.read<Resource>(
      "sync",
      `the Argo CD Application ${application}`,
      ["-n", "argocd", "get", "application", application, "-o", "json"],
    );
    return this.timestamp(
      "sync",
      `Application ${application} operationState.finishedAt`,
      app.status?.operationState?.finishedAt,
    );
  }

  /** The first pod stored: the admission chain accepted it before the apiserver stored it. */
  private async admissionEnd(
    service: string,
    namespace: string,
  ): Promise<number> {
    const selector = `app.kubernetes.io/part-of=${service}`;
    const pods = await this.read<Resource>(
      "admission",
      `the pods of ${service}`,
      ["-n", namespace, "get", "pods", "-l", selector, "-o", "json"],
    );
    return this.earliest(
      "admission",
      `pods of ${service} creationTimestamp`,
      pods.items,
    );
  }

  /**
   * The certificate stage's end. A Service on the shared Gateway has no
   * certificate of its own: its end is the shared HTTPRoute's Accepted=True
   * transition. A Service with no shared route (a host outside the platform
   * domain) ends at its own Certificate's Ready=True transition. The platform
   * wildcard Certificate is never read: it predates every merge.
   */
  private async certificateEnd(
    service: string,
    namespace: string,
  ): Promise<number> {
    const route = `${service}-shared`;
    const shared = await this.present<Resource>(
      "certificate",
      `the HTTPRoute ${route}`,
      ["-n", namespace, "get", "httproute", route, "-o", "json"],
    );
    if (shared !== undefined) {
      const parents = shared.status?.parents ?? [];
      return this.condition(
        "certificate",
        `HTTPRoute ${route}`,
        parents.flatMap((parent) => parent.conditions ?? []),
        "Accepted",
        "lastTransitionTime",
      );
    }
    const certificate = `${service}-tls`;
    const cert = await this.present<Resource>(
      "certificate",
      `the certificate ${certificate}`,
      ["-n", namespace, "get", "certificate", certificate, "-o", "json"],
    );
    if (cert === undefined) {
      throw new Error(
        `delivery stage "certificate" has no time source: neither the HTTPRoute ${route} nor the Certificate ${certificate} exists in ${namespace}; check that the Service's route or certificate is applied`,
      );
    }
    return this.condition(
      "certificate",
      `Certificate ${certificate}`,
      cert.status?.conditions,
      "Ready",
      "lastTransitionTime",
    );
  }

  /** A source that may be absent: kubectl's NotFound is undefined; any other failed read still fails. */
  private async present<T>(
    stage: DeliveryStage,
    subject: string,
    args: string[],
  ): Promise<T | undefined> {
    try {
      return await this.read<T>(stage, subject, args);
    } catch (error) {
      if (error instanceof Error && /\(NotFound\)/.test(error.message)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The rollout's end is the latest Progressing update across the Service's
   * deployments; readiness's end is the latest Available transition.
   */
  private async rolloutEnds(
    service: string,
    namespace: string,
  ): Promise<{ rolledOut: number; available: number }> {
    const selector = `app.kubernetes.io/part-of=${service}`;
    const deployments = await this.read<Resource>(
      "rollout",
      `the deployments of ${service}`,
      ["-n", namespace, "get", "deployments", "-l", selector, "-o", "json"],
    );
    return {
      rolledOut: this.latestCondition(
        "rollout",
        service,
        deployments.items,
        "Progressing",
        "lastUpdateTime",
      ),
      available: this.latestCondition(
        "readiness",
        service,
        deployments.items,
        "Available",
        "lastTransitionTime",
      ),
    };
  }

  /** Runs one read-only kubectl get; a failed read names the stage and what it was reading. */
  private async read<T>(
    stage: DeliveryStage,
    subject: string,
    args: string[],
  ): Promise<T> {
    const { kubeContext } = this.options;
    try {
      const { stdout } = await this.runner.run(
        "kubectl",
        ["--context", kubeContext, ...args],
        { capture: true },
      );
      return JSON.parse(stdout) as T;
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `delivery stage "${stage}" has no time source: reading ${subject} failed: ${cause}; check that kubectl can reach the ${kubeContext} context`,
      );
    }
  }

  private timestamp(
    stage: DeliveryStage,
    what: string,
    value: unknown,
  ): number {
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    if (Number.isNaN(parsed)) {
      throw new Error(
        `delivery stage "${stage}" has no time source: ${what} is missing or not a timestamp`,
      );
    }
    return parsed;
  }

  private earliest(stage: DeliveryStage, what: string, items: unknown): number {
    const list = Array.isArray(items) ? (items as Resource[]) : [];
    if (list.length === 0) {
      throw new Error(
        `delivery stage "${stage}" has no time source: ${what} has no items`,
      );
    }
    return Math.min(
      ...list.map((item) =>
        this.timestamp(stage, what, item.metadata?.creationTimestamp),
      ),
    );
  }

  /** The latest transition of the named condition across the Service's deployments. */
  private latestCondition(
    stage: DeliveryStage,
    service: string,
    items: unknown,
    type: string,
    field: string,
  ): number {
    const list = Array.isArray(items) ? (items as Resource[]) : [];
    if (list.length === 0) {
      throw new Error(
        `delivery stage "${stage}" has no time source: deployments of ${service} ${type} ${field} has no items`,
      );
    }
    return Math.max(
      ...list.map((item) =>
        this.condition(
          stage,
          `a deployment of ${service}`,
          item.status?.conditions,
          type,
          field,
        ),
      ),
    );
  }

  /** The time of the named condition's transition, when its status is True. */
  private condition(
    stage: DeliveryStage,
    what: string,
    conditions: unknown,
    type: string,
    field: string,
  ): number {
    const list = Array.isArray(conditions)
      ? (conditions as Record<string, unknown>[])
      : [];
    const match = list.find(
      (condition) =>
        condition["type"] === type && condition["status"] === "True",
    );
    if (match === undefined) {
      throw new Error(
        `delivery stage "${stage}" has no time source: ${what} has no True ${type} condition`,
      );
    }
    return this.timestamp(stage, `${what} ${field}`, match[field]);
  }
}
