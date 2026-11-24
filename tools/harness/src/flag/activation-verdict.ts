// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
// Decides one activation window's verdict from canned series. Pure: no I/O, no cluster, no series read here.
import {
  ACTIVATION_DEFAULTS,
  type ActivationVerdict,
  type ActivationWindow,
  type RequestSeries,
  type Series,
  type Verdict,
} from "./activation-verdict-types.js";

export {
  ACTIVATION_DEFAULTS,
  type ActivationBaseline,
  type ActivationVerdict,
  type ActivationWindow,
  type RequestSeries,
  type Series,
  type Verdict,
} from "./activation-verdict-types.js";

const D = ACTIVATION_DEFAULTS;
const MINUTE = 60_000;
const AVAILABILITY_SIGNALS = [
  "replicas",
  "restarts",
  "rollout",
  "readiness",
  "free-disk",
];

interface Decision {
  verdict: Verdict;
  cause: string;
}

type Step = Decision | undefined;

/** What the baseline contributes: absent, unusable (ignored), or used with its error ratio and p95 when it reads requests. */
interface Prior {
  state: "absent" | "used" | "unusable";
  errorRatio?: number | undefined;
  p95?: number | undefined;
}

interface RequestSummary {
  errors: number;
  requests: number;
  p95: number;
}

type Labelled = Array<[string, Series | undefined]>;

const inconclusive = (cause: string): Decision => ({
  verdict: "inconclusive",
  cause,
});
const refuted = (cause: string): Decision => ({ verdict: "refuted", cause });

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** The platform's measured values, or undefined when the series is absent, app-pushed or never measured. */
function measured(series: Series | undefined): number[] | undefined {
  if (series?.origin !== "platform") {
    return undefined;
  }
  const values = series.values.filter((v): v is number => v !== null);
  return values.length === 0 ? undefined : values;
}

/** The growth of a cumulative counter from its first measurement to its last. */
function increase(values: number[]): number {
  return (values.at(-1) ?? 0) - (values[0] ?? 0);
}

function requestSummary(
  requests: RequestSeries | null | undefined,
): RequestSummary | undefined {
  const total = measured(requests?.total);
  const errors = measured(requests?.serverErrors);
  const p95 = measured(requests?.p95Ms);
  if (total === undefined || errors === undefined || p95 === undefined) {
    return undefined;
  }
  return {
    errors: increase(errors),
    requests: increase(total),
    p95: Math.max(...p95),
  };
}

/** Judges the baseline: equal length, and not breaking the absolute limits (no restart, error ratio under the cap). */
function priorOf(w: ActivationWindow): Prior {
  const base = w.baseline;
  if (base === undefined) {
    return { state: "absent" };
  }
  const restarts = measured(base.restarts);
  if (
    base.spanMs !== w.spanMs ||
    restarts === undefined ||
    increase(restarts) > 0
  ) {
    return { state: "unusable" };
  }
  if (w.requests === null) {
    return { state: "used" };
  }
  const prior = requestSummary(base.requests);
  if (
    prior === undefined ||
    prior.requests <= 0 ||
    prior.errors / prior.requests > D.maxErrorRatio
  ) {
    return { state: "unusable" };
  }
  return {
    state: "used",
    errorRatio: prior.errors / prior.requests,
    p95: prior.p95,
  };
}

/** The series the window reads, labelled for a named cause; the request ones are last. */
function labelled(w: ActivationWindow): Labelled {
  const r = w.requests;
  return [
    ["replicas available", w.replicasAvailable],
    ["restarts", w.restarts],
    ["rollout", w.rolloutFailed],
    ["readiness", w.ready],
    ["free disk", w.freeDisk],
    ["scrape", w.scrapeUp],
    ["collector dropped", w.collectorDropped],
    ["collector refused", w.collectorRefused],
    ["total requests", r?.total],
    ["server errors", r?.serverErrors],
    ["p95 latency", r?.p95Ms],
  ];
}

/** Rule: a window shorter than its kind's least span cannot be judged. */
function lengthStep(w: ActivationWindow): Step {
  const least = w.kind === "dark" ? D.minDarkSpanMs : D.minFlagProofSpanMs;
  if (w.spanMs >= least) {
    return undefined;
  }
  return inconclusive(
    `window is ${w.spanMs / MINUTE} minutes; a ${w.kind} window needs at least ${least / MINUTE}`,
  );
}

/** Rule: fail closed when a required series is absent, app-pushed or never measured. */
function missingStep(w: ActivationWindow): Step {
  const required = w.requests === null ? labelled(w).slice(0, 8) : labelled(w);
  for (const [label, series] of required) {
    if (measured(series) === undefined) {
      return inconclusive(`missing series: ${label}`);
    }
  }
  return undefined;
}

