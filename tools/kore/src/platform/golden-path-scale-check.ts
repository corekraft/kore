import type { Runner } from "../runtime/index.js";
import { type Autoscaler, autoscalerOf } from "./golden-path-autoscaler.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { countRound, loadArgs } from "./route-load.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
//
// The scale check of plan 15 Step 3: the golden-path BFF scales out under the
// golden-path routes' load until it reaches the peak, the load stops, and it
// scales back in to its HorizontalPodAutoscaler's minimum (ADR 0047). Any failed
// request fails the check. The autoscaler moves the replica count, so the check
// writes nothing to the cluster: every call it makes is a read. It stops the load
// once the peak is reached, because the autoscaler scales in only after the CPU
// has fallen. Sequential rounds count requests the way the ingress measurement
// does (`route-load.ts`).

export interface ScaleCheckOptions {
  kubeContext: string;
  /** The service namespace, `<service>--<environment>`. */
  namespace: string;
  /** The BFF Deployment, `<service>-bff`. */
  deployment: string;
  /**
   * N: the ready replica count the run waits to see under load. It must be above
   * the autoscaler's minimum and at most its maximum.
   */
  peakReplicas: number;
  /** The golden-path Service's default host, `<service>.<organization>.<platformDomain>`. */
  hostname: string;
  port: number;
  /** The mkcert CAROOT directory; the load verifies the local CA. */
  caRoot: string;
  /** The published address the hostname resolves to; unset is loopback. */
  address?: string;
  requestsPerRoute: number;
  concurrency: number;
  /** The check is refused at or above this host 1-minute load average. */
  maxLoadAverage: number;
  /** Reads of the Deployment before a replica count is given up on. */
  maxPolls: number;
  pollIntervalSeconds: number;
}

/** Seconds past the scale-down window the scale-in waits before it may conclude. */
export const scaleInMarginSeconds = 60;
/** Seconds past that for the Pods to terminate, after which the scale-in is given up on. */
export const scaleInAllowanceSeconds = 120;

/**
 * The fixed method of the recorded baseline. The start and peak waits read
 * `maxPolls` times; the scale-in waits for the autoscaler's scale-down window.
 */
export const scaleCheckDefaults = {
  requestsPerRoute: 50,
  concurrency: 4,
  maxLoadAverage: 10,
  maxPolls: 120,
  pollIntervalSeconds: 5,
} as const;

export interface ScaleCheckDeps {
  sleep: (seconds: number) => Promise<void>;
  loadAverage: () => number;
  /** Milliseconds on a monotonic clock. */
  now: () => number;
}

export interface ScaleCheckResult {
  method: {
    routeSet: string;
    routes: string[];
    deployment: string;
    requestsPerRoute: number;
    concurrency: number;
  };
  /** The HorizontalPodAutoscaler's bounds and scale-down window on the BFF; the run starts and ends at its minimum. */
  autoscaler: {
    minReplicas: number;
    maxReplicas: number;
    scaleDownWindowSeconds: number;
  };
  /** Ready replicas: where the run began, the most it saw under load, and where it ended. */
  replicas: { start: number; peak: number; end: number };
  /** Every request answered its expected status, or the check failed. */
  load: { requests: number; failedRequests: 0; elapsedSeconds: number };
  loadAverage: { start: number };
  /** The host's load, swap, free VM memory and agent panes before and after. */
  host?: { before: HostSnapshot; after: HostSnapshot };
}

interface Replicas {
  total: number;
  ready: number;
}

const tenth = (value: number): number => Math.round(value * 10) / 10;
const reason = (error: unknown): string =>
  error instanceof Error ? error.message : JSON.stringify(error);

export class GoldenPathScaleCheck {
  private requests = 0;
  private peak = 0;
  private failure: unknown;

  constructor(
    private readonly runner: Runner,
    private readonly loadRunner: Runner,
    private readonly options: ScaleCheckOptions,
    private readonly deps: ScaleCheckDeps,
    private readonly host?: HostReader,
  ) {}

