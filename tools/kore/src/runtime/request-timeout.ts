import { kubectlVerb } from "./retry.js";
import type { RunOptions, RunResult, Runner } from "./runner.js";

const watchFlags = new Set(["-w", "--watch", "--watch-only"]);

/**
 * Gives every kubectl read (`get`) a client-side `--request-timeout`, so an
 * unreachable API server fails fast and names itself instead of hanging.
 * Watches, writes, other verbs and other tools are passed through unchanged.
 */
export function withRequestTimeout(inner: Runner, timeout: string): Runner {
  return {
    run(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<RunResult> {
      const read =
        command === "kubectl" &&
        kubectlVerb(args) === "get" &&
        !args.some(
          (arg) =>
            watchFlags.has(arg) ||
            arg.startsWith("--watch") ||
            arg.startsWith("--request-timeout"),
        );
      return inner.run(
        command,
        read ? [...args, `--request-timeout=${timeout}`] : args,
        options,
      );
    },
  };
}
