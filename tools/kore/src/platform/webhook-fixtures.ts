import type { Runner } from "../runtime/index.js";

/** What a healthy cluster answers to a webhook configuration read, if args are one. */
export function healthyWebhookOutput(
  args: readonly string[],
): string | undefined {
  return args.some((arg) =>
    /^(validating|mutating)webhookconfiguration\//.test(arg),
  )
    ? '{"webhooks":[]}' // no Service-backed webhook is left unready
    : undefined;
}

/** Wraps a runner so webhook configuration reads answer healthy; all else passes through. */
export function withHealthyWebhooks(runner: Runner): Runner {
  return {
    async run(command, args, options) {
      const output =
        command === "kubectl" ? healthyWebhookOutput(args) : undefined;
      return output === undefined
        ? runner.run(command, args, options)
        : { stdout: output, stderr: "", code: 0 };
    },
  };
}
