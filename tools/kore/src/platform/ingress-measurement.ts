import type { Runner } from "../runtime/index.js";
import { parsePodMetrics, summarizeSamples } from "./ingress-metrics.js";
import type { PodUsage } from "./ingress-metrics.js";
import { summarizeLatency } from "./ingress-metrics.js";
import { probeLatency } from "./ingress-probe.js";
import { ingressRoutes } from "./ingress-routes.js";
import type {
  Measurement,
  MeasurementDeps,
  MeasurementOptions,
  Sample,
} from "./ingress-measurement-types.js";
import { cpuPerRequest, matchRate, pacingPlan } from "./ingress-pacing.js";

export { ingressRoutes } from "./ingress-routes.js";
export { ingressMeasurementDefaults } from "./ingress-measurement-types.js";
export type {
  Measurement,
  MeasurementDeps,
  MeasurementOptions,
  Sample,
} from "./ingress-measurement-types.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The ingress resource measurement of plan 13: CPU and memory of the pods
// serving the platform Gateway, and of ztunnel in its own column, sampled from
// the cluster's metrics API while a fixed request load runs. Step 1 records it
// against Istio and Step 4 repeats it against agentgateway, so everything that
// could vary is a stated option. Cluster access is read-only
// (`kubectl get --raw` on the metrics API); the only other process is curl,
// sending GET requests to the Gateway.

/** ztunnel is measured beside the ingress: it stays through the switch. */
const ztunnel = {
  namespace: "istio-system",
  selector: "app.kubernetes.io/name=ztunnel",
};

const gatewayLabel = "gateway.networking.k8s.io/gateway-name";
const tenth = (value: number): number => Math.round(value * 10) / 10;

export class IngressMeasurement {
  private requests = 0;
  private readonly pacing?: { batchSize: number; batchSeconds: number };

  constructor(
    private readonly runner: Runner,
    private readonly loadRunner: Runner,
    private readonly options: MeasurementOptions,
    private readonly deps: MeasurementDeps,
  ) {
    const target = options.targetRequestsPerSecond;
    if (target !== undefined) {
      this.pacing = pacingPlan(target, options.requestsPerRoute);
    }
  }

  /** Settles, then samples the pods while the fixed load runs. */
  async measure(): Promise<Measurement> {
    const start = this.deps.loadAverage();
    if (start >= this.options.maxLoadAverage) {
      throw new Error(
        `host 1-minute load average ${start} is not below ${this.options.maxLoadAverage}; wait for the host to quiet down and rerun`,
      );
    }
    await this.deps.sleep(this.options.settleSeconds);
    const began = this.deps.now();
    let running = true;
    const loading = this.loadUntil(() => running).then(
      () => undefined,
      (error: unknown) => error,
    );
    const samples: Sample[] = [];
    const probeMilliseconds: number[] = [];
    try {
      for (let index = 0; index < this.options.sampleCount; index++) {
        await this.deps.sleep(this.options.sampleIntervalSeconds);
        samples.push(await this.sample());
        probeMilliseconds.push(
          ...(await probeLatency(this.loadRunner, this.options)),
        );
      }
    } finally {
      running = false;
    }
    const loadError = await loading;
    const elapsedSeconds = tenth((this.deps.now() - began) / 1000);
    if (loadError !== undefined) {
      throw this.loadFailure(loadError);
    }
    return this.report({ start, samples, probeMilliseconds, elapsedSeconds });
  }

  private report(run: {
    start: number;
    samples: Sample[];
    probeMilliseconds: number[];
    elapsedSeconds: number;
  }): Measurement {
    const { start, samples, probeMilliseconds, elapsedSeconds } = run;
    const names = (pick: (sample: Sample) => PodUsage[]) =>
      [...new Set(samples.flatMap(pick).map((pod) => pod.name))].sort();
    const requestsPerSecond = tenth(this.requests / elapsedSeconds);
    const target = this.options.targetRequestsPerSecond;
    const ingressSummary = summarizeSamples(
      samples.map((sample) => sample.ingress),
    );
    const ztunnelSummary = summarizeSamples(
      samples.map((sample) => sample.ztunnel),
    );
    return {
      method: this.method(),
      load: {
        requests: this.requests,
        elapsedSeconds,
        requestsPerSecond,
      },
      ...(target !== undefined
        ? { rate: matchRate(target, requestsPerSecond) }
        : {}),
      cpuPerRequest: cpuPerRequest(
        {
          ingress: ingressSummary.cpuMillicores.median,
          ztunnel: ztunnelSummary.cpuMillicores.median,
        },
        requestsPerSecond,
      ),
      loadAverage: {
        start,
        max: Math.max(start, ...samples.map((sample) => sample.loadAverage)),
      },
      pods: {
        ingress: names((sample) => sample.ingress),
        ztunnel: names((sample) => sample.ztunnel),
      },
      samples,
      summary: { ingress: ingressSummary, ztunnel: ztunnelSummary },
      ...(probeMilliseconds.length > 0
        ? { latency: summarizeLatency(probeMilliseconds) }
        : {}),
    };
  }

