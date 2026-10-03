import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { doctor, doctorFailed } from "./doctor.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";

class MismatchRunner implements Runner {
  async run(
    command: string,
    _args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    if (command === "docker") return { stdout: "0.0.0", stderr: "", code: 0 };
    if (command === "minikube" && _args[0] === "profile")
      return { stdout: `{"valid":[]}`, stderr: "", code: 0 };
    return { stdout: "0.0.0", stderr: "", code: 0 };
  }
}

test("doctor distinguishes optional version warnings from required failures", async () => {
  const checks = await doctor(
    await loadRepository("local"),
    new MismatchRunner(),
  );
  assert.equal(
    checks.find(({ name }) => name === "tool:minikube")?.status,
    "fail",
  );
  assert.equal(checks.find(({ name }) => name === "tool:sops")?.status, "warn");
});

test("doctor reports unavailable tools, daemon failures, and ambiguous profiles", async () => {
  const runner: Runner = {
    async run(command, args) {
      if (command === "docker" && args[0] === "info")
        throw new Error("daemon is down");
      if (command === "minikube" && args[0] === "profile")
        return {
          stdout:
            '{"valid":[{"Name":"kore-local"},{"Config":{"Name":"kore-local"}}]}',
          stderr: "",
          code: 0,
        };
      if (command === "tofu") throw new Error("not installed");
      return { stdout: "version v99.1.2", stderr: "", code: 0 };
    },
  };
  const checks = await doctor(await loadRepository("local"), runner);

  assert.equal(checks.find(({ name }) => name === "tool:tofu")?.status, "warn");
  assert.equal(
    checks.find(({ name }) => name === "container-runtime")?.status,
    "fail",
  );
  assert.equal(
    checks.find(({ name }) => name === "minikube-profile")?.status,
    "fail",
  );
  assert.equal(doctorFailed(checks), true);
});

test("doctor warns when Minikube profile listing fails and requires managed credentials", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      provider: "managed" as const,
      kubeContext: "REQUIRED",
    },
  };
  const runner: Runner = {
    async run(command, args) {
      if (command === "docker" && args[0] === "info")
        return { stdout: "", stderr: "", code: 0 };
      if (command === "minikube" && args[0] === "profile")
        throw "profile command unavailable";
      return { stdout: "unknown version", stderr: "", code: 0 };
    },
  };
  const checks = await doctor(repository, runner);

  assert.deepEqual(
    checks.find(({ name }) => name === "credentials"),
    {
      name: "credentials",
      status: "fail",
      required: true,
      message: "managed environment credentials/context are not configured",
    },
  );
  assert.equal(
    checks.find(({ name }) => name === "minikube-profile")?.status,
    "warn",
  );
  assert.equal(doctorFailed(checks), true);
});
