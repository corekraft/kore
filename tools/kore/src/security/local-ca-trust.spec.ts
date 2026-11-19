// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { expect, test } from "vitest";
import { ensureLocalCaTrust } from "./local-ca-trust.js";
import { fakeRepository, fakeRunner } from "./security-support.js";

const local =
  "-----BEGIN CERTIFICATE-----\nTE9DQUw=\n-----END CERTIFICATE-----\n";
const cluster =
  "-----BEGIN CERTIFICATE-----\nQ0xVU1RFUg==\n-----END CERTIFICATE-----\n";
const encoded = (value: string) => Buffer.from(value).toString("base64");

/** The cluster's replies: the CA key pair Secret (with its private key) and the cluster CA ConfigMap. */
function reply(_command: string, args: readonly string[]): string {
  if (args.includes("secret")) {
    return JSON.stringify({
      data: { "tls.crt": encoded(local), "tls.key": encoded("PRIVATE") },
    });
  }
  return JSON.stringify({ data: { "ca.crt": cluster } });
}

const repository = fakeRepository();

test("the local CA's public certificate is read from the CA key pair Secret, asking the configured context", async () => {
  const { runner, run } = fakeRunner(reply);

  await ensureLocalCaTrust(repository, runner, "backstage");

  expect(run.mock.calls.slice(0, 2)).toEqual([
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "cert-manager",
        "get",
        "secret",
        "kore-local-ca-key-pair",
        "--ignore-not-found",
        "--output=json",
      ],
      { capture: true },
    ],
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "kube-system",
        "get",
        "configmap",
        "kube-root-ca.crt",
        "--ignore-not-found",
        "--output=json",
      ],
      { capture: true },
    ],
  ]);
});

test("the namespace and a ConfigMap of the public CAs are applied by stdin, carrying the local CA alone and the local CA with the cluster CA", async () => {
  const { runner, run } = fakeRunner(reply);

  await ensureLocalCaTrust(repository, runner, "backstage");

  const [command, args, options] = run.mock.calls[2] ?? [];
  expect(command).toBe("kubectl");
  expect(args).toEqual([
    "--context",
    "k3d-kore-local",
    "apply",
    "--server-side",
    "--field-manager=kore-local-ca",
    "--force-conflicts",
    "--filename=-",
  ]);
  expect(JSON.parse(options?.input ?? "")).toEqual({
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: "backstage" },
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: "kore-local-ca",
          namespace: "backstage",
          labels: { "app.kubernetes.io/managed-by": "kore-local-ca" },
        },
        data: { "ca.crt": local, "bundle.crt": `${local}${cluster}` },
      },
    ],
  });
  expect(run).toHaveBeenCalledTimes(3);
});

test("the CA private key never leaves the Secret it is read from", async () => {
  const { runner, run } = fakeRunner(reply);

  await ensureLocalCaTrust(repository, runner, "backstage");

  expect(JSON.stringify(run.mock.calls)).not.toContain("PRIVATE");
  expect(JSON.stringify(run.mock.calls)).not.toContain("UFJJVkFURQ");
});

test("a missing local CA fails closed with the command that creates it, and applies nothing", async () => {
  const { runner, run } = fakeRunner(() => "");

  await expect(
    ensureLocalCaTrust(repository, runner, "backstage"),
  ).rejects.toThrow(
    "the local CA is missing (Secret cert-manager/kore-local-ca-key-pair, key tls.crt); pods trust it only once it exists, so run `kore trust install --environment local`, then rerun",
  );
  expect(run.mock.calls.some(([, args]) => args.includes("apply"))).toBe(false);
});

test("a local CA that is not a PEM certificate is refused", async () => {
  const { runner } = fakeRunner(() =>
    JSON.stringify({ data: { "tls.crt": encoded("garbage") } }),
  );

  await expect(
    ensureLocalCaTrust(repository, runner, "backstage"),
  ).rejects.toThrow(
    "the local CA is not a PEM certificate (Secret cert-manager/kore-local-ca-key-pair, key tls.crt); pods trust it only once it exists, so run `kore trust install --environment local`, then rerun",
  );
});

test("a missing cluster CA ConfigMap stops the apply, because the bundle would drop the API server's trust", async () => {
  const { runner, run } = fakeRunner((_c, args) =>
    args.includes("secret")
      ? JSON.stringify({ data: { "tls.crt": encoded(local) } })
      : "",
  );

  await expect(
    ensureLocalCaTrust(repository, runner, "backstage"),
  ).rejects.toThrow(
    "the cluster CA is missing (ConfigMap kube-system/kube-root-ca.crt, key ca.crt); the portal's trust bundle needs it beside the local CA, so check access to the cluster k3d-kore-local, then rerun",
  );
  expect(run.mock.calls.some(([, args]) => args.includes("apply"))).toBe(false);
});
