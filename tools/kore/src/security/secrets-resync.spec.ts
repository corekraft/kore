import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { syncLocalSecrets } from "./secrets.js";

test("secret sync does not annotate when no reference ExternalSecret exists", async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      _options?: RunOptions,
    ): Promise<RunResult> {
      calls.push({ command, args });
      const stdout = args.includes("jsonpath={.metadata.name}")
        ? "kube-system"
        : "";
      return { stdout, stderr: "", code: 0 };
    },
  };
  await syncLocalSecrets(await loadRepository("local"), runner).catch(() => 0);
  expect(calls.some(({ args }) => args.includes("annotate"))).toBe(false);
});
