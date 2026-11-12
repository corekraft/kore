import { registryTlsSecret } from "../images/registry-tls-fixtures.js";
import { CommandError, type Runner } from "../runtime/index.js";

/** Releases the local catalog gates off, so a healthy cluster never has them. */
const gatedOffReleases = ["agentgateway", "agentgateway-crds"];

/**
 * What Helm answers for the status of a gated-off release: not found. Throws
 * for those and returns for everything else, so a fake runner calls it first.
 */
export function gatedOffReleaseAbsent(
  command: string,
  args: readonly string[],
): void {
  if (
    command === "helm" &&
    args[0] === "status" &&
    gatedOffReleases.includes(args[1] ?? "")
  ) {
    throw new CommandError(command, args, {
      stdout: "",
      stderr: "Error: release: not found",
      code: 1,
    });
  }
}

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
/** What a healthy DaemonSet status read answers: every desired pod ready. */
export function healthyDaemonSetOutput(
  args: readonly string[],
): string | undefined {
  return args.some((arg) => arg.startsWith("daemonset/")) &&
    args.includes("jsonpath={.status}")
    ? JSON.stringify({
        desiredNumberScheduled: 1,
        numberReady: 1,
        updatedNumberScheduled: 1,
      })
    : undefined;
}

export function withHealthyWebhooks(runner: Runner): Runner {
  return {
    async run(command, args, options) {
      gatedOffReleaseAbsent(command, args);
      // The CA cert-manager issued answers the registry trust read (ADR 0058).
      const trust = args.includes("oci-registry-tls")
        ? registryTlsSecret
        : undefined;
      const output =
        command === "kubectl"
          ? (trust ??
            healthyWebhookOutput(args) ??
            healthyDaemonSetOutput(args))
          : undefined;
      return output === undefined
        ? runner.run(command, args, options)
        : { stdout: output, stderr: "", code: 0 };
    },
  };
}
