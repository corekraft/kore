import { healthyWebhookOutput } from "../platform/webhook-fixtures.js";
import type { Runner } from "../runtime/index.js";

export const digest = "sha256:" + "a".repeat(64);

export function lockedImage(
  signer = "local-kore-key",
  registry = "registry.kore.local:30500",
) {
  return { reference: `${registry}/reference@${digest}`, digest, signer };
}

export interface Call {
  command: string;
  args: readonly string[];
}

const healthyGateway = JSON.stringify({
  status: {
    conditions: [
      { type: "Accepted", status: "True" },
      { type: "Programmed", status: "True" },
    ],
    listeners: [
      { name: "https", conditions: [{ type: "ResolvedRefs", status: "True" }] },
    ],
  },
});
const healthyService = JSON.stringify({
  items: [{ status: { loadBalancer: { ingress: [{ ip: "127.0.0.1" }] } } }],
});

/** What a healthy cluster answers to the platform readiness probes, if any. */
export function healthyReadinessOutput(
  args: readonly string[],
): string | undefined {
  if (args.includes("service") && args.includes("--selector")) {
    return healthyService;
  }
  const webhook = healthyWebhookOutput(args);
  if (webhook !== undefined) {
    return webhook;
  }
  if (args.some((arg) => arg.startsWith("gateway/"))) {
    return healthyGateway;
  }
  if (args.some((arg) => arg.includes("policy\\.sigstore\\.dev/include"))) {
    return "true"; // the namespace admission label read back after enrollment
  }
  if (args.some((arg) => arg.startsWith("go-template="))) {
    return "ready";
  }
  return undefined;
}

/** Records every call and answers like a healthy local cluster. */
export function healthyRunner(
  calls: Call[],
  clusterIp = "10.96.0.50",
  fail?: (call: Call) => boolean,
): Runner {
  return {
    async run(command, args) {
      calls.push({ command, args });
      if (fail?.({ command, args })) {
        throw new Error(`${command} failed`);
      }
      const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      const readiness = healthyReadinessOutput(args);
      if (command === "kubectl" && readiness !== undefined) {
        return ok(readiness);
      }
      if (command === "helm" && args[0] === "status") {
        return ok('{"info":{"status":"deployed"}}');
      }
      if (args.some((arg) => arg.includes("spec.clusterIP"))) {
        return ok(clusterIp);
      }
      if (command === "kubectl" && args.includes("--output=name")) {
        return ok(
          "deployment/reference-api\ndeployment.apps/reference-worker\n",
        );
      }
      if (command === "kubectl" && args.includes("namespace")) {
        return ok("kube-system");
      }
      return ok("");
    },
  };
}

export const passthroughRegistry = async (
  _repository: unknown,
  _runner: unknown,
  reference: string,
): Promise<string> => reference;
