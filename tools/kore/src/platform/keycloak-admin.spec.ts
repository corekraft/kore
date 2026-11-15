// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
import { randomBytes } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { withSecretsRedacted } from "../images/index.js";
import { keycloakAdminUser } from "./keycloak-support.js";
import { ensureKeycloakAdmin } from "./keycloak-admin.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

vi.mock("node:crypto");
vi.mock("../images/index.js");

const repository = fakeRepository();
const password = "cGFzc3dvcmQtZnJvbS10ZXN0LXJhbmRvbQ";

beforeEach(() => {
  vi.mocked(randomBytes).mockReturnValue(
    Buffer.from("password-from-test-random") as never,
  );
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
});

test("a missing admin Secret is generated and reaches the cluster only on kubectl's stdin, in the configured context", async () => {
  const { runner, run } = fakeRunner();
  await expect(ensureKeycloakAdmin(repository, runner)).resolves.toBe(true);
  const [command, args, options] = run.mock.calls[1]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-keycloak-admin",
      "--force-conflicts",
      "--filename=-",
    ],
  ]);
  expect(JSON.parse(options!.input!)).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "keycloak-admin", namespace: "keycloak" },
    type: "kubernetes.io/basic-auth",
    stringData: { username: keycloakAdminUser, password },
  });
  expect(JSON.stringify(args)).not.toContain(password);
});

test("an existing admin Secret is never rotated, so a running Keycloak keeps its bootstrap admin", async () => {
  const { runner, run } = fakeRunner(() => "secret/keycloak-admin\n");
  await expect(ensureKeycloakAdmin(repository, runner)).resolves.toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
  expect(randomBytes).not.toHaveBeenCalled();
});

test("the lookup is read-only and names the environment's context and the keycloak namespace", async () => {
  const { runner, run } = fakeRunner();
  await ensureKeycloakAdmin(repository, runner);
  expect(run.mock.calls[0]!.slice(0, 2)).toEqual([
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
      "--output=name",
    ],
  ]);
});

test("the apply runs inside secret redaction for the password, so a failure cannot leak it", async () => {
  const { runner } = fakeRunner();
  await ensureKeycloakAdmin(repository, runner);
  expect(vi.mocked(withSecretsRedacted).mock.calls[0]![0]).toEqual([password]);
});

test("the password carries 192 random bits, so it cannot be guessed", async () => {
  const { runner } = fakeRunner();
  await ensureKeycloakAdmin(repository, runner);
  expect(randomBytes).toHaveBeenCalledWith(24);
});
