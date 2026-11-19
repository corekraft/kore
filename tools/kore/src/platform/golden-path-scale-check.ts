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
// configured context and namespace and put back to the count it had before the
// first write, whether that is the starting count or not, however the check ends. Sequential rounds count requests the way the ingress
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
    // The count the Deployment has before the first write is the one put back.
    const found = (await this.replicas()).desired;
    const start = this.options.startReplicas ?? found;
    if (peakReplicas <= start) {
      throw new Error(
        `peak replicas ${peakReplicas} must be above the starting count ${start}; pass a larger KORE_SCALE_PEAK_REPLICAS`,
      );
    }
    const written = { value: false };
    try {
      const result = await this.underLoad(start, loadAverage, written);
      if (start !== found) {
        await this.scaleTo(found);
      }
      return result;
    } catch (error) {
      throw await this.restored(this.failureError() ?? error, found, written);
    }
  }

  /** Sets the starting count, then scales out and back while the load runs. */
  private async underLoad(
    start: number,
    loadAverage: number,
    written: { value: boolean },
  ): Promise<ScaleCheckResult> {
    const running = { value: true };
    let loading: Promise<void> | undefined;
    try {
      written.value = true;
      await this.scaleTo(start);
      await this.waitFor(start, "settled");
      const began = this.deps.now();
      loading = this.loadUntil(() => running.value);
      const end = await this.outAndBack(start);
      running.value = false;
      await loading;
      this.throwFailure();
      return this.result(start, end, loadAverage, began);
    } finally {
      running.value = false;
      await loading;
    }
  }

  /**
   * Puts the Deployment back to the count it was found with once a write was
   * attempted. A restore that fails is named beside the original error and
   * never replaces it.
   */
  private async restored(
    error: unknown,
    found: number,
    written: { value: boolean },
  ): Promise<unknown> {
    if (!written.value) {
      return error;
    }
    try {
      await this.scaleTo(found);
      return error;
    } catch (restoreError) {
      return new Error(
        `${reason(error)}; restoring ${this.subject()} to ${found} replicas also failed: ${reason(restoreError)}; scale it back by hand`,
      );
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
