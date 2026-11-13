import { kubectlVerb } from "./retry.js";
import type { RunOptions, RunResult, Runner } from "./runner.js";

const readVerbs = new Set([
  "get",
  "describe",
  "top",
  "logs",
  "events",
  "api-resources",
  "api-versions",
  "version",
  "cluster-info",
  "explain",
  "auth",
]);
const watchFlags = ["-w", "--watch"];

/** Whether the call streams until cancelled, which a request timeout would cut off. */
function streams(verb: string, args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      watchFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)) ||
      arg.startsWith("--watch-only") ||
      (verb === "logs" && (arg === "-f" || arg.startsWith("--follow"))),
  );
}

/**
 * Gives every kubectl read (`get`, `describe`, `logs`, ...) a client-side
 * `--request-timeout`, so an unreachable API server fails fast and names
 * itself instead of hanging. Watches, followed logs, writes, other verbs and
 * other tools are passed through unchanged.
 */
export function withRequestTimeout(inner: Runner, timeout: string): Runner {
  return {
    run(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<RunResult> {
      const verb = command === "kubectl" ? kubectlVerb(args) : undefined;
      const read =
        verb !== undefined &&
        readVerbs.has(verb) &&
        !streams(verb, args) &&
        !args.some((arg) => arg.startsWith("--request-timeout"));
      return inner.run(
        command,
        read ? [...args, `--request-timeout=${timeout}`] : args,
        options,
      );
    },
  };
}
