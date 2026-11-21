import { describe, expect, it, vi } from "vitest";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { runHeadlessBrowser } from "./headless-browser.js";

vi.mock("../images/index.js", () => ({
  withSecretsRedacted: vi.fn(
    async (_secrets: readonly string[], op: () => Promise<unknown>) => op(),
  ),
}));

const image =
  "mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579";

function fakeRunner(result: { stdout: string } | Error) {
  const run = vi.fn(async () => {
    if (result instanceof Error) {
      throw result;
    }
    return { stdout: result.stdout, stderr: "", code: 0 };
  });
  return { runner: { run } as unknown as Runner, run };
}

describe("runHeadlessBrowser", () => {
  it("streams the program on stdin and keeps it out of the docker arguments", async () => {
    const { runner, run } = fakeRunner({ stdout: '{"assertions":[]}\n' });
    await runHeadlessBrowser(runner, { image, program: "console.log(1)" });
    expect(run).toHaveBeenCalledWith(
      "docker",
      [
        "run",
        "--rm",
        "--interactive",
        "--network",
        "host",
        "--ipc",
        "host",
        "--init",
        image,
        "node",
        "-",
      ],
      { capture: true, input: "console.log(1)" },
    );
  });

  it("returns the JSON the program printed on its last stdout line", async () => {
    const { runner } = fakeRunner({
      stdout:
        'a browser note\n{"assertions":[{"name":"signed-in","ok":true}]}\n',
    });
    const result = await runHeadlessBrowser(runner, { image, program: "" });
    expect(result).toEqual({ assertions: [{ name: "signed-in", ok: true }] });
  });

  it("rejects a run whose last stdout line is not JSON, without echoing that output", async () => {
    const { runner } = fakeRunner({ stdout: "Error: secret-shaped text\n" });
    await expect(
      runHeadlessBrowser(runner, { image, program: "" }),
    ).rejects.toThrow(
      "the headless browser printed no JSON result as its last line",
    );
  });

  it("hands the secrets to the redaction wrapper around the run", async () => {
    const { runner } = fakeRunner({ stdout: '{"assertions":[]}\n' });
    await runHeadlessBrowser(runner, {
      image,
      program: "",
      secrets: ["hunter2-password"],
    });
    expect(withSecretsRedacted).toHaveBeenCalledWith(
      ["hunter2-password"],
      expect.any(Function),
    );
  });
});
