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
  const [command, args, options] = run.mock.calls[1]!;
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
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "backstage-oidc", namespace: "keycloak" },
        type: "Opaque",
        stringData: { "client-secret": secret },
      },
    ],
  });
});

test("the client secret is the same in both namespaces, so Keycloak and the proxy agree", async () => {
  const { runner, run } = fakeRunner();
  await ensureBackstageOidc(repository, runner);
  const items = JSON.parse(run.mock.calls[1]![2]!.input!).items;
  expect(items[1].stringData["client-secret"]).toBe(
    items[2].stringData["client-secret"],
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
