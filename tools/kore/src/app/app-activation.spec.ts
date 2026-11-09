import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { activateNamespace } from "./install.js";

function fakeRunner(readBack: string) {
  const calls: {
    command: string;
    args: readonly string[];
    input?: string | undefined;
  }[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      return {
        stdout: args.includes("get") ? readBack : "",
        stderr: "",
        code: 0,
      };
    },
  };
  return { calls, runner };
}

test("activation stamps the gate generation on the namespace in the configured context", async () => {
  const repository = await loadRepository("local");
  const { calls, runner } = fakeRunner("g-abc");

  await activateNamespace(repository, runner, "reference", "g-abc");

  const apply = calls.find((call) => call.args.includes("apply"))!;
  expect(apply.args).toContain(repository.environment.kubeContext);
  expect(apply.args).toContain("--field-manager=kore-activation");
  expect(apply.input).toContain("platform.kore.dev/activation-generation");
  expect(apply.input).toContain("g-abc");
});

test("activation reads the label back and refuses the release when it did not stick", async () => {
  const repository = await loadRepository("local");
  const { runner } = fakeRunner("g-stale");

  await expect(
    activateNamespace(repository, runner, "reference", "g-abc"),
  ).rejects.toThrow(/reference.*not activated.*g-abc.*kore app up/is);
});
