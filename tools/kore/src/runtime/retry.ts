import { CommandError, type RunOptions, type RunResult } from "./runner.js";
import type { Runner } from "./runner.js";

/** kubectl verbs that are safe to repeat: re-applying the same desired state. */
const retriedVerbs = new Set(["apply", "patch", "label", "annotate"]);

/** A real answer from the API server: repeating it can only repeat the answer. */
const permanentFailures: readonly RegExp[] = [
  /denied the request/i,
  /\(Forbidden\)|\bforbidden\b/i,
  /\(Unauthorized\)|\bunauthorized\b/i,
  /\bis invalid\b|Invalid value|ValidationError|unknown field/i,
  /\(NotFound\)|\(AlreadyExists\)|\(Conflict\)|\(BadRequest\)/,
];

/** The API server, etcd, or an admission webhook is still settling. */
const transientFailures: readonly RegExp[] = [
  /context deadline exceeded/i,
  /Client\.Timeout/i,
  /\bPlease retry\b/,
  /the server is currently unable to handle the request/i,
  /\((?:ServiceUnavailable|Timeout|TooManyRequests)\)/,
  /Too many requests/i,
  /failed calling webhook[^\n]*(?:connection refused|no endpoints available|i\/o timeout|connection reset|EOF)/i,
  /no endpoints available for service/i,
  /etcdserver: (?:leader changed|request timed out)/i,
  /TLS handshake timeout/i,
  /connection to the server [^\n]* was refused/i,
  /dial tcp [^\n]*connection refused/i,
  /connection reset by peer|unexpected EOF/i,
  /i\/o timeout/i,
];

export function isTransientKubectlFailure(stderr: string): boolean {
  if (permanentFailures.some((pattern) => pattern.test(stderr))) {
    return false;
  }
  return transientFailures.some((pattern) => pattern.test(stderr));
}

function kubectlVerb(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (["--context", "-n", "--namespace"].includes(arg)) {
      index += 1;
    } else if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return undefined;
}

export interface TransientRetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Thrown when a kubectl command still failed transiently on its last try. */
export class TransientFailureError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "TransientFailureError";
  }
}

function firstLine(stderr: string): string {
  return (
    stderr
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

/**
 * The one place transient kubectl failures are retried (ADR 0035's fail-fast
 * stance, bounded): mutating kubectl commands only, with exponential backoff.
 * `input` is replayed unchanged, so secrets still stream through stdin and
 * never touch disk. A real validation or authorization error is never retried.
 */
export function withTransientRetry(
  inner: Runner,
  options: TransientRetryOptions = {},
): Runner {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const log =
    options.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const sleep =
    options.sleep ??
    (async (ms: number) =>
      await new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async run(
      command: string,
      args: readonly string[],
      runOptions?: RunOptions,
    ): Promise<RunResult> {
      const verb = command === "kubectl" ? kubectlVerb(args) : undefined;
      if (verb === undefined || !retriedVerbs.has(verb)) {
        return await inner.run(command, args, runOptions);
      }
      let waitedMs = 0;
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await inner.run(command, args, runOptions);
        } catch (error) {
          if (
            !(error instanceof CommandError) ||
            !isTransientKubectlFailure(error.result.stderr) ||
            runOptions?.signal?.aborted
          ) {
            throw error;
          }
          const reason = firstLine(error.result.stderr);
          if (attempt >= attempts) {
            throw new TransientFailureError(
              `kubectl ${verb} still failed after ${attempts} attempts (waited ${Math.round(waitedMs / 1000)}s of backoff): ${reason}. The API server or an admission webhook is not ready yet; check \`kubectl get pods -A\`, then rerun the command.`,
              { cause: error },
            );
          }
          const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
          log(
            `kubectl ${verb} hit a transient error (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${reason}`,
          );
          waitedMs += delay;
          await sleep(delay);
        }
      }
    },
  };
}
