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

/** Records every call and answers like a healthy local cluster. */
export function healthyRunner(
  calls: Call[],
  clusterIp = "10.0.0.8",
  fail?: (call: Call) => boolean,
): Runner {
  return {
    async run(command, args) {
      calls.push({ command, args });
      if (fail?.({ command, args })) {
        throw new Error(`${command} failed`);
      }
      const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
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
