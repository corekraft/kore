import { registryTlsSecret } from "../images/registry-tls-fixtures.js";
import type { Runner } from "../runtime/index.js";

/**
 * What a healthy cluster answers to the read-only checks a Deployment and a
 * webhook configuration are held to, if args are one of them: a Deployment has
 * an available replica, and no Service-backed webhook is left unready.
 */
export function healthyWebhookOutput(
  args: readonly string[],
): string | undefined {
  if (args.some((arg) => arg.includes("availableReplicas"))) {
    return "available";
  }
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
      // The CA cert-manager issued answers the registry trust read (ADR 0058).
      const trust = args.includes("oci-registry-tls")
        ? registryTlsSecret
        : undefined;
      const output =
        command === "kubectl"
          ? (trust ?? healthyWebhookOutput(args))
          : undefined;
      return output === undefined
        ? runner.run(command, args, options)
        : { stdout: output, stderr: "", code: 0 };
    },
  };
}
