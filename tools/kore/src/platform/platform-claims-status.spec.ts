// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformClaimsStatus } from "./platform-claims-status.js";

vi.mock("../config/index.js");

type Run = Runner["run"];

const repository = {
  environment: { name: "local", kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/** A runner that answers the one kubectl read with the given stdout, or throws. */
function fakeRunner(reply: string | Error) {
  const run = vi.fn<Run>(async () => {
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  return { run, runner: { run } as unknown as Runner };
}

/** A kubectl list of claims, each with the given Ready condition (or none). */
function list(
  items: { kind: string; name: string; ready?: string; message?: string }[],
): string {
  return JSON.stringify({
    items: items.map(({ kind, name, ready, message }) => ({
      kind,
      metadata: { name },
      status:
        ready === undefined
          ? {}
          : {
              conditions: [
                { type: "Ready", status: ready, message: message ?? "" },
              ],
            },
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("with the organization-service-apis flag off, status reports gated-off and never reads the cluster", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { run, runner } = fakeRunner(list([]));

  expect(await platformClaimsStatus(repository, runner)).toEqual({
    status: "gated-off",
  });
  expect(run).not.toHaveBeenCalled();
});

test("with the flag on, status reads both kinds once, read-only, in the configured context", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { run, runner } = fakeRunner(list([]));

  await platformClaimsStatus(repository, runner);

  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "get",
      "organizations.platform.kore.dev,services.platform.kore.dev",
      "--output",
      "json",
    ],
    { capture: true },
  );
});

test("claims whose Ready condition is True report ready, and an empty list is ready too", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { runner } = fakeRunner(
    list([
      { kind: "Organization", name: "platform", ready: "True" },
      { kind: "Service", name: "checkout", ready: "True" },
    ]),
  );

  expect(await platformClaimsStatus(repository, runner)).toEqual({
    status: "ready",
    claims: [
      { kind: "Organization", name: "platform", ready: true, reason: "" },
      { kind: "Service", name: "checkout", ready: true, reason: "" },
    ],
  });
  const empty = fakeRunner(list([]));
  expect(await platformClaimsStatus(repository, empty.runner)).toEqual({
    status: "ready",
    claims: [],
  });
});

test("a claim that is not Ready makes the report degraded, naming it and its message", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { runner } = fakeRunner(
    list([
      { kind: "Organization", name: "platform", ready: "True" },
      {
        kind: "Service",
        name: "checkout",
        ready: "False",
        message: "the namespace checkout--local is not yet composed",
      },
    ]),
  );

  expect(await platformClaimsStatus(repository, runner)).toEqual({
    status: "degraded",
    claims: [
      { kind: "Organization", name: "platform", ready: true, reason: "" },
      {
        kind: "Service",
        name: "checkout",
        ready: false,
        reason: "the namespace checkout--local is not yet composed",
      },
    ],
  });
});

test("a claim with no Ready condition yet is not ready, and says so rather than reporting ready", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { runner } = fakeRunner(list([{ kind: "Service", name: "checkout" }]));

  expect(await platformClaimsStatus(repository, runner)).toEqual({
    status: "degraded",
    claims: [
      {
        kind: "Service",
        name: "checkout",
        ready: false,
        reason: "no Ready condition yet",
      },
    ],
  });
});

test("a failed kubectl read fails the status, it is not reported as ready", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { runner } = fakeRunner(
    new Error("the server doesn't have a resource type"),
  );

  await expect(platformClaimsStatus(repository, runner)).rejects.toThrow(
    "the server doesn't have a resource type",
  );
});
