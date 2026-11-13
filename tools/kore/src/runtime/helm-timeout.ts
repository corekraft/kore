import type { RunOptions, RunResult, Runner } from "./runner.js";

/** Covers process start, the rollback's own wait, and slow cleanup. */
const marginMs = 120_000;
const mutatingVerbs = new Set(["upgrade", "install", "uninstall", "rollback"]);
const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/**
 * How long a helm mutation may run before the runner calls it hung: twice
 * its own `--timeout` (a failed upgrade rolls back and waits again) plus a
 * margin. Undefined when the duration is not one Kore's config allows.
 */
export function helmDeadlineMs(duration: string): number | undefined {
  const match = /^([1-9]\d*)([smh])$/.exec(duration);
  return match
    ? 2 * Number(match[1]) * (units[match[2] as string] as number) + marginMs
    : undefined;
}

function helmTimeout(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--timeout") {
      return args[index + 1];
    }
    if (arg.startsWith("--timeout=")) {
      return arg.slice("--timeout=".length);
    }
  }
  return undefined;
}

/**
 * Gives each helm mutation its own deadline, derived from its `--timeout`, in
 * place of the runner's default. Reads, other tools and calls that set their
 * own `timeoutMs` are passed through unchanged.
 */
export function withHelmDeadline(inner: Runner): Runner {
  return {
    run(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<RunResult> {
      const verb = args.find((arg) => !arg.startsWith("-"));
      const timeout = helmTimeout(args);
      const deadline =
        command === "helm" &&
        options?.timeoutMs === undefined &&
        verb !== undefined &&
        mutatingVerbs.has(verb) &&
        timeout !== undefined
          ? helmDeadlineMs(timeout)
          : undefined;
      return inner.run(
        command,
        args,
        deadline === undefined ? options : { ...options, timeoutMs: deadline },
      );
    },
  };
}
