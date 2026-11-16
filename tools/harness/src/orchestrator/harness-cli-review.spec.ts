import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { HarnessCli, HarnessCliError } from "./harness-cli.js";

function cliWith(code: number, stderr = "") {
  const run = vi.fn<Runner["run"]>().mockResolvedValue({
    stdout: "",
    stderr,
    code,
  });
  return { cli: new HarnessCli({ run } as Runner, "/repo"), run };
}

describe("HarnessCli review", () => {
  it("runs review run for the PR from the repository root", async () => {
    const { cli, run } = cliWith(0);
    await cli.review(9);
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "node",
      ["skills/bin/harness.mjs", "review", "run", "9"],
      { cwd: "/repo" },
    );
  });

  it("fails with the tool's message when the review posts no verdict", async () => {
    const { cli } = cliWith(1, "no VERDICT block");
    await expect(cli.review(9)).rejects.toThrow(HarnessCliError);
    await expect(cli.review(9)).rejects.toThrow(
      /review run 9.*no VERDICT block/,
    );
  });
});
