// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { pollUntil, timeoutMilliseconds } from "./readiness-poll.js";
import { existenceCheck } from "./readiness-existence.js";

vi.mock("./readiness-poll.js");

type Run = Runner["run"];

const BASE = ["--context", "k3d-kore-local", "--namespace", "keycloak"];
const STATEFULSET = "statefulset/keycloak";

/** A typed runner whose kubectl read succeeds, or fails with the given error. */
function fakeRunner(failure?: Error) {
  const run = vi.fn<Run>(async (_command, args) => {
    if (failure && args.includes("get")) {
      throw failure;
    }
    return { stdout: "", stderr: "", code: 0 };
  });
  const runner: Runner = { run };
  return { runner, run };
}

/** The check for a resource, which these tests all expect to exist. */
function checkFor(resource: string, runner: Runner, capture = false) {
  const check = existenceCheck({ runner, base: BASE, capture }, resource);
  if (check === undefined) {
    throw new Error(`no existence check for ${resource}`);
  }
  return check;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(timeoutMilliseconds).mockReturnValue(600_000);
  vi.spyOn(Date, "now").mockReturnValue(0);
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    await probe();
  });
});

test("a StatefulSet is proven to exist and then rolled out, and says so in its condition", () => {
  expect(checkFor(STATEFULSET, fakeRunner().runner).condition).toBe(
    "exists and rollout complete",
  );
});

test("a StatefulSet is read by name, captured, before its rollout is asked for, at the same bound", async () => {
  const { runner, run } = fakeRunner();
  await checkFor(STATEFULSET, runner, false).run("10m");

  expect(pollUntil).toHaveBeenCalledWith("10m", expect.any(Function));
  expect(run.mock.calls).toEqual([
    [
      "kubectl",
      [...BASE, "get", STATEFULSET, "--output", "name"],
      { capture: true },
    ],
    [
      "kubectl",
      [...BASE, "rollout", "status", STATEFULSET, "--timeout=600s"],
      { capture: false },
    ],
  ]);
});

test("a resource that never exists fails the wait, and its rollout is never asked for", async () => {
  vi.mocked(pollUntil).mockRejectedValue(new Error("statefulset not found"));
  const { runner, run } = fakeRunner();

  await expect(checkFor(STATEFULSET, runner).run("10m")).rejects.toThrow(
    "statefulset not found",
  );
  expect(run).not.toHaveBeenCalled();
});

test("a kubectl failure reaches the poll as it is, so the poll alone decides whether it is retried", async () => {
  const notFound = new Error('statefulsets.apps "keycloak" not found');
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    await expect(probe()).rejects.toBe(notFound);
  });

  await checkFor(STATEFULSET, fakeRunner(notFound).runner).run("10m");

  expect(pollUntil).toHaveBeenCalledTimes(1);
});

test("the wait and the rollout share the one bound: the rollout gets only the time the wait left", async () => {
  const { runner, run } = fakeRunner();
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    await probe();
    vi.spyOn(Date, "now").mockReturnValue(240_000);
  });
  await checkFor(STATEFULSET, runner).run("10m");

  expect(run.mock.calls.at(-1)?.[1]).toEqual([
    ...BASE,
    "rollout",
    "status",
    STATEFULSET,
    "--timeout=360s",
  ]);
});

test("a wait that used up the bound still leaves the rollout one second, never zero or negative", async () => {
  const { runner, run } = fakeRunner();
  vi.mocked(pollUntil).mockImplementation(async () => {
    vi.spyOn(Date, "now").mockReturnValue(600_000);
  });
  await checkFor(STATEFULSET, runner).run("10m");

  expect(run.mock.calls.at(-1)?.[1]?.at(-1)).toBe("--timeout=1s");
});

test.each([
  "statefulset/loki",
  "statefulset/tempo",
  "statefulset/argocd-application-controller",
  "deployment/web",
  "daemonset/ztunnel",
  "crd/fakes.example.io",
  "configmap/settings",
  "realm.realm.keycloak.m.crossplane.io/platform",
])("%s has no existence check, so it keeps the check it had", (resource) => {
  expect(
    existenceCheck({ runner: fakeRunner().runner, base: BASE }, resource),
  ).toBeUndefined();
});
