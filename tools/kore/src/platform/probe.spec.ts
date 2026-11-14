// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { expect, test, vi } from "vitest";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
  releaseStatusOf,
} from "./probe.js";

type Run = Runner["run"];

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/** A helm component with the fields these probes read. */
function component(extra: Record<string, unknown> = {}): Component {
  return {
    name: "gateway",
    namespace: "kore-system",
    ...extra,
  } as unknown as Component;
}

/** A typed runner that answers every call with the given stdout. */
function fakeRunner(stdout = "") {
  const run = vi.fn<Run>(async () => ({ stdout, stderr: "", code: 0 }));
  return { runner: { run } as Runner, run };
}

test("an Error reports its message", () => {
  expect(errorMessage(new Error("the server is unreachable"))).toBe(
    "the server is unreachable",
  );
});

test("a value that is not an Error is reported as its string form", () => {
  expect(errorMessage("forbidden")).toBe("forbidden");
  expect(errorMessage(42)).toBe("42");
});

test("a Helm release reports its status string", () => {
  expect(
    releaseStatusOf(JSON.stringify({ info: { status: "deployed" } })),
  ).toBe("deployed");
});

test("a Helm release whose status is an object reports the status inside it", () => {
  expect(
    releaseStatusOf(JSON.stringify({ info: { status: { status: "failed" } } })),
  ).toBe("failed");
});

test("a Helm release with no info reports no status, so the caller decides", () => {
  expect(releaseStatusOf("{}")).toBeUndefined();
});

test("a Helm status that is not JSON throws rather than reporting a status", () => {
  expect(() => releaseStatusOf("not json")).toThrow(SyntaxError);
});

test("the Helm release status is read with the release name, namespace and context, as JSON", async () => {
  const { runner, run } = fakeRunner(
    JSON.stringify({ info: { status: "deployed" } }),
  );

  await expect(
    helmReleaseStatus(repository, runner, component()),
  ).resolves.toBe("deployed");

  expect(run).toHaveBeenCalledWith(
    "helm",
    [
      "status",
      "gateway",
      "--namespace",
      "kore-system",
      "--kube-context",
      "k3d-kore-local",
      "--output",
      "json",
    ],
    { capture: true },
  );
});

test("a component with no owned CRDs runs no kubectl call at all", async () => {
  const { runner, run } = fakeRunner();

  await assertOwnedCrdsExist(repository, runner, component({ ownsCRDs: [] }));

  expect(run).not.toHaveBeenCalled();
});

test("each owned CRD is looked up by name in the environment's context, in order", async () => {
  const { runner, run } = fakeRunner();

  await assertOwnedCrdsExist(
    repository,
    runner,
    component({ ownsCRDs: ["gateways.example.io", "routes.example.io"] }),
  );

  expect(run.mock.calls).toEqual([
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "get",
        "crd/gateways.example.io",
        "-o",
        "name",
      ],
      { capture: true },
    ],
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "get",
        "crd/routes.example.io",
        "-o",
        "name",
      ],
      { capture: true },
    ],
  ]);
});

test("a missing owned CRD fails the check and does not look up the CRDs after it", async () => {
  const run = vi.fn<Run>(async () => {
    throw new Error(
      'customresourcedefinitions "gateways.example.io" not found',
    );
  });

  await expect(
    assertOwnedCrdsExist(
      repository,
      { run } as unknown as Runner,
      component({ ownsCRDs: ["gateways.example.io", "routes.example.io"] }),
    ),
  ).rejects.toThrow('"gateways.example.io" not found');

  expect(run).toHaveBeenCalledTimes(1);
});
