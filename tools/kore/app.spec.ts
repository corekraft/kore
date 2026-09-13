import { expect, test } from "vitest";
import { loadRepository } from "./config.js";
import { appUp } from "./app.js";
import type { RunOptions, RunResult, Runner } from "./runner.js";

class UnreadyPlatformRunner implements Runner {
  calls: string[] = [];

  async run(
    command: string,
    args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push(`${command} ${args.join(" ")}`);
    if (command === "helm" && args[0] === "status") {
      throw new Error("release is missing");
    }
    if (command === "minikube" && args[0] === "status") {
      return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
    }
    if (command === "kubectl") {
      return { stdout: "kube-system", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  }
}

test("app up stops before installing resources when the platform is not ready", async () => {
  const repository = await loadRepository("local");
  const runner = new UnreadyPlatformRunner();

  await expect(appUp(repository, runner, "reference")).rejects.toThrow(
    /platform.*ready|missing/i,
  );
  expect(runner.calls.some((call) => call.includes(" upgrade "))).toBe(false);
});
