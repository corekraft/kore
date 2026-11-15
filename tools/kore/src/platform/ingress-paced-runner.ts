import type { RunOptions, RunResult, Runner } from "../runtime/index.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method

/**
 * Paces the request load of the ingress measurement from outside it: after
 * each curl load call (the one that runs `--parallel`) it sleeps out the rest
 * of the call's time slot, so the offered rate holds near a target. Every
 * other command, the latency probes included, passes straight through.
 */
export class PacedRunner implements Runner {
  constructor(
    private readonly inner: Runner,
    private readonly slotSeconds: number,
    private readonly deps: {
      sleep: (seconds: number) => Promise<void>;
      now: () => number;
    },
  ) {}

  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    if (!args.includes("--parallel")) {
      return this.inner.run(command, args, options);
    }
    const began = this.deps.now();
    const result = await this.inner.run(command, args, options);
    const elapsed = (this.deps.now() - began) / 1000;
    const wait = Math.round((this.slotSeconds - elapsed) * 1000) / 1000;
    if (wait > 0) {
      await this.deps.sleep(wait);
    }
    return result;
  }
}
