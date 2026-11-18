import type { HostSnapshot } from "./ingress-host.js";
import type {
  LatencySummary,
  MeasurementSummary,
  PodUsage,
} from "./ingress-metrics.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The shapes of one ingress measurement: a sample and the result that
// `IngressMeasurement` prints as JSON.

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
  /** Request times at the Gateway under the load; absent when not probed. */
  latency?: LatencySummary;
  /**
   * The host's load averages, swap, free VM memory and agent pane count before
   * the settle and after the load; absent when no host reader was given.
   */
  host?: { before: HostSnapshot; after: HostSnapshot };
}
