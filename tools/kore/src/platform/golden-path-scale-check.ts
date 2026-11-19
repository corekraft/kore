import type { Runner } from "../runtime/index.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { countRound, loadArgs } from "./route-load.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
//
// The scale check of plan 15 Step 3: the golden-path BFF grows from its
// starting replica count to N and back while the golden-path routes carry
// load, and any failed request fails the check. It is a test helper: the one
// cluster write is `kubectl scale` on the named Deployment, addressed by the
// configured context and namespace and put back to the starting count however
// the check ends. Sequential rounds count requests the way the ingress
// measurement does (`route-load.ts`).

export interface ScaleCheckOptions {
  kubeContext: string;
  /** The service namespace, `<service>--<environment>`. */
  namespace: string;
  /** The BFF Deployment, `<service>-bff`. */
  deployment: string;
  /**
   * The replica count the run sets before the load starts and returns to.
   * Unset keeps the count the Deployment has, and records it.
   */
  startReplicas?: number;
  /** N: the ready replica count the run grows to. */
  peakReplicas: number;
  /** The golden-path Service's default host, `<service>.<organization>.<platformDomain>`. */
  hostname: string;
  port: number;
  /** The mkcert CAROOT directory; the load verifies the local CA. */
  caRoot: string;
  requestsPerRoute: number;
  concurrency: number;
  /** The check is refused at or above this host 1-minute load average. */
  maxLoadAverage: number;
  /** Reads of the Deployment before a replica count is given up on. */
  maxPolls: number;
  pollIntervalSeconds: number;
}

/** The fixed method of the recorded baseline. */
export const scaleCheckDefaults = {
  requestsPerRoute: 50,
  concurrency: 4,
  maxLoadAverage: 10,
  maxPolls: 60,
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
  /** Ready replicas: where the run began, the most it saw, and where it ended. */
  replicas: { start: number; requestedPeak: number; peak: number; end: number };
  /** Every request answered its expected status, or the check failed. */
  load: { requests: number; failedRequests: 0; elapsedSeconds: number };
  loadAverage: { start: number };
  /** The host's load, swap, free VM memory and agent panes before and after. */
  host?: { before: HostSnapshot; after: HostSnapshot };
}

interface Replicas {
  desired: number;
  total: number;
  ready: number;
}

const tenth = (value: number): number => Math.round(value * 10) / 10;

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

  /** Refuses a busy host, then scales out and back under the golden-path load. */
  async run(): Promise<ScaleCheckResult> {
    const { startReplicas, peakReplicas, maxLoadAverage } = this.options;
    if (startReplicas !== undefined && peakReplicas <= startReplicas) {
      throw new Error(
        `peak replicas ${peakReplicas} must be above the starting count ${startReplicas}; pass a larger KORE_SCALE_PEAK_REPLICAS`,
      );
    }
    const loadAverage = this.deps.loadAverage();
    if (loadAverage >= maxLoadAverage) {
      throw new Error(
        `host 1-minute load average ${loadAverage} is not below ${maxLoadAverage}; wait for the host to quiet down and rerun`,
      );
    }
    const before = await this.host?.read();
    const result = await this.scale(loadAverage);
    const after = await this.host?.read();
    return before === undefined || after === undefined
      ? result
      : { ...result, host: { before, after } };
  }

  private async scale(loadAverage: number): Promise<ScaleCheckResult> {
    const { peakReplicas } = this.options;
    const start = this.options.startReplicas ?? (await this.replicas()).desired;
    if (peakReplicas <= start) {
      throw new Error(
        `peak replicas ${peakReplicas} must be above the starting count ${start}; pass a larger KORE_SCALE_PEAK_REPLICAS`,
      );
    }
    const running = { value: true };
    let loading: Promise<void> | undefined;
    let scaled = false;
    try {
      await this.scaleTo(start);
      scaled = true;
      await this.waitFor(start, "settled");
      const began = this.deps.now();
      loading = this.loadUntil(() => running.value);
      const end = await this.outAndBack(start);
      running.value = false;
      await loading;
      this.throwFailure();
      return this.result(start, end, loadAverage, began);
    } catch (error) {
      running.value = false;
      await loading;
      // A request that failed is the cause, not the stop it forced.
      this.throwFailure();
      // Put the Deployment back to where the run found it.
      if (scaled) {
        await this.scaleTo(start);
      }
      throw error;
    }
  }

  /** Grows to the peak, then returns to `start`, reading the counts reached. */
  private async outAndBack(start: number): Promise<Replicas> {
    await this.scaleTo(this.options.peakReplicas);
    await this.waitFor(this.options.peakReplicas, "ready");
    await this.scaleTo(start);
    return this.waitFor(start, "settled");
  }

  private result(
    start: number,
    end: Replicas,
    loadAverage: number,
    began: number,
  ): ScaleCheckResult {
    return {
      method: this.method(),
      replicas: {
        start,
        requestedPeak: this.options.peakReplicas,
        peak: this.peak,
        end: end.ready,
      },
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

  private throwFailure(): void {
    if (this.failure !== undefined) {
      const reason =
        this.failure instanceof Error
          ? this.failure.message
          : JSON.stringify(this.failure);
      throw new Error(
        `a request failed during the scale check of ${this.subject()}: ${reason}`,
      );
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

  private scaleTo(replicas: number): Promise<unknown> {
    return this.kubectl([
      "scale",
      `deployment/${this.options.deployment}`,
      `--replicas=${replicas}`,
    ]);
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
      spec?: { replicas?: number };
      status?: { replicas?: number; readyReplicas?: number };
    };
    return {
      desired: parsed.spec?.replicas ?? 0,
      total: parsed.status?.replicas ?? 0,
      ready: parsed.status?.readyReplicas ?? 0,
    };
  }

  /**
   * Reads the Deployment until it has `count` ready replicas (`ready`) and no
   * others still starting or stopping (`settled`), noting the most it saw.
   */
  private async waitFor(
    count: number,
    until: "ready" | "settled",
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
    throw new Error(
      `${this.subject()} reached ${seen.ready} of ${count} ready replicas after ${maxPolls} reads; check the sync is not reverting the scale and the cluster has room`,
    );
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
