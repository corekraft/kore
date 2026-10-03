import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { doctor } from "./doctor.js";
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
