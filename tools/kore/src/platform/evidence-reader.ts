// Docs: docs/decisions/0143-the-controller-reaches-a-managed-registry-through-a-forward-over-the-tailnet.md
// (the registry forward pattern); issue #1520 under spec #1510.
import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

/**
 * The platform's metrics store, as the observability component installs it
 * (infra/catalog/components.yaml). Nothing else is reached.
 */
const metricsStore = {
  namespace: "observability",
  service: "prometheus-server",
  servicePort: 80,
};

/**
 * The local end of the forward, on the loopback address only. The registry
 * forward keeps 30500, so the two never share a port.
 */
const forwardPort = 30090;
const forwardAddress = `127.0.0.1:${forwardPort}`;
const apiUrl = `http://${forwardAddress}/api/v1`;
const buildInfoUrl = `${apiUrl}/status/buildinfo`;
const rangeUrl = `${apiUrl}/query_range`;

/** curl's exit code for a connection that nothing accepts. */
const curlConnectionRefused = 7;

const metricName = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

export interface EvidenceWindow {
  start: Date;
  end: Date;
  /** Seconds between samples. */
  stepSeconds: number;
}

export interface EvidenceSample {
  /** Unix seconds, as Prometheus reports them. */
  time: number;
  value: number;
}

export interface EvidenceSeries {
  /** The series' metric name, or the recorded name it was asked for. */
  name: string;
  labels: Record<string, string>;
  samples: EvidenceSample[];
}

export interface EvidenceReading {
  /** The recorded series name that was asked for. */
  name: string;
  /**
   * Empty when Prometheus matched no samples in the window. The caller judges
   * that as absent, never as healthy; a failed query is an error, not this.
   */
  series: EvidenceSeries[];
}

/**
 * Reads the samples of each named recorded series over `window` from the
 * platform's Prometheus. A kubectl port-forward on the environment's own kube
 * context carries the read, as the registry forward does (ADR 0143). The
 * forward lives for this read only and is stopped when it ends, so it leaves
 * no owner to record. It adds no listener, route or credential; Prometheus,
 * Loki, Tempo and Grafana stay unrouted.
 */
export async function readEvidence(
  repository: Repository,
  runner: Runner,
  names: readonly string[],
  window: EvidenceWindow,
): Promise<EvidenceReading[]> {
  const context = repository.environment.kubeContext;
  const range = windowArgs(window);
  for (const name of names) {
    if (!metricName.test(name)) {
      throw new Error(
        `${name} is not a metric name, so it cannot be read from Prometheus; give the recorded series name, such as kore:service_available_replicas`,
      );
    }
  }
  const stop = new AbortController();
  let exited: Promise<never> | undefined;
  try {
    await refuseIfAnswering(runner);
    exited = startForward(runner, context, stop.signal);
    await Promise.race([awaitReady(runner, stop.signal), exited]);
    const readings: EvidenceReading[] = [];
    for (const name of names) {
      readings.push(await readRange(runner, name, range));
    }
    return readings;
  } finally {
    stop.abort();
    await exited?.catch(() => undefined);
  }
}

/** The window in unix seconds, refused when it does not run forward. */
function windowArgs(window: EvidenceWindow): {
  start: number;
  end: number;
  step: number;
} {
  const start = window.start.getTime() / 1000;
  const end = window.end.getTime() / 1000;
  if (!(end > start)) {
    throw new Error(
      `the evidence window must end after it starts (start ${window.start.getTime()} ms, end ${window.end.getTime()} ms); give a later end, then rerun`,
    );
  }
  if (!(window.stepSeconds > 0)) {
    throw new Error(
      `the evidence window step is ${window.stepSeconds} seconds; it must be a positive number of seconds`,
    );
  }
  return { start, end, step: window.stepSeconds };
}

/**
 * Refuses a local port that already answers. A forward another run left there
 * may reach a different cluster, so this read must never use it. Only a port
 * that refuses the connection is free.
 */
async function refuseIfAnswering(runner: Runner): Promise<void> {
  try {
    await runner.run(
      "curl",
      ["--silent", "--show-error", "--max-time", "2", buildInfoUrl],
      { capture: true, timeoutMs: 10_000 },
    );
  } catch (error) {
    if (
      error instanceof CommandError &&
      error.result.code === curlConnectionRefused
    ) {
      return;
    }
    throw new Error(
      `could not check whether ${forwardAddress} is free for the metrics forward: ${reason(error)}; free the port and rerun`,
    );
  }
  throw new Error(
    `${forwardAddress} already answers, so another forward holds it; stop that forward, then rerun, so the evidence is never read from another cluster`,
  );
}

/**
 * Starts the port-forward. The promise rejects when kubectl exits, with its
 * cause, and it is stopped by aborting `signal`.
 */
