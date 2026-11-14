// Docs: docs/decisions/0055-registry-credential-rotation.md
import { randomBytes } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import {
  applyRegistryCredentials,
  existingCredentials,
  generated,
  htpasswdLine,
  koreManagesRegistryAuth,
  registryAddress,
  registryPullSecret,
  withSecretsRedacted,
} from "./registry-auth.js";
import { asFake, fakeRepository, fakeRunner } from "./images-support.js";
import { rotateRegistryCredentials } from "./registry-rotation.js";

vi.mock("node:crypto");
vi.mock("./registry-auth.js");

const previous = {
  push: { username: "kore-push", password: "old-push" },
  read: { username: "kore-read", password: "old-read" },
};
const next = {
  push: { username: "kore-push", password: "NEW-PUSH" },
  read: { username: "kore-read-abcd", password: "NEW-READ" },
};
const fast = { yes: true, attempts: 2, sleep: vi.fn(async () => undefined) };

/** The proxy's view: what the last applied htpasswd holds, one line per identity. */
let served: string[] = [];

beforeEach(() => {
  served = [];
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(registryAddress).mockReturnValue("10.96.0.50:5000");
  vi.mocked(existingCredentials).mockResolvedValue(previous);
  vi.mocked(generated).mockReturnValue(next);
  vi.mocked(randomBytes).mockReturnValue(
    asFake({
      toString: () => "abcd",
    }),
  );
  vi.mocked(htpasswdLine).mockImplementation(
    (credential) => `${credential.username}:{SHA}${credential.password}`,
  );
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
  vi.mocked(applyRegistryCredentials).mockImplementation(
    async (_repository, _runner, credentials, retained = []) => {
      served = [
        htpasswdLine(credentials.push),
        htpasswdLine(credentials.read),
        ...retained,
      ];
    },
  );
  vi.mocked(registryPullSecret).mockImplementation(
    (_address, credential, namespace) => ({
      namespace,
      user: credential.username,
    }),
  );
});

/** The proxy serves `served`, the namespaces are a and b, and the old read line is the only retained one. */
function clusterReplies(args: readonly string[]): string {
  if (args.includes("exec")) {
    return served.join("\n");
  }
  if (args.includes("namespaces")) {
    return "a b";
  }
  if (args.includes("oci-registry-auth")) {
    return JSON.stringify({
      data: {
        htpasswd: Buffer.from("kore-read-old:{SHA}x\n").toString("base64"),
      },
    });
  }
  return "";
}

test("rotation refuses without --yes, and runs no command", async () => {
  const { runner, run } = fakeRunner(clusterReplies);

  await expect(
    rotateRegistryCredentials(fakeRepository(), runner, {
      ...fast,
      yes: false,
    }),
  ).rejects.toThrow(
    "rotating the registry credentials invalidates every credential issued so far and requires --yes",
  );
  expect(run).not.toHaveBeenCalled();
});

test("rotation refuses an environment whose registry credentials the provider owns", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, run } = fakeRunner(clusterReplies);

  await expect(
    rotateRegistryCredentials(fakeRepository(), runner, fast),
  ).rejects.toThrow(
    "environment local uses an external registry whose credentials the provider owns; rotate them there",
  );
  expect(run).not.toHaveBeenCalled();
});

test("rotation refuses when no complete credentials exist to rotate from", async () => {
  vi.mocked(existingCredentials).mockResolvedValue(undefined);
  const { runner } = fakeRunner(clusterReplies);

  await expect(
    rotateRegistryCredentials(fakeRepository(), runner, fast),
  ).rejects.toThrow(
    "registry credentials Secret kore-registry/oci-registry-credentials is missing or incomplete; run `kore platform up --env local` to create it",
  );
});

test("rotation writes the new read identity alongside the retained read lines, then moves every namespace and drops the old lines", async () => {
  const { runner } = fakeRunner(clusterReplies);

  const result = await rotateRegistryCredentials(
    fakeRepository(),
    runner,
    fast,
  );

  expect(result).toEqual({ namespaces: ["a", "b"] });
  expect(vi.mocked(applyRegistryCredentials).mock.calls).toEqual([
    [
      fakeRepository(),
      runner,
      next,
      ["kore-read:{SHA}old-read", "kore-read-old:{SHA}x"],
    ],
    [fakeRepository(), runner, next],
  ]);
});

test("each enrolled namespace gets a pull Secret for the new read identity, one at a time", async () => {
  const { runner, run } = fakeRunner(clusterReplies);

  await rotateRegistryCredentials(fakeRepository(), runner, fast);

  expect(vi.mocked(registryPullSecret).mock.calls).toEqual([
    ["10.96.0.50:5000", next.read, "a"],
    ["10.96.0.50:5000", next.read, "b"],
  ]);
  const pullApplies = run.mock.calls.filter(([, args]) =>
    args.includes("--field-manager=kore-app"),
  );
  expect(pullApplies).toHaveLength(2);
});

test("pull Secrets change only after the proxy serves the new credentials, and a stuck proxy leaves them alone", async () => {
  vi.mocked(applyRegistryCredentials).mockResolvedValue(undefined);
  const { runner, run } = fakeRunner(clusterReplies);

  await expect(
    rotateRegistryCredentials(fakeRepository(), runner, fast),
  ).rejects.toThrow(
    "the registry proxy did not serve the new credentials after 2 checks (it reads /etc/nginx/auth/htpasswd from the oci-registry-auth Secret, which the kubelet syncs into the pod); no pull Secret was changed. Check the oci-registry pod is Ready, then rerun `kore registry rotate-credentials --yes`, which is safe to repeat",
  );
  expect(fast.sleep).toHaveBeenCalledExactlyOnceWith(5000);
  expect(registryPullSecret).not.toHaveBeenCalled();
  expect(
    run.mock.calls.some(([, args]) =>
      args.includes("--field-manager=kore-app"),
    ),
  ).toBe(false);
});

test("the passwords, old and new, are the secrets redacted from any failure", async () => {
  const { runner } = fakeRunner(clusterReplies);

  await rotateRegistryCredentials(fakeRepository(), runner, fast);

  expect(withSecretsRedacted).toHaveBeenCalledWith(
    ["old-push", "old-read", "NEW-PUSH", "NEW-READ"],
    expect.any(Function),
  );
});

test("every kubectl call names the configured context", async () => {
  const { runner, run } = fakeRunner(clusterReplies);

  await rotateRegistryCredentials(
    fakeRepository({ kubeContext: "k3d-other" }),
    runner,
    fast,
  );

  for (const [, args] of run.mock.calls) {
    expect(args.slice(0, 2)).toEqual(["--context", "k3d-other"]);
  }
});

test("the new read username is random, so the proxy can hold old and new read identities side by side", async () => {
  const { runner } = fakeRunner(clusterReplies);

  await rotateRegistryCredentials(fakeRepository(), runner, fast);

  expect(randomBytes).toHaveBeenCalledWith(4);
  expect(generated).toHaveBeenCalledWith("kore-read-abcd");
});
