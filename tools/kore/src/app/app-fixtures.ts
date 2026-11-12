import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { registryTlsSecret } from "../images/registry-tls-fixtures.js";
import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import { platformGeneration } from "../platform/admission-gate.js";
import {
  gatedOffReleaseAbsent,
  healthyDaemonSetOutput,
  healthyWebhookOutput,
} from "../platform/webhook-fixtures.js";
import { CommandError, type Runner } from "../runtime/index.js";

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
export const localGeneration = platformGeneration(await loadMinikubeLocal());

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

export const releaseSigner =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.1";

const lockDirectories: string[] = [];

/**
 * Writes an image lock like the one the release workflow emits and returns its
 * path relative to the repository root, as `appUp` takes it.
 */
export async function writeReleaseLock(
  root: string,
  signer = releaseSigner,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kore-release-lock-"));
  lockDirectories.push(directory);
  const path = join(directory, "images.lock.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      authorizedSigners: [signer],
      entries: {
        reference: {
          image: "registry.kore.local:30500/reference",
          digest,
          signer,
        },
      },
    }),
  );
  return relative(root, path);
}

export async function removeReleaseLocks(): Promise<void> {
  await Promise.all(
    lockDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

/**
 * The local repository, but with an image policy that trusts the release
 * subject (ADR 0059), so a release-signed lock entry is deployable. Without
 * it, local trusts only `local-kore-key`.
 */
export async function repositoryTrustingRelease(
  signer = releaseSigner,
): ReturnType<typeof loadMinikubeLocal> {
  const base = await loadMinikubeLocal();
  return {
    ...base,
    imageTrustValues: {
      trust: { type: "keyless", mode: "warn", subjects: [signer] },
    },
  };
}
