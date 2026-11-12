import type { Runner } from "../runtime/index.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The ingress resource measurement of plan 13: CPU and memory of the pods
// serving the platform Gateway, sampled from the cluster's metrics API while a
// fixed request load runs. Step 1 records it against Istio and Step 4 repeats
// it against agentgateway, so everything that could vary is a stated option.
// Cluster access is read-only (`kubectl get --raw` on the metrics API); the
// only other process is curl, sending requests to the Gateway.

/** The routes the load exercises: the reference app's, served by the platform Gateway. */
export const ingressRoutes: readonly { path: string; note: string }[] = [
  { path: "/livez", note: "liveness, answered by the app" },
  { path: "/readyz", note: "readiness, answered by the app" },
  { path: "/api", note: "app API root" },
  {
    path: "/api/protected",
    note: "protected route, denied without a principal",
  },
];

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
  /** Sampling is refused at or above this host 1-minute load average. */
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

export interface PodUsage {
  name: string;
  cpuMillicores: number;
  memoryMiB: number;
}

export interface Spread {
  median: number;
  max: number;
}

export interface MeasurementSummary {
  samples: number;
  cpuMillicores: Spread;
  memoryMiB: Spread;
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
  pods: string[];
  samples: PodUsage[][];
  summary: MeasurementSummary;
}

export interface MeasurementDeps {
  sleep: (seconds: number) => Promise<void>;
  loadAverage: () => number;
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const cpuUnits: Record<string, number> = { n: 1e-6, u: 1e-3, m: 1, "": 1000 };
const memoryUnits: Record<string, number> = {
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  "": 1 / 1024 ** 2,
};

function quantity(
  text: string,
  kind: "cpu" | "memory",
  units: Record<string, number>,
): number {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]?[a-z]?)$/.exec(text);
  const factor = match ? units[match[2] ?? ""] : undefined;
  if (!match || factor === undefined) {
    throw new Error(`unreadable ${kind} quantity ${text}`);
  }
  return Number(match[1]) * factor;
}

interface PodMetricsList {
  items?: {
    metadata?: { name?: string };
    containers?: { usage?: { cpu?: string; memory?: string } }[];
  }[];
}

/**
 * Per-pod CPU (millicores) and memory (MiB) from a metrics.k8s.io PodMetricsList,
 * summing a pod's containers. Same input, same output.
 */
export function parsePodMetrics(json: string): PodUsage[] {
  let list: PodMetricsList;
  try {
    list = JSON.parse(json) as PodMetricsList;
  } catch {
    throw new Error("pod metrics output is not valid JSON");
  }
  return (list.items ?? []).map((item) => {
    let cpu = 0;
    let memory = 0;
    for (const container of item.containers ?? []) {
      cpu += quantity(container.usage?.cpu ?? "0", "cpu", cpuUnits);
      memory += quantity(container.usage?.memory ?? "0", "memory", memoryUnits);
    }
    return {
      name: item.metadata?.name ?? "",
      cpuMillicores: round(cpu, 3),
      memoryMiB: round(memory, 1),
    };
  });
}

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return { median: round(median, 3), max: round(sorted.at(-1) ?? 0, 3) };
}

/** Median and peak, over samples, of the total across the ingress pods in each sample. */
export function summarizeSamples(samples: PodUsage[][]): MeasurementSummary {
  const total = (pick: (pod: PodUsage) => number) =>
    samples.map((sample) => sample.reduce((sum, pod) => sum + pick(pod), 0));
  return {
    samples: samples.length,
    cpuMillicores: spread(total((pod) => pod.cpuMillicores)),
    memoryMiB: spread(total((pod) => pod.memoryMiB)),
  };
}

const gatewayLabel = "gateway.networking.k8s.io/gateway-name";

export class IngressMeasurement {
  constructor(
    private readonly runner: Runner,
    private readonly loadRunner: Runner,
    private readonly options: MeasurementOptions,
    private readonly deps: MeasurementDeps,
  ) {}

  /** Settles, then samples the ingress pods while the fixed load runs. */
  async measure(): Promise<Measurement> {
    const load = this.deps.loadAverage();
    if (load >= this.options.maxLoadAverage) {
      throw new Error(
        `host 1-minute load average ${load} is not below ${this.options.maxLoadAverage}; wait for the host to quiet down and rerun`,
      );
    }
    await this.deps.sleep(this.options.settleSeconds);
    let running = true;
    const loading = this.loadUntil(() => running);
    const samples: PodUsage[][] = [];
    try {
      for (let index = 0; index < this.options.sampleCount; index++) {
        await this.deps.sleep(this.options.sampleIntervalSeconds);
        samples.push(await this.sample());
      }
    } finally {
      running = false;
      await loading;
    }
    return {
      method: this.method(),
      pods: [...new Set(samples.flat().map((pod) => pod.name))].sort(),
      samples,
      summary: summarizeSamples(samples),
    };
  }

  private method(): Measurement["method"] {
    const { gateway, ...rest } = this.options;
    return {
      gateway: `${gateway.namespace}/${gateway.name}`,
      routes: ingressRoutes.map((route) => route.path),
      requestsPerRoute: rest.requestsPerRoute,
      concurrency: rest.concurrency,
      settleSeconds: rest.settleSeconds,
      sampleCount: rest.sampleCount,
      sampleIntervalSeconds: rest.sampleIntervalSeconds,
    };
  }

  private async sample(): Promise<PodUsage[]> {
    const { gateway, kubeContext } = this.options;
    const selector = `${gatewayLabel}=${gateway.name}`;
    const { stdout } = await this.runner.run(
      "kubectl",
      [
        "--context",
        kubeContext,
        "get",
        "--raw",
        `/apis/metrics.k8s.io/v1beta1/namespaces/${gateway.namespace}/pods?labelSelector=${encodeURIComponent(selector)}`,
      ],
      { capture: true },
    );
    const pods = parsePodMetrics(stdout);
    if (pods.length === 0) {
      throw new Error(
        `no pod metrics for ${selector} in ${gateway.namespace}; check that the Gateway's pods run and the metrics API (metrics-server) answers`,
      );
    }
    return pods;
  }

  /** Repeats the fixed load rounds until `running` turns false. */
  private async loadUntil(running: () => boolean): Promise<void> {
    do {
      for (const route of ingressRoutes) {
        await this.loadRunner.run("curl", this.curlArgs(route.path), {
          capture: true,
        });
        if (!running()) {
          return;
        }
      }
    } while (running());
  }

  private curlArgs(path: string): string[] {
    const { hostname, port, caRoot, requestsPerRoute, concurrency } =
      this.options;
    return [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--cacert",
      `${caRoot}/rootCA.pem`,
      "--resolve",
      `${hostname}:${port}:127.0.0.1`,
      "--parallel",
      "--parallel-max",
      String(concurrency),
      `https://${hostname}:${port}${path}?n=[1-${requestsPerRoute}]`,
    ];
  }
}
