// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
import { beforeEach, expect, test, vi } from "vitest";
import { withSecretsRedacted } from "../images/index.js";
import { ensureKeycloakProviderCredentials } from "./keycloak-provider-credentials.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

vi.mock("../images/index.js");

const repository = fakeRepository();
const password = "admin-password-from-test";
const encoded = Buffer.from(password).toString("base64");

/** The provider Secret is missing; the admin Secret holds the password. */
const adminOnly = (_command: string, args: readonly string[]): string =>
  args.includes("keycloak-admin") ? encoded : "";

beforeEach(() => {
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
});

test("a missing provider credential is built from the admin Secret and reaches the cluster only on kubectl's stdin", async () => {
  const { runner, run } = fakeRunner(adminOnly);
  await expect(
    ensureKeycloakProviderCredentials(repository, runner),
  ).resolves.toBe(true);
  const [command, args, options] = run.mock.calls[2]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-keycloak-provider-credentials",
      "--force-conflicts",
      "--filename=-",
    ],
  ]);
  const secret = JSON.parse(options!.input!) as {
    metadata: unknown;
    type: string;
    stringData: { credentials: string };
  };
  expect(secret.metadata).toEqual({
    name: "keycloak-provider-credentials",
    namespace: "crossplane-system",
  });
  expect(secret.type).toBe("Opaque");
  expect(JSON.parse(secret.stringData.credentials)).toEqual({
    client_id: "admin-cli",
    username: "kore-admin",
    password,
    url: "http://keycloak-service.keycloak.svc:8080",
    realm: "master",
  });
  expect(JSON.stringify(args)).not.toContain(password);
});

test("an existing provider credential is never rewritten, so a running provider keeps it", async () => {
  const { runner, run } = fakeRunner((_c, args) =>
    args.includes("crossplane-system") ? "secret/x\n" : "",
  );
  await expect(
    ensureKeycloakProviderCredentials(repository, runner),
  ).resolves.toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});

test("both lookups are read-only and name the environment's context", async () => {
  const { runner, run } = fakeRunner(adminOnly);
  await ensureKeycloakProviderCredentials(repository, runner);
  expect(run.mock.calls[0]!.slice(0, 2)).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "crossplane-system",
      "get",
      "secret",
      "keycloak-provider-credentials",
      "--ignore-not-found",
      "--output=name",
    ],
  ]);
  expect(run.mock.calls[1]!.slice(0, 2)).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "keycloak",
      "get",
      "secret",
      "keycloak-admin",
      "--ignore-not-found",
      "--output=jsonpath={.data.password}",
    ],
  ]);
});

test("a missing admin Secret fails naming the cause, and nothing is applied", async () => {
  const { runner, run } = fakeRunner();
  await expect(
    ensureKeycloakProviderCredentials(repository, runner),
  ).rejects.toThrow(/keycloak-admin.*keycloak-operator/);
  expect(run).toHaveBeenCalledTimes(2);
});

test("the apply runs inside secret redaction for the password", async () => {
  const { runner } = fakeRunner(adminOnly);
  await ensureKeycloakProviderCredentials(repository, runner);
  expect(vi.mocked(withSecretsRedacted).mock.calls[0]![0]).toEqual([password]);
});
