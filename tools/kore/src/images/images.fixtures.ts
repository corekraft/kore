import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi, type Mock } from "vitest";
import type { Repository } from "../config/index.js";

/** A stand-in registry CA: public material only, enough for the PEM framing. */
const registryCaPem =
  "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
import type { ImageLockEntry } from "./image-lock.js";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";

// Fakes and fixtures shared by the images domain's specs. A support file is not
// a unit, so it needs no spec of its own (ADR 0098).

/** A typed runner whose stdout depends on the command and its arguments. */
export function typedRunner(
  stdout: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Runner["run"]>(async (command, args) => ({
    stdout: stdout(command, args),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/**
 * A k3d repository with the fields the images units read. Overrides replace
 * the environment's fields. The one cast stands in for the rest of the overlay.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return {
    root,
    environment: {
      name: "local",
      provider: "k3d",
      kubeContext,
      k3d: { clusterName: "kore-local" },
      ...environment,
    },
    imageTrustValues: {},
  } as unknown as Repository;
}

export const digest = `sha256:${"d".repeat(64)}`;

export const kubeContext = "k3d-kore-local";
export const secretRef = "k8s://kore-system/kore-local-signing-key";
export const minifiedKubeconfig = `apiVersion: v1
kind: Config
current-context: k3d-kore-local
clusters:
  - name: k3d-kore-local
    cluster: {server: "https://0.0.0.0:6443", certificate-authority-data: Q0E=}
contexts:
  - name: k3d-kore-local
    context: {cluster: k3d-kore-local, user: admin@k3d-kore-local}
users:
  - name: admin@k3d-kore-local
    user: {client-certificate-data: Q0VSVA==, client-key-data: S0VZ}
`;

// The real cosign writes cosign.pub into its working directory.
async function writeCosignPub(cwd: string | undefined): Promise<void> {
  await writeFile(join(cwd ?? process.cwd(), "cosign.pub"), "pub");
}

export const pushPassword = "push-password-0123456789-abcdefghijklmnop";
export const encodeBase64 = (value: string): string =>
  Buffer.from(value).toString("base64");
export const registryCredentialsJson = JSON.stringify({
  data: {
    "push-username": encodeBase64("kore-push"),
    "push-password": encodeBase64(pushPassword),
    "read-username": encodeBase64("kore-read"),
    "read-password": encodeBase64("read-password-0123456789-abcdefghijklmn"),
  },
});

export function fakeRunner(
  options: {
    clusterIp?: string;
    secretExists?: boolean;
    kubeconfig?: string;
  } = {},
) {
  const calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions;
  }[] = [];
  let exists = options.secretExists ?? false;
  const runner: Runner = {
    async run(command, args, runOptions): Promise<RunResult> {
      calls.push({
        command,
        args,
        ...(runOptions ? { options: runOptions } : {}),
      });
      let stdout = "";
      if (command === "cosign" && args[0] === "generate-key-pair") {
        exists = true;
        await writeCosignPub(runOptions?.cwd);
      }
      if (command === "kubectl") {
        if (args.includes("oci-registry-credentials")) {
          stdout = registryCredentialsJson;
        } else if (args.includes("oci-registry-tls")) {
          stdout = JSON.stringify({
            data: { "ca.crt": encodeBase64(registryCaPem) },
          });
        } else if (args.includes("secret") && args.includes("--output=name")) {
          stdout = exists ? "secret/kore-local-signing-key\n" : "";
        } else if (
          args.some((arg) => arg.startsWith("--output=jsonpath={.data"))
        ) {
          stdout = Buffer.from("local public key").toString("base64");
        } else if (args.includes("config")) {
          stdout = options.kubeconfig ?? minifiedKubeconfig;
        } else {
          stdout = options.clusterIp ?? "10.96.0.50";
        }
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

export async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

export function stubRegistry(
  registryReference: Mock,
  registryHead: Mock,
): void {
  registryHead.mockResolvedValue({ status: 200, digest });
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );
}

export const entry: ImageLockEntry = {
  image: "registry.kore.local:30500/reference",
  digest: `sha256:${"a".repeat(64)}`,
  signer: "release@kore.dev",
};
