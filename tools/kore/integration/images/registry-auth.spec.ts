import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { RecordingRunner } from "../../src/runtime/index.js";
import {
  ensureRegistryAuth,
  loadRegistryCredential,
  registryPullSecret,
} from "../../src/images/index.js";

interface Manifest {
  kind: string;
  metadata: { name: string; namespace?: string };
  type?: string;
  data?: Record<string, string>;
}

function applied(runner: RecordingRunner): Manifest[] {
  const apply = runner.calls.find((call) => call.args.includes("apply"));
  const list = JSON.parse(apply?.options?.input ?? "{}") as {
    items: Manifest[];
  };
  return list.items;
}

function decode(manifest: Manifest | undefined, key: string): string {
  return Buffer.from(manifest?.data?.[key] ?? "", "base64").toString("utf8");
}

const none = { stdout: "", stderr: "", code: 0 };

test("generated registry credentials reach the cluster only through stdin, never argv", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([none]);

  await ensureRegistryAuth(repository, runner);

  const items = applied(runner);
  const credentials = items.find(
    (item) => item.metadata.name === "oci-registry-credentials",
  );
  const pushPassword = decode(credentials, "push-password");
  const readPassword = decode(credentials, "read-password");
  expect(pushPassword.length).toBeGreaterThanOrEqual(32);
  expect(readPassword.length).toBeGreaterThanOrEqual(32);
  expect(pushPassword).not.toBe(readPassword);
  const argv = JSON.stringify(runner.calls.map((call) => call.args));
  expect(argv).not.toContain(pushPassword);
  expect(argv).not.toContain(readPassword);
  expect(argv).toContain("--filename=-");
});

test("the htpasswd Secret holds only hashes of the two distinct identities", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([none]);

  await ensureRegistryAuth(repository, runner);

  const items = applied(runner);
  const credentials = items.find(
    (item) => item.metadata.name === "oci-registry-credentials",
  );
  const htpasswd = decode(
    items.find((item) => item.metadata.name === "oci-registry-auth"),
    "htpasswd",
  );
  const pushPassword = decode(credentials, "push-password");
  const readPassword = decode(credentials, "read-password");
  const sha = (secret: string): string =>
    createHash("sha1").update(secret).digest("base64");
  expect(htpasswd.split("\n").filter(Boolean)).toEqual([
    `kore-push:{SHA}${sha(pushPassword)}`,
    `kore-read:{SHA}${sha(readPassword)}`,
  ]);
  expect(htpasswd).not.toContain(pushPassword);
  expect(htpasswd).not.toContain(readPassword);
});

test("the registry namespace is created with the Secrets so the first release can mount them", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([none]);

  await ensureRegistryAuth(repository, runner);

  const items = applied(runner);
  expect(items[0]).toMatchObject({
    kind: "Namespace",
    metadata: { name: "kore-registry" },
  });
  for (const item of items.slice(1)) {
    expect(item.metadata.namespace).toBe("kore-registry");
  }
});

test("existing credentials are kept so a rerun never rotates what live pods use", async () => {
  const repository = await loadRepository("local");
  const encode = (value: string): string =>
    Buffer.from(value).toString("base64");
  const existing = JSON.stringify({
    data: {
      "push-username": encode("kore-push"),
      "push-password": encode("existing-push-password-0123456789abcdef"),
      "read-username": encode("kore-read"),
      "read-password": encode("existing-read-password-0123456789abcdef"),
    },
  });
  const runner = new RecordingRunner([{ ...none, stdout: existing }]);

  await ensureRegistryAuth(repository, runner);

  const credentials = applied(runner).find(
    (item) => item.metadata.name === "oci-registry-credentials",
  );
  expect(decode(credentials, "push-password")).toBe(
    "existing-push-password-0123456789abcdef",
  );
  expect(decode(credentials, "read-password")).toBe(
    "existing-read-password-0123456789abcdef",
  );
});

test("every mutation names the configured context", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([none]);

  await ensureRegistryAuth(repository, runner);

  for (const call of runner.calls) {
    expect(call.args.slice(0, 2)).toEqual([
      "--context",
      repository.environment.kubeContext,
    ]);
  }
});

test("a missing credentials Secret is reported with the command that creates it", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([none]);

  await expect(
    loadRegistryCredential(repository, runner, "push"),
  ).rejects.toThrow(/kore platform up --env local/);
});

test("the read credential never carries the push identity", async () => {
  const repository = await loadRepository("local");
  const encode = (value: string): string =>
    Buffer.from(value).toString("base64");
  const secret = JSON.stringify({
    data: {
      "push-username": encode("kore-push"),
      "push-password": encode("p"),
      "read-username": encode("kore-read"),
      "read-password": encode("r"),
    },
  });
  const runner = new RecordingRunner([{ ...none, stdout: secret }]);

  const credential = await loadRegistryCredential(repository, runner, "read");

  expect(credential).toEqual({ username: "kore-read", password: "r" });
});

test("the pull Secret is a dockerconfigjson for the registry address with the read credential", () => {
  const manifest = registryPullSecret(
    "10.96.0.50:5000",
    { username: "kore-read", password: "r" },
    "demo",
  ) as Manifest;

  expect(manifest.type).toBe("kubernetes.io/dockerconfigjson");
  expect(manifest.metadata).toMatchObject({
    name: "kore-registry-read",
    namespace: "demo",
  });
  const config = JSON.parse(decode(manifest, ".dockerconfigjson")) as {
    auths: Record<string, { username: string; password: string }>;
  };
  expect(config.auths["10.96.0.50:5000"]).toMatchObject({
    username: "kore-read",
    password: "r",
  });
});
