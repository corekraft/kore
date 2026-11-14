// Docs: docs/decisions/0058-registry-transport-tls.md
import { beforeEach, expect, test, vi } from "vitest";
import { k3dTrustDirectory, writeK3dRegistryCa } from "./k3d-registry-trust.js";
import { fakeRepository, fakeRunner } from "./images-support.js";
import { koreManagesRegistryAuth } from "./registry-auth.js";
import {
  ensureRegistryTrust,
  loadRegistryCa,
  registryTrustProblem,
} from "./registry-tls.js";

vi.mock("./k3d-registry-trust.js");
vi.mock("./registry-auth.js");

const pem = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const encoded = (value: string) => Buffer.from(value).toString("base64");
const secretJson = (ca: string) =>
  JSON.stringify({ data: { "ca.crt": encoded(ca) } });
const missing =
  "the internal registry's CA is missing (Secret kore-registry/oci-registry-tls, key ca.crt); every client verifies it and none skips verification, so run `kore platform up --env local` to have cert-manager issue it";

beforeEach(() => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(k3dTrustDirectory).mockReturnValue("/home/kore/k3d/trust");
});

test("the CA is read from the TLS Secret's ca.crt key, asking the configured context", async () => {
  const { runner, run } = fakeRunner(() => secretJson(pem));

  await expect(loadRegistryCa(fakeRepository(), runner)).resolves.toBe(pem);
  expect(run.mock.calls).toEqual([
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "kore-registry",
        "get",
        "secret",
        "oci-registry-tls",
        "--ignore-not-found",
        "--output=json",
      ],
      { capture: true },
    ],
  ]);
});

test("a missing Secret fails closed with the command that issues the CA", async () => {
  const { runner } = fakeRunner(() => "");

  await expect(loadRegistryCa(fakeRepository(), runner)).rejects.toThrow(
    missing,
  );
});

test("a Secret without a ca.crt key is treated as missing, not trusted", async () => {
  const { runner } = fakeRunner(() => JSON.stringify({ data: {} }));

  await expect(loadRegistryCa(fakeRepository(), runner)).rejects.toThrow(
    missing,
  );
});

test("a Secret whose ca.crt is not a PEM certificate is refused", async () => {
  const { runner } = fakeRunner(() => secretJson("garbage"));

  await expect(loadRegistryCa(fakeRepository(), runner)).rejects.toThrow(
    "the internal registry's CA is not a PEM certificate (Secret kore-registry/oci-registry-tls, key ca.crt); every client verifies it and none skips verification, so run `kore platform up --env local` to have cert-manager issue it",
  );
});

test("status reports a missing CA with the platform fix, and nothing once it is readable", async () => {
  const absent = fakeRunner(() => "");
  await expect(
    registryTrustProblem(fakeRepository(), absent.runner),
  ).resolves.toBe(missing);

  const present = fakeRunner(() => secretJson(pem));
  await expect(
    registryTrustProblem(fakeRepository(), present.runner),
  ).resolves.toBeUndefined();
});

test("status reports nothing and reads nothing where kore does not manage registry auth", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, run } = fakeRunner();

  await expect(
    registryTrustProblem(fakeRepository(), runner),
  ).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
});

test("trust distribution applies a ConfigMap of the public CA only, with no node shell or private key", async () => {
  const { runner, run } = fakeRunner(() => secretJson(pem));

  await ensureRegistryTrust(fakeRepository(), runner, "/home/kore");

  const apply = run.mock.calls.find(([, args]) => args.includes("apply"));
  expect(apply?.[1]).toEqual([
    "--context",
    "k3d-kore-local",
    "apply",
    "--server-side",
    "--field-manager=kore-registry-tls",
    "--force-conflicts",
    "--filename=-",
  ]);
  const items = JSON.parse(apply?.[2]?.input ?? "{}") as {
    items: unknown[];
  };
  expect(items.items).toEqual([
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "cosign-system" },
    },
    {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: "kore-registry-ca",
        namespace: "cosign-system",
        labels: { "app.kubernetes.io/managed-by": "kore-registry-tls" },
      },
      data: { "ca.crt": pem },
    },
  ]);
  expect(JSON.stringify(run.mock.calls)).not.toMatch(/PRIVATE KEY|tls\.key/);
  expect(run.mock.calls.map(([command]) => command)).toEqual([
    "kubectl",
    "kubectl",
  ]);
});

test("on k3d the CA is also written to the host trust directory the nodes mount", async () => {
  const { runner } = fakeRunner(() => secretJson(pem));
  const repository = fakeRepository({
    provider: "k3d",
    k3d: { clusterName: "kore-local" },
  });

  await ensureRegistryTrust(repository, runner, "/home/kore");

  expect(k3dTrustDirectory).toHaveBeenCalledWith("kore-local", "/home/kore");
  expect(writeK3dRegistryCa).toHaveBeenCalledWith("/home/kore/k3d/trust", pem);
});

test("a non-k3d environment applies the ConfigMap but writes no host trust directory", async () => {
  const { runner } = fakeRunner(() => secretJson(pem));
  const repository = fakeRepository({
    provider: "managed",
    k3d: { clusterName: "kore-local" },
  });

  await ensureRegistryTrust(repository, runner);

  expect(writeK3dRegistryCa).not.toHaveBeenCalled();
});

test("where kore does not manage registry auth, trust distribution does nothing at all", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, run } = fakeRunner(() => secretJson(pem));

  await ensureRegistryTrust(fakeRepository(), runner);

  expect(run).not.toHaveBeenCalled();
  expect(writeK3dRegistryCa).not.toHaveBeenCalled();
});
