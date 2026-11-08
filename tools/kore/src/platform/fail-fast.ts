import type { Component, Repository } from "../config/index.js";
import { CommandError, withSignal, type Runner } from "../runtime/index.js";
import { findings, type Finding } from "./fail-fast-detect.js";

const LOG_LINES = "20";

export interface WatchClock {
  now(): number;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}
export interface WatchOptions {
  clock?: WatchClock;
  /** Time between looks at the namespace (default 5s). */
  intervalMs?: number;
  /** How long a pull, config, or scheduling problem must persist (default 60s). */
  graceMs?: number;
}

const realClock: WatchClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      if (signal.aborted) {
        done();
      } else {
        signal.addEventListener("abort", done, { once: true });
      }
    }),
};

async function previousLogs(
  runner: Runner,
  base: string[],
  finding: Finding,
): Promise<string> {
  if (!finding.logs) {
    return "";
  }
  try {
    const { stdout } = await runner.run(
      "kubectl",
      [
        ...base,
        "logs",
        finding.pod,
        "--container",
        finding.logs.container,
        "--previous",
        "--tail",
        LOG_LINES,
      ],
      { capture: true },
    );
    return stdout.trim();
  } catch (error) {
    if (error instanceof CommandError) {
      return "";
    }
    throw error;
  }
}

export class FailFastError extends Error {}

async function diagnosis(
  runner: Runner,
  base: string[],
  component: Component,
  finding: Finding,
): Promise<FailFastError> {
  const logs = await previousLogs(runner, base, finding);
  const where =
    finding.subject === "scheduling"
      ? `pod ${finding.pod}`
      : `pod ${finding.pod} ${finding.subject}`;
  const detail = finding.detail ? `: ${finding.detail}` : "";
  return new FailFastError(
    [
      `component ${component.name} failed: ${where} ${finding.state}${detail}`,
      ...(logs ? [`Previous logs (last ${LOG_LINES} lines):`, logs] : []),
      finding.hint,
    ].join("\n"),
  );
}

async function watchNamespace(
  runner: Runner,
  repository: Repository,
  component: Component,
  stop: AbortSignal,
  options: WatchOptions,
): Promise<FailFastError | undefined> {
  const clock = options.clock ?? realClock;
  const interval = options.intervalMs ?? 5000;
  const grace = options.graceMs ?? 60000;
  const base = [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    component.namespace,
  ];
  const firstSeen = new Map<string, number>();
  while (!stop.aborted) {
    await clock.sleep(interval, stop);
    if (stop.aborted) {
      return undefined;
    }
    const current = await findings(runner, base, component.name);
    const now = clock.now();
    const keys = new Set(current.map(({ key }) => key));
    for (const key of firstSeen.keys()) {
      if (!keys.has(key)) {
        firstSeen.delete(key);
      }
    }
    for (const finding of current) {
      const since = firstSeen.get(finding.key) ?? now;
      firstSeen.set(finding.key, since);
      if (!finding.persists || now - since >= grace) {
        return await diagnosis(runner, base, component, finding);
      }
    }
  }
  return undefined;
}

/**
 * Runs `run` while watching the component's namespace read-only. When a pod of
 * the release is in a fatal state, every command `run` started through the
 * given runner is terminated (SIGTERM, so Helm can roll back under
 * `--rollback-on-failure`) and the failure is thrown with its cause.
 * The watch is advisory: if it finds nothing, `run` decides the outcome.
 */
export async function withFailFast<T>(
  repository: Repository,
  runner: Runner,
  component: Component,
  run: (runner: Runner) => Promise<T>,
  options: WatchOptions = {},
): Promise<T> {
  const stop = new AbortController();
  const cancel = new AbortController();
  let failure: Error | undefined;
  const watching = watchNamespace(
    runner,
    repository,
    component,
    stop.signal,
    options,
  ).then(
    (found) => {
      if (found && !stop.signal.aborted) {
        failure = found;
        cancel.abort();
      }
    },
    (error: unknown) => {
      if (!stop.signal.aborted) {
        failure = error instanceof Error ? error : new Error(String(error));
        cancel.abort();
      }
    },
  );
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await run(withSignal(runner, cancel.signal)) };
  } catch (error) {
    outcome = { error };
  }
  stop.abort();
  await watching;
  if (failure && cancel.signal.aborted) {
    throw failure;
  }
  if ("error" in outcome) {
    throw outcome.error;
  }
  return outcome.value;
}