  /** Refuses a busy host or a missing autoscaler, then scales out and back under the golden-path load. */
  async run(): Promise<ScaleCheckResult> {
    const { maxLoadAverage } = this.options;
    const loadAverage = this.deps.loadAverage();
    if (loadAverage >= maxLoadAverage) {
      throw new Error(
        `host 1-minute load average ${loadAverage} is not below ${maxLoadAverage}; wait for the host to quiet down and rerun`,
      );
    }
    const before = await this.host?.read();
    const autoscaler = await this.requireAutoscaler();
    this.requirePeak(autoscaler);
    const result = await this.scale(autoscaler, loadAverage);
    const after = await this.host?.read();
    return before === undefined || after === undefined
      ? result
      : { ...result, host: { before, after } };
  }

  private async scale(
    autoscaler: Autoscaler,
    loadAverage: number,
  ): Promise<ScaleCheckResult> {
    const { minReplicas } = autoscaler;
    // The run starts only once the autoscaler has settled the BFF at its minimum.
    const start = await this.waitFor(
      minReplicas,
      "settled",
      (seen) =>
        `${this.subject()} has ${seen.ready} ready replicas after ${this.options.maxPolls} reads before any load, not its autoscaler's minimum of ${minReplicas}; the autoscaler has not settled at its minimum`,
    );
    const began = this.deps.now();
    const running = { value: true };
    const loading = this.loadUntil(() => running.value);
    let waited: unknown;
    try {
      await this.waitFor(
        this.options.peakReplicas,
        "ready",
        (seen) =>
          `${this.subject()} reached ${seen.ready} of ${this.options.peakReplicas} ready replicas after ${this.options.maxPolls} reads; check the autoscaler can scale out under load (its CPU is measured against the container's request) and the cluster has room`,
      );
    } catch (error) {
      waited = error;
    }
    running.value = false;
    await loading;
    const stopped = this.deps.now();
    this.throwFailure();
    if (waited !== undefined) {
      throw waited;
    }
    const end = await this.scaleIn(autoscaler, stopped);
    return this.result(autoscaler, start.ready, end, loadAverage, began);
  }

  /**
   * Reads the Deployment until the autoscaler has settled it at its minimum. The
   * scale-in cannot begin before the scale-down window has passed since the load
   * stopped, so the wait never concludes before the window plus a margin; it fails
   * once the window, the margin and the termination allowance have all passed.
   */
  private async scaleIn(
    { minReplicas, scaleDownWindowSeconds }: Autoscaler,
    stopped: number,
  ): Promise<Replicas> {
    const { pollIntervalSeconds } = this.options;
    const earliest =
      stopped + (scaleDownWindowSeconds + scaleInMarginSeconds) * 1000;
    const budgetSeconds =
      scaleDownWindowSeconds + scaleInMarginSeconds + scaleInAllowanceSeconds;
    let seen = await this.replicas();
    for (;;) {
      const now = this.deps.now();
      if (
        seen.ready === minReplicas &&
        seen.total === minReplicas &&
        now >= earliest
      ) {
        return seen;
      }
      if (now >= stopped + budgetSeconds * 1000) {
        throw new Error(
          `${this.subject()} still has ${seen.ready} ready replicas ${budgetSeconds} seconds after the load stopped, not its minimum of ${minReplicas}; the autoscaler has not scaled back in (its scale-down window is ${scaleDownWindowSeconds} s, plus a ${scaleInMarginSeconds} s margin and a ${scaleInAllowanceSeconds} s allowance for the Pods to terminate)`,
        );
      }
      await this.deps.sleep(pollIntervalSeconds);
      seen = await this.replicas();
    }
  }

  private result(
    autoscaler: Autoscaler,
    start: number,
    end: Replicas,
    loadAverage: number,
    began: number,
  ): ScaleCheckResult {
    return {
      method: this.method(),
      autoscaler: {
        minReplicas: autoscaler.minReplicas,
        maxReplicas: autoscaler.maxReplicas,
        scaleDownWindowSeconds: autoscaler.scaleDownWindowSeconds,
      },
      replicas: { start, peak: this.peak, end: end.ready },
      load: {
        requests: this.requests,
        failedRequests: 0,
        elapsedSeconds: tenth((this.deps.now() - began) / 1000),
      },
      loadAverage: { start: loadAverage },
    };
  }

  private subject(): string {
    return `${this.options.namespace}/${this.options.deployment}`;
  }

  private failureError(): Error | undefined {
    return this.failure === undefined
      ? undefined
      : new Error(
          `a request failed during the scale check of ${this.subject()}: ${reason(this.failure)}`,
        );
  }

