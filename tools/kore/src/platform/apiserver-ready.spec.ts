import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiserverReadyFlag, featureEnabled } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { waitForApiserverReady } from "./apiserver-ready.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";
import { errorMessage } from "./probe.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";

vi.mock("../config/index.js");
vi.mock("./probe.js");
// Only the poll is replaced: ReadinessTimeout stays the real error class.
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
}));

const repository = fakeRepository();
const operator = fakeComponent({ name: "keycloak-operator" });
const CLOCK = new Date("2026-11-24T10:00:00Z");

function failure(stderr: string): CommandError {
  return new CommandError("kubectl", ["get", "--raw", "/readyz"], {
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

/** Makes the poll take `seconds`, by moving the clock the wait reads. */
function pollTakes(seconds: number): void {
  vi.mocked(pollUntil).mockImplementation(async () => {
    vi.setSystemTime(Date.now() + seconds * 1000);
  });
}

/** Everything written to the step output (stderr), in order. */
let stepLines: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CLOCK);
  stepLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stepLines.push(String(chunk));
    return true;
  });
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(pollUntil).mockResolvedValue(undefined);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("with platform-apiserver-ready off nothing is read from the cluster", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await waitForApiserverReady(repository, runner, operator);
  expect(featureEnabled).toHaveBeenCalledWith(
    repository.environment,
    apiserverReadyFlag,
  );
  expect(pollUntil).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("readiness is read from /readyz in the configured context, bounded to three minutes", async () => {
  const { runner, run } = fakeRunner(() => "ok");
  await waitForApiserverReady(repository, runner, operator);
  expect(pollUntil).toHaveBeenCalledWith("3m", expect.any(Function));
  expect(await probeOnce()).toBeUndefined();
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "get", "--raw", "/readyz"],
    { capture: true },
  );
});

test("a reply other than ok is not ready", async () => {
  const { runner } = fakeRunner(() => "[-]etcd failed: reason withheld");
  await waitForApiserverReady(repository, runner, operator);
  expect(await probeOnce()).toContain("etcd failed");
});

test.each([
  "The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?",
  "Unable to connect to the server: EOF",
  "Unable to connect to the server: net/http: TLS handshake timeout",
  "Error from server (ServiceUnavailable): the server is currently unable to handle the request",
])(
  "an API server that is still starting is reported as not ready, not as a failure: %s",
  async (stderr) => {
    const { runner, run } = fakeRunner();
    run.mockRejectedValue(failure(stderr));
    await waitForApiserverReady(repository, runner, operator);
    expect(await probeOnce()).toContain(stderr);
  },
);

test("an error that waiting cannot clear is rethrown at once", async () => {
  const { runner, run } = fakeRunner();
  const unknown = failure('error: context "k3d-kore-local" does not exist');
  run.mockRejectedValue(unknown);
  await waitForApiserverReady(repository, runner, operator);
  await expect(probeOnce()).rejects.toBe(unknown);
});

test("an API server that never answers fails naming the API server, the last reply and the command to run, not a rollout timeout", async () => {
  vi.mocked(pollUntil).mockRejectedValue(
    new ReadinessTimeout("The connection to the server was refused"),
  );
  const message = await waitForApiserverReady(
    repository,
    fakeRunner().runner,
    operator,
  ).then(
    () => "",
    (error: Error) => error.message,
  );
  expect(message).toContain("API server");
  expect(message).toContain("keycloak-operator");
  expect(message).toContain("3m");
  expect(message).toContain("The connection to the server was refused");
  expect(message).toContain(
    "kubectl --context k3d-kore-local get --raw /readyz",
  );
});

test("a poll failure that is not a timeout is rethrown unchanged", async () => {
  const broken = new Error("kubeconfig is gone");
  vi.mocked(pollUntil).mockRejectedValue(broken);
  await expect(
    waitForApiserverReady(repository, fakeRunner().runner, operator),
  ).rejects.toBe(broken);
});

test("with platform-apiserver-ready on, a wait that passes writes one step line naming the component and how long it took", async () => {
  pollTakes(12);
  await waitForApiserverReady(
    repository,
    fakeRunner(() => "ok").runner,
    operator,
  );
  expect(stepLines).toEqual([
    "apiserver ready before keycloak-operator rollout (12s)\n",
  ]);
});

test("with platform-apiserver-ready off the wait writes nothing to the step output", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  pollTakes(12);
  await waitForApiserverReady(
    repository,
    fakeRunner(() => "ok").runner,
    operator,
  );
  expect(stepLines).toEqual([]);
});

test("a wait that times out writes no ready line, and the timeout error keeps its exact text", async () => {
  vi.mocked(pollUntil).mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 180_000);
    throw new ReadinessTimeout("The connection to the server was refused");
  });
  const message = await waitForApiserverReady(
    repository,
    fakeRunner().runner,
    operator,
  ).then(
    () => "",
    (error: Error) => error.message,
  );
  expect(stepLines).toEqual([]);
  expect(message).toBe(
    "the Kubernetes API server of k3d-kore-local was not ready within 3m, so the keycloak-operator rollout was not started: The connection to the server was refused. The controllers crash when they cannot reach it. Run kubectl --context k3d-kore-local get --raw /readyz and check the k3s server container (docker logs k3d-kore-local-server-0), then rerun kore local up.",
  );
});
