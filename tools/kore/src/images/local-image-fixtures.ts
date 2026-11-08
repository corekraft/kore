import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi, type Mock } from "vitest";
import type { ImageLockEntry } from "./image-lock.js";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";

export const digest = `sha256:${"d".repeat(64)}`;

export const kubeContext = "kore-local";
export const secretRef = "k8s://kore-system/kore-local-signing-key";
export const minifiedKubeconfig = `apiVersion: v1
kind: Config
current-context: ${kubeContext}
clusters:
  - name: kore-local
    cluster: {server: "https://192.168.49.2:8443", certificate-authority: /home/u/.minikube/ca.crt}
contexts:
  - name: ${kubeContext}
    context: {cluster: kore-local, user: kore-local}
users:
  - name: kore-local
    user: {client-certificate: /home/u/.minikube/client.crt, client-key: /home/u/.minikube/client.key}
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

export function stubRegistry(registryReference: Mock): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "docker-content-digest": digest },
      }),
    ),
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
