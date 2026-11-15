// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
import { randomBytes } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { withSecretsRedacted } from "../images/index.js";
import { ensureBackstageOidc } from "./backstage-oidc.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

vi.mock("node:crypto");
vi.mock("../images/index.js");

const repository = fakeRepository();
const secret = "cGFzc3dvcmQtZnJvbS10ZXN0LXJhbmRvbQ";

beforeEach(() => {
  vi.mocked(randomBytes).mockReturnValue(
    Buffer.from("password-from-test-random") as never,
  );
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
});

test("missing sign-in Secrets reach the cluster only on kubectl's stdin, in the configured context", async () => {
  const { runner, run } = fakeRunner();
  await expect(ensureBackstageOidc(repository, runner)).resolves.toBe(true);
  const [command, args, options] = run.mock.calls[2]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-backstage-oidc",
      "--force-conflicts",
      "--filename=-",
    ],
  ]);
  expect(JSON.stringify(args)).not.toContain(secret);
  expect(JSON.parse(options!.input!)).toEqual({
    apiVersion: "v1",
    kind: "List",
    items: [
      { apiVersion: "v1", kind: "Namespace", metadata: { name: "backstage" } },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "backstage-oidc", namespace: "backstage" },
        type: "Opaque",
        stringData: { "client-secret": secret, "cookie-secret": secret },
      },
    ],
  });
  expect(JSON.parse(run.mock.calls[1]![2]!.input!).items).toEqual([
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "backstage-oidc", namespace: "keycloak" },
      type: "Opaque",
      stringData: { "client-secret": secret },
    },
  ]);
});

test("the client secret is the same in both namespaces, so Keycloak and the proxy agree", async () => {
  const { runner, run } = fakeRunner();
  await ensureBackstageOidc(repository, runner);
  const keycloak = JSON.parse(run.mock.calls[1]![2]!.input!).items[0];
  const backstage = JSON.parse(run.mock.calls[2]![2]!.input!).items[1];
  expect(backstage.stringData["client-secret"]).toBe(
    keycloak.stringData["client-secret"],
  );
  expect(randomBytes).toHaveBeenCalledTimes(2);
});

test("existing sign-in Secrets are never rotated, so a signed-in session and the registered client stay valid", async () => {
  const { runner, run } = fakeRunner(() => "secret/backstage-oidc\n");
  await expect(ensureBackstageOidc(repository, runner)).resolves.toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
  expect(randomBytes).not.toHaveBeenCalled();
});

test("the lookup is read-only and names the environment's context and the backstage namespace", async () => {
  const { runner, run } = fakeRunner();
  await ensureBackstageOidc(repository, runner);
  expect(run.mock.calls[0]!.slice(0, 2)).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "backstage",
      "get",
      "secret",
      "backstage-oidc",
      "--ignore-not-found",
      "--output=name",
    ],
  ]);
});

test("the apply runs inside secret redaction for both generated values, so a failure cannot leak them", async () => {
  const { runner } = fakeRunner();
  await ensureBackstageOidc(repository, runner);
  expect(vi.mocked(withSecretsRedacted).mock.calls[0]![0]).toEqual([
    secret,
    secret,
  ]);
});

test("each secret carries 192 random bits, so none can be guessed", async () => {
  const { runner } = fakeRunner();
  await ensureBackstageOidc(repository, runner);
  expect(randomBytes).toHaveBeenCalledWith(24);
});

test("a rerun after the keycloak Secret landed but the backstage one did not writes both again, so the client never lacks its secret", async () => {
  const { runner, run } = fakeRunner();
  run.mockImplementationOnce(async () => ({ stdout: "", stderr: "" }) as never);
  run.mockImplementationOnce(async () => ({ stdout: "", stderr: "" }) as never);
  run.mockRejectedValueOnce(new Error("apply failed"));
  await expect(ensureBackstageOidc(repository, runner)).rejects.toThrow(
    "apply failed",
  );
  const calls = run.mock.calls.length;
  run.mockReset();
  run.mockResolvedValue({ stdout: "", stderr: "" } as never);
  await expect(ensureBackstageOidc(repository, runner)).resolves.toBe(true);
  expect(run).toHaveBeenCalledTimes(3);
  expect(calls).toBe(3);
});

test("a failed keycloak apply stops before the backstage Secret is written, so the done-check stays open", async () => {
  const { runner, run } = fakeRunner();
  run.mockResolvedValueOnce({ stdout: "", stderr: "" } as never);
  run.mockRejectedValueOnce(new Error("keycloak apply failed"));
  await expect(ensureBackstageOidc(repository, runner)).rejects.toThrow(
    "keycloak apply failed",
  );
  expect(run).toHaveBeenCalledTimes(2);
});
