// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { FlagError } from "./overlay.js";
import { remainingReferences } from "./retire-references.js";

const FLAG = "suborg-tenancy";
const BASE = "/repo";

/** A runner whose one git grep answers with the given code, stdout and stderr. */
function runnerAnswering(code: number, stdout = "", stderr = "") {
  const run = vi.fn<Runner["run"]>(() =>
    Promise.resolve({ code, stdout, stderr }),
  );
  return { runner: { run } as Runner, run };
}

describe("remainingReferences", () => {
  it("searches the tracked files of the checkout for the flag's name, as a fixed string", async () => {
    const { runner, run } = runnerAnswering(1);
    await remainingReferences(runner, BASE, FLAG);
    expect(run).toHaveBeenCalledWith(
      "git",
      ["grep", "-n", "-F", "-e", FLAG, "--"],
      { cwd: BASE },
    );
  });

  it("names each reference by its file, line and text", async () => {
    const { runner } = runnerAnswering(
      0,
      [
        'tools/kore/src/x.ts:12:  flags: ["suborg-tenancy"],',
        "charts/app/values.yaml:3:suborg-tenancy: true",
        "",
      ].join("\n"),
    );
    expect(await remainingReferences(runner, BASE, FLAG)).toEqual([
      {
        path: "tools/kore/src/x.ts",
        line: 12,
        text: '  flags: ["suborg-tenancy"],',
      },
      { path: "charts/app/values.yaml", line: 3, text: "suborg-tenancy: true" },
    ]);
  });

  it("keeps colons in the text of a reference, since only the first two separate the fields", async () => {
    const { runner } = runnerAnswering(
      0,
      "docs/a.md:7:see suborg-tenancy: on\n",
    );
    expect(await remainingReferences(runner, BASE, FLAG)).toEqual([
      { path: "docs/a.md", line: 7, text: "see suborg-tenancy: on" },
    ]);
  });

  it("reports no reference when git grep finds none, which is its exit code 1", async () => {
    const { runner } = runnerAnswering(1);
    expect(await remainingReferences(runner, BASE, FLAG)).toEqual([]);
  });

  it("refuses when the search cannot run, naming the cause rather than reporting none", async () => {
    const { runner } = runnerAnswering(
      128,
      "",
      "fatal: not a git repository\n",
    );
    await expect(remainingReferences(runner, BASE, FLAG)).rejects.toThrow(
      FlagError,
    );
    await expect(remainingReferences(runner, BASE, FLAG)).rejects.toThrow(
      /Cannot search the checkout for suborg-tenancy: fatal: not a git repository/,
    );
  });
});
