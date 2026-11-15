import type {
  LatencySummary,
  MeasurementSummary,
  PodUsage,
} from "./ingress-metrics.js";
import type { RateCheck } from "./ingress-pacing.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The options, fixed method values and result shapes of the ingress
// measurement; the behaviour is in ingress-measurement.ts.

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
  /**
   * Sequential timed GETs per route at each sample, taken while the load runs.
   * Unset or 0 sends none and reports no latency.
   */
  latencyProbesPerRoute?: number;
  /**
   * Offered requests per second. Unset keeps the closed-loop load exactly;
   * set, the load is paced in batches and the achieved rate is checked
   * against it (KORE_INGRESS_TARGET_RPS in the live run).
   */
  targetRequestsPerSecond?: number;
}

/** The fixed method: Step 1 and Step 4 both run exactly these values. */
export const ingressMeasurementDefaults = {
  settleSeconds: 60,
  sampleCount: 6,
  sampleIntervalSeconds: 20,
  requestsPerRoute: 200,
  concurrency: 4,
  maxLoadAverage: 10,
  latencyProbesPerRoute: 20,
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
    /** Present only for a paced load: the target and the requests per batch. */
    targetRequestsPerSecond?: number;
    batchSize?: number;
  };
  /** The requests that completed with their expected status, and how fast. */
  load: { requests: number; elapsedSeconds: number; requestsPerSecond: number };
  loadAverage: { start: number; max: number };
  pods: { ingress: string[]; ztunnel: string[] };
  samples: Sample[];
  summary: { ingress: MeasurementSummary; ztunnel: MeasurementSummary };
  /** Present only with a target: whether the achieved rate matched it. */
  rate?: RateCheck;
  /** Median millicores per request per second at the achieved rate. */
  cpuPerRequest: { ingress?: number; ztunnel?: number };
  /** Request times at the Gateway under the load; absent when not probed. */
  latency?: LatencySummary;
}

export interface MeasurementDeps {
  sleep: (seconds: number) => Promise<void>;
  loadAverage: () => number;
  /** Milliseconds on a monotonic clock. */
  now: () => number;
}
