import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, keycloakRealmWaitFlag } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { waitForKeycloakRealm } from "./keycloak-realm-wait.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { errorMessage } from "./probe.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";

vi.mock("../config/index.js");
vi.mock("./probe.js");
// Only the poll is replaced: ReadinessTimeout stays the real error class.
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
}));

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const repository = fakeRepository();
const discovery =
  "/api/v1/namespaces/keycloak/services/keycloak-service:8080/proxy/realms/platform/.well-known/openid-configuration";

function failure(stderr: string): CommandError {
  return new CommandError("kubectl", ["get", "--raw", discovery], {
    stdout: "",
    stderr,
    code: 1,
  });
}

/** Runs the probe the poll was given once and returns what it reported. */
async function probeOnce(): Promise<string | undefined> {
  const probe = vi.mocked(pollUntil).mock.calls[0]![1];
  return probe();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(pollUntil).mockResolvedValue(undefined);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("with platform-keycloak-realm-wait off nothing is read from the cluster", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await waitForKeycloakRealm(repository, runner);
  expect(featureEnabled).toHaveBeenCalledWith(
    repository.environment,
    keycloakRealmWaitFlag,
  );
  expect(pollUntil).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("with the flag on the realm's discovery is read through the API server's Service proxy, in the configured context, bounded to five minutes", async () => {
  const { runner, run } = fakeRunner(() => '{"issuer":"https://k"}');
  await waitForKeycloakRealm(repository, runner);
  expect(pollUntil).toHaveBeenCalledWith("5m", expect.any(Function));
  expect(await probeOnce()).toBeUndefined();
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "get", "--raw", discovery],
    { capture: true },
  );
});

test("a reply without an issuer is not ready", async () => {
  const { runner } = fakeRunner(() => "");
  await waitForKeycloakRealm(repository, runner);
  expect(await probeOnce()).toMatch(/no issuer/);
});

test.each([
  "Error from server (ServiceUnavailable): the server is currently unable to handle the request (get services keycloak-service:8080)",
  'Error from server (ServiceUnavailable): no endpoints available for service "keycloak-service"',
  "Error from server (InternalError): error trying to reach service: dial tcp 10.0.0.1:8080: connect: connection refused",
])(
  "a Keycloak that is restarting is reported as not ready, not as a failure: %s",
  async (stderr) => {
    const { runner, run } = fakeRunner();
    run.mockRejectedValue(failure(stderr));
    await waitForKeycloakRealm(repository, runner);
    expect(await probeOnce()).toContain(stderr);
  },
);

test("an error that waiting cannot clear is rethrown at once", async () => {
  const { runner, run } = fakeRunner();
  const forbidden = failure(
    "Error from server (Forbidden): services is forbidden",
  );
  run.mockRejectedValue(forbidden);
  await waitForKeycloakRealm(repository, runner);
  await expect(probeOnce()).rejects.toBe(forbidden);
});

test("a realm that never answers fails naming Keycloak, the last reply and what to check, not a rollout timeout", async () => {
  vi.mocked(pollUntil).mockRejectedValue(
    new ReadinessTimeout("no endpoints available for service keycloak-service"),
  );
  const message = await waitForKeycloakRealm(
    repository,
    fakeRunner().runner,
  ).then(
    () => "",
    (error: Error) => error.message,
  );
  expect(message).toContain("Keycloak realm platform");
  expect(message).toContain("5m");
  expect(message).toContain("no endpoints available");
  expect(message).toContain(
    "kubectl --context k3d-kore-local --namespace keycloak get pods",
  );
});

test("a poll failure that is not a timeout is rethrown unchanged", async () => {
  const broken = new Error("kubeconfig is gone");
  vi.mocked(pollUntil).mockRejectedValue(broken);
  await expect(
    waitForKeycloakRealm(repository, fakeRunner().runner),
  ).rejects.toBe(broken);
});
