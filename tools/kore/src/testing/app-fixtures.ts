import { loadLocalGatewayFlagsOff } from "./gateway-flags-off.fixtures.js";
import { platformGeneration } from "../platform/index.js";
import { registryTlsSecret } from "./registry-tls-fixtures.js";
import {
  gatedOffReleaseAbsent,
  healthyApplicationOutput,
  healthyDaemonSetOutput,
  healthyWebhookOutput,
} from "./webhook-fixtures.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { defaultPlatformDomain } from "../config/index.js";

import { digest, releaseSigner } from "./release-lock-fixtures.js";
export {
  digest,
  releaseSigner,
  removeReleaseLocks,
  writeReleaseLock,
} from "./release-lock-fixtures.js";

export function lockedImage(
  signer = "local-kore-key",
  registry = `registry.${defaultPlatformDomain}:30500`,
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

export const readPassword = "read-password-0123456789-abcdefghijklmn";
export const pushPassword = "push-password-0123456789-abcdefghijklmnop";
const b64 = (value: string): string => Buffer.from(value).toString("base64");
const registryCredentials = JSON.stringify({
  data: {
    "push-username": b64("kore-push"),
    "push-password": b64(pushPassword),
    "read-username": b64("kore-read"),
    "read-password": b64(readPassword),
  },
});

/** The generation of the local repository, which a gate must carry to be current. */
export const localGeneration = platformGeneration(
  await loadLocalGatewayFlagsOff(),
);

export function gateOutput(
  state: string,
  generation = localGeneration,
): string {
  return JSON.stringify({ spec: { parameters: { state, generation } } });
}

/** What a healthy cluster answers to the platform readiness probes, if any. */
export function healthyReadinessOutput(
  args: readonly string[],
): string | undefined {
  if (args.includes("koreapplicationadmission.constraints.gatekeeper.sh")) {
    return gateOutput("open");
  }
  if (args.some((arg) => arg.includes("platform\\.kore\\.dev/activation"))) {
    return localGeneration; // the activation label read back after activation
  }
  if (args.includes("oci-registry-credentials")) {
    return registryCredentials;
  }
  if (args.includes("oci-registry-tls")) {
    return registryTlsSecret;
  }
  if (args.includes("service") && args.includes("--selector")) {
    return healthyService;
  }
  const webhook = healthyWebhookOutput(args) ?? healthyApplicationOutput(args);
  if (webhook !== undefined) {
    return webhook;
  }
  if (args.some((arg) => arg.startsWith("gateway/"))) {
    return healthyGateway;
  }
  if (args.some((arg) => arg.includes("policy\\.sigstore\\.dev/include"))) {
    return "true"; // the namespace admission label read back after enrollment
  }
  const daemonSet = healthyDaemonSetOutput(args);
  if (daemonSet !== undefined) {
    return daemonSet;
  }
  if (args.some((arg) => arg.startsWith("go-template="))) {
    return "ready";
  }
  return undefined;
}

/** What Helm answers for the history of a release that was never installed. */
export function releaseNotFound(
  command: string,
  args: readonly string[],
): void {
  gatedOffReleaseAbsent(command, args);
  if (command === "helm" && args[0] === "history") {
    throw new CommandError(command, args, {
      stdout: "",
      stderr: "Error: release: not found",
      code: 1,
    });
  }
}

/** What `k3d cluster list` answers while the local cluster runs. */
const runningK3dList = JSON.stringify([
  {
    name: "kore-local",
    serversCount: 1,
    serversRunning: 1,
    agentsCount: 0,
    agentsRunning: 0,
  },
]);

/** Records every call and answers like a healthy local cluster. */
export function healthyRunner(
  calls: Call[],
  clusterIp = "10.96.0.50",
  fail?: (call: Call) => boolean,
): Runner {
  return {
    async run(command, args) {
      calls.push({ command, args });
      releaseNotFound(command, args);
      if (fail?.({ command, args })) {
        throw new Error(`${command} failed`);
      }
      const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      const readiness = healthyReadinessOutput(args);
      if (command === "kubectl" && readiness !== undefined) {
        return ok(readiness);
      }
      if (command === "k3d" && args[1] === "list") {
        return ok(runningK3dList);
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

/**
 * The local repository, but with an image policy that trusts the release
 * subject (ADR 0059), so a release-signed lock entry is deployable. Without
 * it, local trusts only `local-kore-key`.
 */
export async function repositoryTrustingRelease(
  signer = releaseSigner,
): ReturnType<typeof loadLocalGatewayFlagsOff> {
  const base = await loadLocalGatewayFlagsOff();
  return {
    ...base,
    imageTrustValues: {
      trust: { type: "keyless", mode: "warn", subjects: [signer] },
    },
  };
}
