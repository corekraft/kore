// Docs: docs/decisions/0034-registry-authentication-and-authorization.md
import { createHash, randomBytes, type Hash } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { registryPlan } from "../config/index.js";
import { fakeRepository, fakeRunner } from "./images-support.js";
import {
  applyRegistryCredentials,
  ensureRegistryAuth,
  generated,
  htpasswdLine,
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryAddress,
  registryPullSecret,
  withSecretsRedacted,
} from "./registry-auth.js";

vi.mock("node:crypto");
vi.mock("../config/index.js");

interface Manifest {
  kind: string;
  metadata: { name: string; namespace?: string };
  data?: Record<string, string>;
}

const encode = (value: string): string => Buffer.from(value).toString("base64");
const decode = (value: string | undefined): string =>
  Buffer.from(value ?? "", "base64").toString("utf8");
const noSecret = (): string => "";
const storedSecret = JSON.stringify({
  data: {
    "push-username": encode("kore-push"),
    "push-password": encode("existing-push"),
    "read-username": encode("kore-read"),
    "read-password": encode("existing-read"),
  },
});

/** Each random password is a fixed label, so the expected Secret data is exact. */
function fixedPasswords(push: string, read: string): void {
  vi.mocked(randomBytes)
    .mockReturnValueOnce({ toString: () => push } as never)
    .mockReturnValueOnce({ toString: () => read } as never);
}

/** The SHA-1 digest is `sha:` plus the hashed text, so the htpasswd lines are exact. */
function fakeSha1(): void {
  vi.mocked(createHash).mockImplementation(() => {
    let text = "";
    const hash = {
      update: (value: string) => {
        text = value;
        return hash;
      },
      digest: () => `sha:${text}`,
    };
    return hash as unknown as Hash;
  });
}

/** The items of the one apply call, decoded from its stdin. */
function appliedItems(
  calls: readonly (readonly unknown[])[],
): Record<string, unknown>[] {
  const apply = calls.find((call) => (call[1] as string[]).includes("apply"));
  if (apply === undefined) {
    throw new Error("no apply call was made");
  }
  return (
    JSON.parse((apply[2] as { input: string }).input) as {
      items: Record<string, unknown>[];
    }
  ).items;
}

function secretData(
  items: Record<string, unknown>[],
  name: string,
): Record<string, string> {
  const secret = items.find(
    (item) => (item as unknown as Manifest).metadata.name === name,
  ) as unknown as Manifest;
  return Object.fromEntries(
    Object.entries(secret.data ?? {}).map(([key, value]) => [
      key,
      decode(value),
    ]),
  );
}

beforeEach(() => {
  vi.mocked(registryPlan).mockReturnValue({
    address: "10.96.0.50:5000",
    clusterIP: "10.96.0.50",
  } as never);
  fakeSha1();
});

test("generated credentials reach the cluster through stdin only, and the push and read passwords differ", async () => {
  fixedPasswords("PUSH", "READ");
  const { runner, run } = fakeRunner(noSecret);

  await ensureRegistryAuth(fakeRepository(), runner);

  expect(
    secretData(appliedItems(run.mock.calls), "oci-registry-credentials"),
  ).toEqual({
    "push-username": "kore-push",
    "push-password": "PUSH",
    "read-username": "kore-read",
    "read-password": "READ",
  });
  expect(JSON.stringify(run.mock.calls.map(([, args]) => args))).not.toContain(
    "PUSH",
  );
  expect(run.mock.calls.at(-1)?.[1]).toContain("--filename=-");
});

test("the htpasswd Secret holds one hashed line per identity and no password", async () => {
  fixedPasswords("PUSH", "READ");
  const { runner, run } = fakeRunner(noSecret);

  await ensureRegistryAuth(fakeRepository(), runner);

  expect(secretData(appliedItems(run.mock.calls), "oci-registry-auth")).toEqual(
    {
      htpasswd: "kore-push:{SHA}sha:PUSH\nkore-read:{SHA}sha:READ\n",
    },
  );
});

test("existing credentials are kept and nothing is generated, so a rerun never rotates what live pods use", async () => {
  const { runner, run } = fakeRunner(() => storedSecret);

  await ensureRegistryAuth(fakeRepository(), runner);

  expect(randomBytes).not.toHaveBeenCalled();
  expect(
    secretData(appliedItems(run.mock.calls), "oci-registry-credentials"),
  ).toEqual({
    "push-username": "kore-push",
    "push-password": "existing-push",
    "read-username": "kore-read",
    "read-password": "existing-read",
  });
});

test("the registry namespace is applied first and every Secret lives in it", async () => {
  fixedPasswords("PUSH", "READ");
  const { runner, run } = fakeRunner(noSecret);

  await ensureRegistryAuth(fakeRepository(), runner);

  const items = appliedItems(run.mock.calls) as unknown as Manifest[];
  expect(items[0]).toEqual({
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: "kore-registry" },
  });
  expect(items.slice(1).map((item) => item.metadata.namespace)).toEqual([
    "kore-registry",
    "kore-registry",
  ]);
});

