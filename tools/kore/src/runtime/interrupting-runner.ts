import type { Runner, RunOptions, RunResult } from "./runner.js";

// Docs: docs/decisions/0079-live-interruption-specs.md

export interface Interruption {
  /** Which command to kill. */
  matches: (command: string, args: readonly string[]) => boolean;
  /** How long the matching command runs before it is terminated (SIGTERM). */
  afterMs: number;
  /** How many matching commands to kill before passing the rest through; default 1. */
  times?: number;
}

export interface InterruptingRunner {
  runner: Runner;
  /** Whether a matching command was still running when it was terminated. */
  interrupted: () => boolean;
}

/**
 * Wraps a runner so the first matching command(s) are terminated mid-run, the way
 * an operator's Ctrl-C or a crashed host would. Once `times` commands are killed, later calls
 * pass through, so the same wrapper can run the recovery.
 */
export function interruptingRunner(
  inner: Runner,
  { matches, afterMs, times = 1 }: Interruption,
): InterruptingRunner {
  let remaining = times;
  let killed = false;
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      options: RunOptions = {},
    ): Promise<RunResult> {
      if (remaining <= 0 || !matches(command, args)) {
        return await inner.run(command, args, options);
      }
      remaining -= 1;
      const controller = new AbortController();
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          killed = true;
          controller.abort();
        }
      }, afterMs);
      options.signal?.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
      try {
        return await inner.run(command, args, {
          ...options,
          signal: controller.signal,
        });
      } finally {
        finished = true;
        clearTimeout(timer);
      }
    },
  };
  return { runner, interrupted: () => killed };
}
