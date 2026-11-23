// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
// The inputs, output and platform defaults of an activation window's verdict (activation-verdict.ts decides it).

/** Where a series came from. An app's own series are never evidence. */
export type Origin = "platform" | "app";

/** One series over the window, one value per measurement; null is a failed measurement. */
export interface Series {
  origin: Origin;
  values: ReadonlyArray<number | null>;
}

/** The request series of a window or its baseline. Each is optional, so an absent one is missing. */
export interface RequestSeries {
  /** Cumulative request count. */
  total?: Series | undefined;
  /** Cumulative count of server errors (5xx). */
  serverErrors?: Series | undefined;
  /** p95 latency in ms, one value per measurement. */
  p95Ms?: Series | undefined;
}

/** The prior window that a release is judged against: the service's own, of equal length. */
export interface ActivationBaseline {
  spanMs: number;
  restarts?: Series | undefined;
  requests?: RequestSeries | undefined;
}

/** An activation window: the platform series for one app's flag over one window. */
export interface ActivationWindow {
  kind: "dark" | "flag-proof";
  spanMs: number;
  /** The app's declared minimum of available replicas. */
  minReplicas: number;
  /** Available replicas (kube-state-metrics). */
  replicasAvailable?: Series | undefined;
  /** Cumulative container restarts. */
  restarts?: Series | undefined;
  /** 1 when a rollout failed, else 0. */
  rolloutFailed?: Series | undefined;
  /** 1 when ready, 0 when readiness failed. */
  ready?: Series | undefined;
  /** Free ratio of the filesystem that holds the node's volumes, 0 to 1. */
  freeDisk?: Series | undefined;
  /** 1 when Prometheus scraped the target, 0 for a gap in scraping. */
  scrapeUp?: Series | undefined;
  /** Cumulative telemetry the collector dropped. */
  collectorDropped?: Series | undefined;
  /** Cumulative telemetry the collector refused. */
  collectorRefused?: Series | undefined;
  /** The request series, or null for an availability-only window. */
  requests: RequestSeries | null;
  /** Absent for a first release. */
  baseline?: ActivationBaseline | undefined;
}

export type Verdict = "confirmed" | "refuted" | "inconclusive";

export interface ActivationVerdict {
  verdict: Verdict;
  /** The named cause: the first rule that decided the window, or what it showed when it confirms. */
  cause: string;
  /** The evidence set the window read, named so nobody reads it as covering more. */
  evidence: {
    set: "availability" | "availability+requests";
    signals: string[];
  };
  /** Whether the baseline was used, is absent for a first release, or is unusable and ignored. */
  baseline: "used" | "absent" | "unusable";
  /** The error ratio's numerator and denominator, present when the window read request series. */
  errorRatio?: { errors: number; requests: number; ratio: number } | undefined;
}

/** The platform defaults: one value for every app, tuned after the vps soak. */
export const ACTIVATION_DEFAULTS = {
  /** The server-error ratio cap, the one ServiceHighErrorRatio uses; the only limit on a first release. */
  maxErrorRatio: 0.05,
  /** The error ratio may exceed the baseline's by at most this (2 points). */
  errorRatioAboveBaseline: 0.02,
  /** p95 may be at most this many times the baseline's. */
  p95BaselineMultiple: 2,
  /** p95 is refuted only above this floor, in ms. */
  p95FloorMs: 250,
  /** The request floor for a window that reads request series. */
  minRequests: 100,
  /** A dark window's least span, in ms. */
  minDarkSpanMs: 30 * 60_000,
  /** A flag-proof window's least span, in ms. */
  minFlagProofSpanMs: 60 * 60_000,
  /** Failed measurements tolerated across the window. Proposed, tuned after the vps soak. */
  failedMeasurementTolerance: 3,
  /** The free-disk floor, an activation gate only. */
  minFreeDiskRatio: 0.2,
} as const;