test("every kubectl call names the configured context before anything else", async () => {
  fixedPasswords("PUSH", "READ");
  const { runner, run } = fakeRunner(noSecret);

  await ensureRegistryAuth(
    fakeRepository({ kubeContext: "k3d-other" }),
    runner,
  );

  expect(run.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
    ["--context", "k3d-other"],
    ["--context", "k3d-other"],
  ]);
});

test("a missing credentials Secret is reported with the platform command that creates it", async () => {
  const { runner } = fakeRunner(noSecret);

  await expect(
    loadRegistryCredential(fakeRepository(), runner, "push"),
  ).rejects.toThrow(
    "registry credentials Secret kore-registry/oci-registry-credentials is missing or incomplete; run `kore platform up --env local` to create it",
  );
});

test("a Secret with an empty password is incomplete, and is treated as absent", async () => {
  const incomplete = JSON.stringify({
    data: {
      "push-username": encode("kore-push"),
      "push-password": "",
      "read-username": encode("kore-read"),
      "read-password": encode("r"),
    },
  });
  const { runner } = fakeRunner(() => incomplete);

  await expect(
    loadRegistryCredential(fakeRepository(), runner, "read"),
  ).rejects.toThrow(/missing or incomplete/);
});

test("the read credential is the read identity alone, never the push one", async () => {
  const { runner } = fakeRunner(() => storedSecret);

  await expect(
    loadRegistryCredential(fakeRepository(), runner, "read"),
  ).resolves.toEqual({ username: "kore-read", password: "existing-read" });
});

test("generated identities are kore-push and kore-read unless a rotation names a new read username", () => {
  fixedPasswords("PUSH", "READ");
  expect(generated()).toEqual({
    push: { username: "kore-push", password: "PUSH" },
    read: { username: "kore-read", password: "READ" },
  });

  fixedPasswords("PUSH", "READ");
  expect(generated("kore-read-1a2b").read.username).toBe("kore-read-1a2b");
});

test("the htpasswd line hashes the password with SHA-1 in the {SHA} form", () => {
  expect(htpasswdLine({ username: "kore-push", password: "secret" })).toBe(
    "kore-push:{SHA}sha:secret",
  );
  expect(createHash).toHaveBeenCalledWith("sha1");
});

test("the pull Secret is a dockerconfigjson for the registry address with the read identity", () => {
  expect(
    registryPullSecret(
      "10.96.0.50:5000",
      { username: "kore-read", password: "r" },
      "demo",
    ),
  ).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "kore-registry-read",
      namespace: "demo",
      labels: { "app.kubernetes.io/managed-by": "kore-app" },
    },
    type: "kubernetes.io/dockerconfigjson",
    data: {
      ".dockerconfigjson": encode(
        JSON.stringify({
          auths: {
            "10.96.0.50:5000": {
              username: "kore-read",
              password: "r",
              auth: encode("kore-read:r"),
            },
          },
        }),
      ),
    },
  });
});

test("kore manages registry auth only where the plan has a cluster address, and names that address", () => {
  expect(koreManagesRegistryAuth(fakeRepository())).toBe(true);
  expect(registryAddress(fakeRepository())).toBe("10.96.0.50:5000");

  vi.mocked(registryPlan).mockReturnValue({
    address: "registry.example.com",
  } as never);
  expect(koreManagesRegistryAuth(fakeRepository())).toBe(false);
});

test("the apply of new credentials keeps any retained htpasswd lines after the two identities", async () => {
  const { runner, run } = fakeRunner();

  await applyRegistryCredentials(
    fakeRepository(),
    runner,
    {
      push: { username: "kore-push", password: "P" },
      read: { username: "kore-read-2", password: "R" },
    },
    ["kore-read:{SHA}old"],
  );

  expect(secretData(appliedItems(run.mock.calls), "oci-registry-auth")).toEqual(
    {
      htpasswd:
        "kore-push:{SHA}sha:P\nkore-read-2:{SHA}sha:R\nkore-read:{SHA}old\n",
    },
  );
});

test("withSecretsRedacted replaces every secret in the message and the stack, then rethrows", async () => {
  const failure = new Error("apply failed for PUSH and READ");
  failure.stack = "Error: apply failed for PUSH and READ\n  at PUSH";

  await expect(
    withSecretsRedacted(["PUSH", "READ"], async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(failure.message).toBe("apply failed for [REDACTED] and [REDACTED]");
  expect(failure.stack).toBe(
    "Error: apply failed for [REDACTED] and [REDACTED]\n  at [REDACTED]",
  );
});

test("an empty secret redacts nothing, and a non-Error failure passes through untouched", async () => {
  const failure = new Error("visible text");
  await expect(
    withSecretsRedacted(["", "absent"], async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(failure.message).toBe("visible text");

  await expect(
    withSecretsRedacted(["PUSH"], async () => {
      throw "PUSH";
    }),
  ).rejects.toBe("PUSH");
});

test("withSecretsRedacted returns the operation's result when nothing fails", async () => {
  await expect(withSecretsRedacted(["PUSH"], async () => "done")).resolves.toBe(
    "done",
  );
});
