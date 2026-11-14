import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { lockedImage } from "../testing/index.js";
import { verifyImage } from "./verify.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
class Recording implements Runner {
  calls: string[] = [];
  async run(
    command: string,
    args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push(`${command} ${args.join(" ")}`);
    return { stdout: "", stderr: "", code: 0 };
  }
}

test("a managed environment rejects an image signed by the local key before any verification runs", async () => {
  const repository = await loadRepository("managed-example");
  const runner = new Recording();

  await expect(
    verifyImage(repository, runner, lockedImage("local-kore-key")),
  ).rejects.toThrow(/local-kore-key.*not.*trusted.*managed-example/is);
  expect(runner.calls).toEqual([]);
});

test("an environment rejects a signer its image policy does not list", async () => {
  const repository = await loadRepository("managed-example");
  const runner = new Recording();

  await expect(
    verifyImage(
      repository,
      runner,
      lockedImage(
        "https://github.com/someone/else/.github/workflows/release.yaml@refs/tags/v1.0.0",
      ),
    ),
  ).rejects.toThrow(/not trusted by environment managed-example/i);
  expect(runner.calls).toEqual([]);
});
