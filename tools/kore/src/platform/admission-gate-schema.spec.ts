import { expect, test } from "vitest";
import { CommandError } from "../runtime/index.js";
import { declaredGateParameters } from "./admission-gate-schema.js";
import { gateCrdJson } from "./admission-gate-support.js";
import { repositoryOf, runnerFake } from "./gate-unit-support.js";

const repository = repositoryOf({ kubeContext: "k3d-kore-local" });

function commandFailure(stderr: string): CommandError {
  return new CommandError("kubectl", ["get"], { stdout: "", stderr, code: 1 });
}

test("the declared parameters are the v1beta1 schema's parameter properties", async () => {
  const { runner } = runnerFake(() => ({
    stdout: gateCrdJson(["generation", "state", "controllerIdentities"]),
    stderr: "",
    code: 0,
  }));

  const declared = await declaredGateParameters(repository, runner);

  expect([...(declared ?? [])]).toEqual([
    "generation",
    "state",
    "controllerIdentities",
  ]);
});

test("a cluster whose CRD does not declare controllerIdentities says so", async () => {
  const { runner } = runnerFake(() => ({
    stdout: gateCrdJson(["generation", "state"]),
    stderr: "",
    code: 0,
  }));

  const declared = await declaredGateParameters(repository, runner);

  expect(declared?.has("controllerIdentities")).toBe(false);
});

test("a CRD with no v1beta1 version declares no parameters", async () => {
  const { runner } = runnerFake(() => ({
    stdout: JSON.stringify({ spec: { versions: [{ name: "v1" }] } }),
    stderr: "",
    code: 0,
  }));

  const declared = await declaredGateParameters(repository, runner);

  expect([...(declared ?? [])]).toEqual([]);
});

test("an absent CRD is undefined, not an empty declaration", async () => {
  const { runner } = runnerFake(() => {
    throw commandFailure(
      'Error from server (NotFound): customresourcedefinitions.apiextensions.k8s.io "x" not found',
    );
  });

  await expect(declaredGateParameters(repository, runner)).resolves.toBe(
    undefined,
  );
});

test("a kubectl that prints nothing for the CRD is undefined", async () => {
  const { runner } = runnerFake(() => ({
    stdout: "  \n",
    stderr: "",
    code: 0,
  }));

  await expect(declaredGateParameters(repository, runner)).resolves.toBe(
    undefined,
  );
});

test("any other failure to read the CRD is rethrown, never read as an absent CRD", async () => {
  const denied = commandFailure(
    "Error from server (Forbidden): cannot get crd",
  );
  const { runner } = runnerFake(() => {
    throw denied;
  });

  await expect(declaredGateParameters(repository, runner)).rejects.toBe(denied);
});

test("the read names the configured context and only reads the CRD as JSON", async () => {
  const { run, runner } = runnerFake(() => ({
    stdout: "",
    stderr: "",
    code: 0,
  }));

  await declaredGateParameters(repository, runner);

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "get",
      "crd/koreapplicationadmission.constraints.gatekeeper.sh",
      "--ignore-not-found",
      "--output",
      "json",
    ],
    { capture: true },
  );
});
