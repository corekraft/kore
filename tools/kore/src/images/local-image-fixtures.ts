import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mock } from "vitest";
import { registryCaPem } from "./registry-tls-fixtures.js";
import type { ImageLockEntry } from "./image-lock.js";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";

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
  // No source tag is held, so each run builds; a spec that reuses one sets it.
  registryHead.mockImplementation(async (url: string) =>
    String(url).includes("/manifests/kore-src-")
      ? { status: 404, digest: "" }
      : { status: 200, digest },
  );
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );
}

export const entry: ImageLockEntry = {
  image: "registry.kore.local:30500/reference",
  digest: `sha256:${"a".repeat(64)}`,
  signer: "release@kore.dev",
};