  private loadFailure(error: unknown): Error {
    const { hostname, port } = this.options;
    const reason =
      error instanceof Error ? error.message : JSON.stringify(error);
    return new Error(
      `the request load to https://${hostname}:${port} failed: ${reason}; check that kore local up converged and the k3d load balancer maps port ${port}`,
    );
  }

  private method(): Measurement["method"] {
    const { gateway, requestsPerRoute, concurrency, settleSeconds } =
      this.options;
    return {
      gateway: `${gateway.namespace}/${gateway.name}`,
      routes: ingressRoutes.map((route) => route.path),
      requestsPerRoute,
      concurrency,
      settleSeconds,
      sampleCount: this.options.sampleCount,
      sampleIntervalSeconds: this.options.sampleIntervalSeconds,
      ...(this.pacing !== undefined
        ? {
            targetRequestsPerSecond: this.options.targetRequestsPerSecond,
            batchSize: this.pacing.batchSize,
          }
        : {}),
    };
  }

  private async sample(): Promise<Sample> {
    const { gateway } = this.options;
    const loadAverage = this.deps.loadAverage();
    const ingress = await this.podMetrics(
      gateway.namespace,
      `${gatewayLabel}=${gateway.name}`,
      "the Gateway's pods run",
    );
    const mesh = await this.podMetrics(
      ztunnel.namespace,
      ztunnel.selector,
      "ztunnel runs",
    );
    return { loadAverage, ingress, ztunnel: mesh };
  }

  private async podMetrics(
    namespace: string,
    selector: string,
    subject: string,
  ): Promise<PodUsage[]> {
    const { stdout } = await this.runner.run(
      "kubectl",
      [
        "--context",
        this.options.kubeContext,
        "get",
        "--raw",
        `/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(selector)}`,
      ],
      { capture: true },
    );
    const pods = parsePodMetrics(stdout);
    if (pods.length === 0) {
      throw new Error(
        `no pod metrics for ${selector} in ${namespace}; check that ${subject} and the metrics API (metrics-server) answers`,
      );
    }
    return pods;
  }

  /** Repeats the fixed load rounds until `running` turns false. */
  private async loadUntil(running: () => boolean): Promise<void> {
    do {
      for (const route of ingressRoutes) {
        const batchStart = this.deps.now();
        const { stdout } = await this.loadRunner.run(
          "curl",
          this.curlArgs(route.path),
          { capture: true },
        );
        this.checkRound(route, stdout);
        if (!running()) {
          return;
        }
        await this.pace(batchStart);
      }
    } while (running());
  }

  /** Sleeps out the rest of a paced batch's slot; a slow batch gets none. */
  private async pace(batchStart: number): Promise<void> {
    if (this.pacing === undefined) {
      return;
    }
    const elapsed = (this.deps.now() - batchStart) / 1000;
    const wait = Math.round((this.pacing.batchSeconds - elapsed) * 1000) / 1000;
    if (wait > 0) {
      await this.deps.sleep(wait);
    }
  }

  private get batch(): number {
    return this.pacing?.batchSize ?? this.options.requestsPerRoute;
  }

  /** Counts a round's requests; any wrong or missing status fails the measurement. */
  private checkRound(
    route: (typeof ingressRoutes)[number],
    stdout: string,
  ): void {
    const sent = this.batch;
    const statuses = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map(Number);
    const wrong = statuses.filter((status) => status !== route.status);
    if (wrong.length > 0) {
      throw new Error(
        `route ${route.path} answered ${wrong[0]} for ${wrong.length} of ${sent} requests, expected ${route.status}`,
      );
    }
    if (statuses.length !== sent) {
      throw new Error(
        `route ${route.path} completed ${statuses.length} of ${sent} requests`,
      );
    }
    this.requests += statuses.length;
  }

  private curlArgs(path: string): string[] {
    const { hostname, port, caRoot, concurrency } = this.options;
    const requestsPerRoute = this.batch;
    return [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}\\n",
      "--connect-timeout",
      "5",
      "--max-time",
      "60",
      "--cacert",
      `${caRoot}/rootCA.pem`,
      "--resolve",
      `${hostname}:${port}:127.0.0.1`,
      "--parallel",
      "--parallel-max",
      String(concurrency),
      // The glob is in the fragment: curl repeats the request, but the path
      // and query the Gateway routes and authorizes on stay exactly the route's.
      `https://${hostname}:${port}${path}#[1-${requestsPerRoute}]`,
    ];
  }
}