  private throwFailure(): void {
    const failure = this.failureError();
    if (failure !== undefined) {
      throw failure;
    }
  }

  private method(): ScaleCheckResult["method"] {
    const { requestsPerRoute, concurrency } = this.options;
    return {
      routeSet: goldenPathRouteSet.name,
      routes: goldenPathRouteSet.routes.map((route) => route.path),
      deployment: this.subject(),
      requestsPerRoute,
      concurrency,
    };
  }

  private kubectl(args: string[]): Promise<{ stdout: string }> {
    return this.runner.run(
      "kubectl",
      [
        "--context",
        this.options.kubeContext,
        "--namespace",
        this.options.namespace,
        ...args,
      ],
      { capture: true },
    );
  }

  /**
   * Reads the HorizontalPodAutoscaler that targets the BFF and refuses before any
   * load when none does: the chart creates one only while autoscaling-defaults is
   * on, and without one no scale-out can be measured.
   */
  private async requireAutoscaler(): Promise<Autoscaler> {
    const { stdout } = await this.kubectl(["get", "hpa", "--output", "json"]);
    const autoscaler = autoscalerOf(stdout, this.options.deployment);
    if (autoscaler === undefined) {
      throw new Error(
        `${this.subject()} has no HorizontalPodAutoscaler that targets it; the golden-path-workload chart creates one only while autoscaling-defaults is on (ADR 0047), so no scale-out can be measured; turn the flag on, let the sync converge, then rerun`,
      );
    }
    return autoscaler;
  }

  /** Refuses a peak the autoscaler could never reach, or one that is no scale-out at all. */
  private requirePeak({ minReplicas, maxReplicas }: Autoscaler): void {
    const { peakReplicas } = this.options;
    if (peakReplicas <= minReplicas) {
      throw new Error(
        `peak replicas ${peakReplicas} must be above the autoscaler's minimum ${minReplicas}; pass a larger KORE_SCALE_PEAK_REPLICAS`,
      );
    }
    if (peakReplicas > maxReplicas) {
      throw new Error(
        `peak replicas ${peakReplicas} is above the autoscaler's maximum ${maxReplicas}; pass a KORE_SCALE_PEAK_REPLICAS of at most ${maxReplicas}`,
      );
    }
  }

  private async replicas(): Promise<Replicas> {
    const { stdout } = await this.kubectl([
      "get",
      "deployment",
      this.options.deployment,
      "--output",
      "json",
    ]);
    const parsed = JSON.parse(stdout) as {
      status?: { replicas?: number; readyReplicas?: number };
    };
    return {
      total: parsed.status?.replicas ?? 0,
      ready: parsed.status?.readyReplicas ?? 0,
    };
  }

  /**
   * Reads the Deployment until it has `count` ready replicas (`ready`) or exactly
   * `count` with none still starting or stopping (`settled`), noting the most
   * ready replicas it has seen. A failed request ends the wait early.
   */
  private async waitFor(
    count: number,
    until: "ready" | "settled",
    message: (seen: Replicas) => string,
  ): Promise<Replicas> {
    const { maxPolls, pollIntervalSeconds } = this.options;
    let seen = await this.replicas();
    for (let poll = 1; poll <= maxPolls; poll++) {
      this.peak = Math.max(this.peak, seen.ready);
      const reached =
        until === "ready"
          ? seen.ready >= count
          : seen.ready === count && seen.total === count;
      if (reached || this.failure !== undefined) {
        return seen;
      }
      if (poll < maxPolls) {
        await this.deps.sleep(pollIntervalSeconds);
        seen = await this.replicas();
      }
    }
    throw new Error(message(seen));
  }

  /** Repeats the golden-path rounds until `running` turns false; the first failure ends the load. */
  private async loadUntil(running: () => boolean): Promise<void> {
    const { requestsPerRoute } = this.options;
    try {
      do {
        for (const route of goldenPathRouteSet.routes) {
          const { stdout } = await this.loadRunner.run(
            "curl",
            loadArgs(this.options, route.path),
            { capture: true },
          );
          this.requests += countRound(route, stdout, requestsPerRoute);
          if (!running()) {
            return;
          }
        }
      } while (running());
    } catch (error) {
      this.failure = error;
    }
  }
}
