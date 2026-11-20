// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";
import { existenceCheck } from "./readiness-existence.js";

vi.mock("./readiness-poll.js");

type Run = Runner["run"];

const BASE = ["--context", "k3d-kore-local", "--namespace", "keycloak"];
const STATEFULSET = "statefulset/keycloak";
const REALM = "realm.realm.keycloak.m.crossplane.io/platform";

/** A typed runner whose kubectl read succeeds, or fails with the given error. */
function fakeRunner(failure?: Error) {
  const run = vi.fn<Run>(async (_command, args) => {
    if (failure && args.includes("get")) {
      throw failure;
    }
    return { stdout: "", stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
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
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    await probe();
  });
});

test("a StatefulSet is proven to exist and then rolled out, and says so in its condition", () => {
  expect(checkFor(STATEFULSET, fakeRunner().runner).condition).toBe(
    "exists and rollout complete",
  );
});

test("a Keycloak realm is proven to exist and then Ready, and says so in its condition", () => {
  expect(checkFor(REALM, fakeRunner().runner).condition).toBe(
    "exists and Ready",
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
      [...BASE, "rollout", "status", STATEFULSET, "--timeout=10m"],
      { capture: false },
    ],
  ]);
});

test("a realm is read by name before its Ready wait, and the wait takes the capture of the run", async () => {
  const { runner, run } = fakeRunner();
  await checkFor(REALM, runner, true).run("3s");

  expect(run.mock.calls).toEqual([
    ["kubectl", [...BASE, "get", REALM, "--output", "name"], { capture: true }],
    [
      "kubectl",
      [...BASE, "wait", "--for=condition=Ready", REALM, "--timeout=3s"],
      { capture: true },
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

test.each([
  "deployment/web",
  "daemonset/ztunnel",
  "crd/fakes.example.io",
  "configmap/settings",
])("%s has no existence check, so it keeps the check it had", (resource) => {
  expect(
    existenceCheck({ runner: fakeRunner().runner, base: BASE }, resource),
  ).toBeUndefined();
});