/** Rule: fail closed on a collector that dropped or refused data, a gap in scraping, or too many failed measurements. */
function integrityStep(w: ActivationWindow): Step {
  for (const [name, series] of [
    ["dropped", w.collectorDropped],
    ["refused", w.collectorRefused],
  ] as const) {
    const grew = increase(measured(series) ?? []);
    if (grew > 0) {
      return inconclusive(
        `the collector ${name} telemetry over the window (${grew})`,
      );
    }
  }
  const gaps = (measured(w.scrapeUp) ?? []).filter((v) => v === 0).length;
  if (gaps > 0) {
    return inconclusive(
      `scrape gap: Prometheus did not scrape the target in ${plural(gaps, "measurement")}`,
    );
  }
  const failed = labelled(w).reduce(
    (n, [, s]) =>
      n +
      (s?.origin === "platform"
        ? s.values.filter((v) => v === null).length
        : 0),
    0,
  );
  if (failed > D.failedMeasurementTolerance) {
    return inconclusive(
      `${failed} failed measurements, tolerance ${D.failedMeasurementTolerance}`,
    );
  }
  return undefined;
}

/** Rule: the availability-only evidence set. Replicas never below the minimum, no restart, no failed rollout, readiness never failing. */
function availabilityStep(w: ActivationWindow): Step {
  const replicas = measured(w.replicasAvailable) ?? [];
  const fewest = Math.min(...replicas);
  if (fewest < w.minReplicas) {
    return refuted(
      `available replicas fell to ${fewest}, below the app's minimum of ${w.minReplicas}`,
    );
  }
  const restarts = increase(measured(w.restarts) ?? []);
  if (restarts > 0) {
    return refuted(`${plural(restarts, "container restart")} in the window`);
  }
  if ((measured(w.rolloutFailed) ?? []).some((v) => v >= 1)) {
    return refuted("a rollout failed in the window");
  }
  const notReady = (measured(w.ready) ?? []).filter((v) => v < 1).length;
  if (notReady > 0) {
    return refuted(
      `readiness failed ${plural(notReady, "time")} in the window`,
    );
  }
  return undefined;
}

/** Rules: the request floor, the 5 percent cap, the baseline plus 2 points, and p95 against twice the baseline above the floor. */
function requestStep(
  w: ActivationWindow,
  prior: Prior,
  summary: RequestSummary | undefined,
): Step {
  if (w.requests === null) {
    return undefined;
  }
  if (summary === undefined) {
    return inconclusive("missing series: requests");
  }
  if (summary.requests < D.minRequests) {
    return inconclusive(
      `${summary.requests} of ${D.minRequests} requests over the window; too little traffic to judge errors or latency`,
    );
  }
  const ratio = summary.errors / summary.requests;
  const pct = Math.round(ratio * 100);
  if (ratio > D.maxErrorRatio) {
    return refuted(
      `server errors ${summary.errors} of ${summary.requests} requests (${pct}%) exceed the ${Math.round(D.maxErrorRatio * 100)}% cap`,
    );
  }
  if (prior.state === "used" && prior.errorRatio !== undefined) {
    const basePct = Math.round(prior.errorRatio * 100);
    const allowance = Math.round(D.errorRatioAboveBaseline * 100);
    if (ratio > prior.errorRatio + D.errorRatioAboveBaseline) {
      return refuted(
        `error ratio ${pct}% is above the baseline ${basePct}% plus ${allowance} points`,
      );
    }
  }
  if (prior.state === "used" && prior.p95 !== undefined) {
    const slow = summary.p95 > D.p95BaselineMultiple * prior.p95;
    if (slow && summary.p95 > D.p95FloorMs) {
      return refuted(
        `p95 latency ${summary.p95} ms is above twice the baseline ${prior.p95} ms and above the ${D.p95FloorMs} ms floor`,
      );
    }
  }
  return undefined;
}

/** Rule: free disk is an activation gate only, so a low floor is inconclusive, never refuted. */
function diskStep(w: ActivationWindow): Step {
  const lowest = Math.min(...(measured(w.freeDisk) ?? []));
  if (lowest < D.minFreeDiskRatio) {
    return inconclusive(
      `free disk ${Math.floor(lowest * 100)}% is below the ${Math.round(D.minFreeDiskRatio * 100)}% floor`,
    );
  }
  return undefined;
}

/** Decides one activation window. Each rule runs in order, and the first to decide names the cause. */
export function activationVerdict(w: ActivationWindow): ActivationVerdict {
  const prior = priorOf(w);
  const summary = w.requests === null ? undefined : requestSummary(w.requests);
  const decision: Decision = lengthStep(w) ??
    missingStep(w) ??
    integrityStep(w) ??
    availabilityStep(w) ??
    requestStep(w, prior, summary) ??
    diskStep(w) ?? {
      verdict: "confirmed",
      cause: "every check in the evidence set held",
    };
  const requests = summary?.requests ?? 0;
  const requestSignals =
    prior.state === "used" ? ["error-ratio", "p95"] : ["error-ratio"];
  return {
    verdict: decision.verdict,
    cause: decision.cause,
    evidence: {
      set: w.requests === null ? "availability" : "availability+requests",
      signals:
        w.requests === null
          ? [...AVAILABILITY_SIGNALS]
          : [...AVAILABILITY_SIGNALS, ...requestSignals],
    },
    baseline: prior.state,
    errorRatio:
      summary === undefined || requests <= 0
        ? undefined
        : {
            errors: summary.errors,
            requests,
            ratio: summary.errors / requests,
          },
  };
}