function startForward(
  runner: Runner,
  context: string,
  signal: AbortSignal,
): Promise<never> {
  const { namespace, service, servicePort } = metricsStore;
  return runner
    .run(
      "kubectl",
      [
        "--context",
        context,
        "--namespace",
        namespace,
        "port-forward",
        `service/${service}`,
        `${forwardPort}:${servicePort}`,
      ],
      { capture: true, signal, timeoutMs: 0 },
    )
    .then(
      () => {
        throw new Error(
          `kubectl port-forward to ${service} in ${namespace} on context ${context} exited before the evidence was read, so no series is read`,
        );
      },
      (error: unknown) => {
        throw new Error(
          `kubectl port-forward to ${service} in ${namespace} on context ${context} failed: ${reason(error)}`,
        );
      },
    );
}

/**
 * Resolves once the forward answers as Prometheus. curl retries the connection
 * while kubectl binds the port, so the wait needs no timer here. A forward that
 * answers with anything else never becomes ready.
 */
async function awaitReady(runner: Runner, signal: AbortSignal): Promise<void> {
  let body: string;
  try {
    ({ stdout: body } = await runner.run(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        "3",
        "--retry",
        "15",
        "--retry-connrefused",
        "--retry-delay",
        "1",
        buildInfoUrl,
      ],
      { capture: true, signal, timeoutMs: 90_000 },
    ));
  } catch (error) {
    throw new Error(
      `the forward on ${forwardAddress} did not answer Prometheus, so it is not ready and no evidence is read: ${reason(error)}`,
    );
  }
  if (!isBuildInfo(body)) {
    throw new Error(
      `the forward on ${forwardAddress} answers, but not as Prometheus, so it is not ready and no evidence is read; it must reach ${metricsStore.service} in ${metricsStore.namespace}`,
    );
  }
}

function isBuildInfo(body: string): boolean {
  const answer = parseJson(body);
  return (
    isRecord(answer) &&
    answer.status === "success" &&
    isRecord(answer.data) &&
    typeof answer.data.version === "string"
  );
}

/** Reads one series name over the window, and reports a failed query by its cause. */
async function readRange(
  runner: Runner,
  name: string,
  range: { start: number; end: number; step: number },
): Promise<EvidenceReading> {
  let body: string;
  try {
    ({ stdout: body } = await runner.run(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        "20",
        "--get",
        "--data-urlencode",
        `query=${name}`,
        "--data-urlencode",
        `start=${range.start}`,
        "--data-urlencode",
        `end=${range.end}`,
        "--data-urlencode",
        `step=${range.step}`,
        rangeUrl,
      ],
      { capture: true, timeoutMs: 60_000 },
    ));
  } catch (error) {
    throw new Error(`reading ${name} from Prometheus failed: ${reason(error)}`);
  }
  return { name, series: matrixSeries(name, body) };
}

/** The series in a range query's answer. A refused or unreadable answer throws. */
function matrixSeries(name: string, body: string): EvidenceSeries[] {
  const answer = parseJson(body);
  if (!isRecord(answer)) {
    throw new Error(
      `Prometheus answered ${name} with a body that is not Prometheus JSON, so the query failed and no series is read`,
    );
  }
  if (answer.status !== "success") {
    throw new Error(
      `Prometheus refused ${name}: ${text(answer.errorType)}: ${text(answer.error)}`,
    );
  }
  const data = answer.data;
  if (
    !isRecord(data) ||
    data.resultType !== "matrix" ||
    !Array.isArray(data.result)
  ) {
    throw new Error(
      `Prometheus answered ${name} without a range matrix, so the query failed and no series is read`,
    );
  }
  return data.result.map((entry) => toSeries(name, entry));
}

function toSeries(name: string, entry: unknown): EvidenceSeries {
  if (
    !isRecord(entry) ||
    !isRecord(entry.metric) ||
    !Array.isArray(entry.values)
  ) {
    throw new Error(
      `Prometheus answered ${name} with a series that has no metric or values, so the query failed and no series is read`,
    );
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.metric)) {
    if (typeof value === "string" && key !== "__name__") {
      labels[key] = value;
    }
  }
  const metric = entry.metric["__name__"];
  return {
    name: typeof metric === "string" ? metric : name,
    labels,
    samples: entry.values.map(toSample),
  };
}

function toSample(pair: unknown): EvidenceSample {
  if (
    !Array.isArray(pair) ||
    typeof pair[0] !== "number" ||
    typeof pair[1] !== "string"
  ) {
    throw new Error(
      "Prometheus answered with a sample that is not a timestamp and a value, so the query failed and no series is read",
    );
  }
  return { time: pair[0], value: Number(pair[1]) };
}

function parseJson(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "no message";
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
