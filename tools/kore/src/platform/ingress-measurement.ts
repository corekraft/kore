import type { Runner } from "../runtime/index.js";
import { parsePodMetrics, summarizeSamples } from "./ingress-metrics.js";
import type { MeasurementSummary, PodUsage } from "./ingress-metrics.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The ingress resource measurement of plan 13: CPU and memory of the pods
// serving the platform Gateway, and of ztunnel in its own column, sampled from
// the cluster's metrics API while a fixed request load runs. Step 1 records it
// against Istio and Step 4 repeats it against agentgateway, so everything that
// could vary is a stated option. Cluster access is read-only
// (`kubectl get --raw` on the metrics API); the only other process is curl,
// sending GET requests to the Gateway.

/**
 * The routes the load exercises: the reference app's, served by the platform
 * Gateway, each with the status it must answer with. `/api/protected` is
 * denied without a principal, so it exercises the authorizer path too.
 */
export const ingressRoutes: readonly { path: string; status: number }[] = [
  { path: "/livez", status: 200 },
  { path: "/readyz", status: 200 },
  { path: "/api", status: 200 },
  { path: "/api/protected", status: 403 },
];

/** ztunnel is measured beside the ingress: it stays through the switch. */
const ztunnel = {
  namespace: "istio-system",
  selector: "app.kubernetes.io/name=ztunnel",
};

export interface MeasurementOptions {
  kubeContext: string;
  gateway: { namespace: string; name: string };
  hostname: string;
  port: number;
  /** The mkcert CAROOT directory; the load verifies the local CA. */
  caRoot: string;
  /** Idle wait before the first sample. */
  settleSeconds: number;
  sampleCount: number;
  sampleIntervalSeconds: number;
  requestsPerRoute: number;
  concurrency: number;
  /** Measuring is refused at or above this host 1-minute load average. */
  maxLoadAverage: number;
}

/** The fixed method: Step 1 and Step 4 both run exactly these values. */
export const ingressMeasurementDefaults = {
  settleSeconds: 60,
  sampleCount: 6,
  sampleIntervalSeconds: 20,
  requestsPerRoute: 200,
  concurrency: 4,
  maxLoadAverage: 10,
} as const;

export interface Sample {
  /** The host 1-minute load average when the sample was taken. */
  loadAverage: number;
  ingress: PodUsage[];
  ztunnel: PodUsage[];
}

export interface Measurement {
  method: {
    gateway: string;
    routes: string[];
    requestsPerRoute: number;
    concurrency: number;
    settleSeconds: number;
    sampleCount: number;
    sampleIntervalSeconds: number;
  };
  /** The requests that completed with their expected status, and how fast. */
  load: { requests: number; elapsedSeconds: number; requestsPerSecond: number };
  loadAverage: { start: number; max: number };
  pods: { ingress: string[]; ztunnel: string[] };
  samples: Sample[];
  summary: { ingress: MeasurementSummary; ztunnel: MeasurementSummary };
}

export interface MeasurementDeps {
  sleep: (seconds: number) => Promise<void>;
  loadAverage: () => number;
  /** Milliseconds on a monotonic clock. */
  now: () => number;
}

const gatewayLabel = "gateway.networking.k8s.io/gateway-name";
const tenth = (value: number): number => Math.round(value * 10) / 10;

export class IngressMeasurement {
  private requests = 0;

  constructor(
    private readonly runner: Runner,
    private readonly loadRunner: Runner,
    private readonly options: MeasurementOptions,
    private readonly deps: MeasurementDeps,
  ) {}

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
    try {
      for (let index = 0; index < this.options.sampleCount; index++) {
        await this.deps.sleep(this.options.sampleIntervalSeconds);
        samples.push(await this.sample());
      }
    } finally {
      running = false;
    }
    const loadError = await loading;
    const elapsedSeconds = tenth((this.deps.now() - began) / 1000);
    if (loadError !== undefined) {
      throw this.loadFailure(loadError);
    }
    const names = (pick: (sample: Sample) => PodUsage[]) =>
      [...new Set(samples.flatMap(pick).map((pod) => pod.name))].sort();
    return {
      method: this.method(),
      load: {
        requests: this.requests,
        elapsedSeconds,
        requestsPerSecond: tenth(this.requests / elapsedSeconds),
      },
      loadAverage: {
        start,
        max: Math.max(start, ...samples.map((sample) => sample.loadAverage)),
      },
      pods: {
        ingress: names((sample) => sample.ingress),
        ztunnel: names((sample) => sample.ztunnel),
      },
      samples,
      summary: {
        ingress: summarizeSamples(samples.map((sample) => sample.ingress)),
        ztunnel: summarizeSamples(samples.map((sample) => sample.ztunnel)),
      },
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
        const { stdout } = await this.loadRunner.run(
          "curl",
          this.curlArgs(route.path),
          { capture: true },
        );
        this.checkRound(route, stdout);
        if (!running()) {
          return;
        }
      }
    } while (running());
  }

  /** Counts a round's requests; any wrong or missing status fails the measurement. */
  private checkRound(
    route: (typeof ingressRoutes)[number],
    stdout: string,
  ): void {
    const sent = this.options.requestsPerRoute;
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
    const { hostname, port, caRoot, requestsPerRoute, concurrency } =
      this.options;
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
