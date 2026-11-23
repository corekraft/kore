// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
// Canned series, windows and rule cases for the activation verdict specs (not a unit).
import type {
  ActivationBaseline,
  ActivationWindow,
  RequestSeries,
  Series,
} from "./activation-verdict.js";

export const MINUTE = 60_000;
export const DARK_SPAN = 30 * MINUTE;
export const FLAG_PROOF_SPAN = 60 * MINUTE;

/** A platform series over the window; null is a failed measurement. */
export function platform(values: Array<number | null>): Series {
  return { origin: "platform", values };
}

/** A series an app pushed about itself: never evidence. */
export function app(values: Array<number | null>): Series {
  return { origin: "app", values };
}

export function requests(
  total: Array<number | null>,
  serverErrors: Array<number | null>,
  p95Ms: Array<number | null>,
): RequestSeries {
  return {
    total: platform(total),
    serverErrors: platform(serverErrors),
    p95Ms: platform(p95Ms),
  };
}

/** A baseline window of equal length: 1000 requests, 1 percent errors, p95 of 100 ms, no restarts. */
export function baseline(
  overrides: Partial<ActivationBaseline> = {},
): ActivationBaseline {
  return {
    spanMs: DARK_SPAN,
    restarts: platform([0, 0]),
    requests: requests([0, 1000], [0, 10], [100]),
    ...overrides,
  };
}

/** A healthy availability-only dark window: two replicas, no restarts, ready, disk half free. */
export function window(
  overrides: Partial<ActivationWindow> = {},
): ActivationWindow {
  return {
    kind: "dark",
    spanMs: DARK_SPAN,
    minReplicas: 2,
    replicasAvailable: platform([2, 2, 2, 2]),
    restarts: platform([0, 0, 0, 0]),
    rolloutFailed: platform([0, 0, 0, 0]),
    ready: platform([1, 1, 1, 1]),
    freeDisk: platform([0.5, 0.5, 0.5, 0.5]),
    scrapeUp: platform([1, 1, 1, 1]),
    collectorDropped: platform([0, 0, 0, 0]),
    collectorRefused: platform([0, 0, 0, 0]),
    requests: null,
    ...overrides,
  };
}

/** A healthy request window: 1000 requests, 1 percent errors, p95 of 100 ms, with the usable baseline. */
export function requestWindow(
  overrides: Partial<ActivationWindow> = {},
): ActivationWindow {
  return window({
    requests: requests([0, 1000], [0, 10], [100]),
    baseline: baseline(),
    ...overrides,
  });
}

/** Each series the window reads, with a missing one dropped, and the cause that names it. */
export const MISSING_SERIES: ReadonlyArray<
  readonly [keyof ActivationWindow, string]
> = [
  ["replicasAvailable", "replicas available"],
  ["restarts", "restarts"],
  ["rolloutFailed", "rollout"],
  ["ready", "readiness"],
  ["freeDisk", "free disk"],
  ["scrapeUp", "scrape"],
  ["collectorDropped", "collector dropped"],
  ["collectorRefused", "collector refused"],
];

/** A window that breaks one availability rule, with the cause the verdict names. */
export const AVAILABILITY_BREACHES: ReadonlyArray<
  readonly [string, Partial<ActivationWindow>, string]
> = [
  [
    "available replicas fall below the app's minimum",
    { replicasAvailable: platform([2, 2, 1, 2]) },
    "available replicas fell to 1, below the app's minimum of 2",
  ],
  [
    "a container restarts in the window",
    { restarts: platform([4, 4, 5, 5]) },
    "1 container restart in the window",
  ],
  [
    "a rollout fails",
    { rolloutFailed: platform([0, 0, 1, 1]) },
    "a rollout failed in the window",
  ],
  [
    "readiness fails",
    { ready: platform([1, 0, 1, 1]) },
    "readiness failed 1 time in the window",
  ],
];

/** A collector that dropped or refused telemetry, with the cause it gives. */
export const COLLECTOR_GAPS: ReadonlyArray<
  readonly [string, Partial<ActivationWindow>, string]
> = [
  [
    "dropped",
    { collectorDropped: platform([0, 0, 3, 3]) },
    "the collector dropped telemetry over the window (3)",
  ],
  [
    "refused",
    { collectorRefused: platform([0, 1, 1, 1]) },
    "the collector refused telemetry over the window (1)",
  ],
];

/** Baselines that cannot be used: a restart, or a window of another length. */
export const UNUSABLE_BASELINES: ReadonlyArray<
  readonly [string, ActivationBaseline]
> = [
  ["breaks the absolute limits", baseline({ restarts: platform([0, 1]) })],
  ["is not an equal length", baseline({ spanMs: 20 * MINUTE })],
];
