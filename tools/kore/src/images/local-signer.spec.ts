import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import {
  ensureLocalSigningPublicKey,
  localSigningPublicNamespace,
  localSigningPublicSecret,
} from "./local-signer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

const kubeconfig = `apiVersion: v1
kind: Config
current-context: kore-local
clusters:
  - name: kore-local
    cluster: {server: "https://192.168.49.2:8443", certificate-authority: /home/u/.minikube/ca.crt}
contexts:
  - name: kore-local
    context: {cluster: kore-local, user: kore-local}
users:
  - name: kore-local
    user: {client-certificate: /home/u/.minikube/client.crt, client-key: /home/u/.minikube/client.key}
`;

type Call = { command: string; args: readonly string[]; options?: RunOptions };

async function setup(): Promise<{
  repository: Repository;
  runner: Runner;
  calls: Call[];
}> {
  const root = await mkdtemp(join(tmpdir(), "kore-signer-"));
  roots.push(root);
  const repository = { ...(await loadRepository("local")), root };
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args, options): Promise<RunResult> {
      calls.push({ command, args, ...(options ? { options } : {}) });
      let stdout = "";
      if (command === "kubectl" && args.includes("config")) {
        stdout = kubeconfig;
      } else if (args.includes("--output=name")) {
        stdout = "secret/kore-local-signing-key\n";
      } else if (args.some((a) => a.startsWith("--output=jsonpath={.data"))) {
        stdout = Buffer.from("PUBLIC KEY").toString("base64");
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { repository, runner, calls };
}

test("the public key is published as a single-entry Secret in the policy-controller namespace through stdin", async () => {
  const { repository, runner, calls } = await setup();

  await ensureLocalSigningPublicKey(repository, runner);

  const apply = calls.find(({ args }) => args.includes("apply"))!;
  expect(apply.command).toBe("kubectl");
  expect(apply.args).toEqual([
    "--context",
    "kore-local",
    "apply",
    "--server-side",
    "--field-manager=kore-signing",
    "--force-conflicts",
    "--filename=-",
  ]);
  const secret = JSON.parse(apply.options?.input ?? "{}");
  expect(secret.metadata.namespace).toBe("cosign-system");
  expect(localSigningPublicNamespace).toBe("cosign-system");
  expect(secret.metadata.name).toBe(localSigningPublicSecret);
  expect(secret.metadata.labels["app.kubernetes.io/managed-by"]).toBe(
    "kore-signing",
  );
  expect(Object.keys(secret.data)).toEqual(["cosign.pub"]);
  expect(secret.stringData).toBeUndefined();
  expect(Buffer.from(secret.data["cosign.pub"], "base64").toString()).toBe(
    "PUBLIC KEY",
  );
});

test("no private key material is read, streamed or written when publishing the public key", async () => {
  const { repository, runner, calls } = await setup();

  await ensureLocalSigningPublicKey(repository, runner);

  for (const call of calls) {
    const text = [...call.args, call.options?.input ?? ""].join(" ");
    expect(text).not.toMatch(/cosign\.key|cosign\.password|\.data\}|-o yaml/);
    expect(text).not.toMatch(/--output=(json|yaml)(\s|$)/);
  }
  const reads = calls.filter(({ args }) => args.includes("get"));
  for (const read of reads) {
    expect(
      read.args.some(
        (a) => a === "--output=name" || a.includes("{.data.cosign\\.pub}"),
      ),
    ).toBe(true);
  }
});

test("the key pair is ensured before the public Secret is applied", async () => {
  const { repository, runner, calls } = await setup();
  await ensureLocalSigningPublicKey(repository, runner);
  const names = calls.map(({ args }) => {
    if (args.includes("apply")) {
      return "apply";
    }
    return args.includes("--output=name") ? "check-key" : "other";
  });
  expect(names.indexOf("check-key")).toBeGreaterThanOrEqual(0);
  expect(names.indexOf("check-key")).toBeLessThan(names.indexOf("apply"));
});
