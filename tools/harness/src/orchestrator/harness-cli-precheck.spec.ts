import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { HarnessCli, HarnessCliError } from "./harness-cli.js";
import { sendBackReason } from "./precheck-reason.js";

vi.mock("./precheck-reason.js");

function setup(answer: Partial<RunResult>) {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const runner: Runner = {
    run: (command, args, options) => {
      calls.push({
        command,
        args: [...args],
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      });
      return Promise.resolve({ stdout: "", stderr: "", code: 0, ...answer });
    },
  };
  return { cli: new HarnessCli(runner, "/repo"), calls };
}

const REPORT = { pr: 9, ok: false, declaration: { ok: false } };

describe("HarnessCli precheck", () => {
  beforeEach(() => {
    vi.mocked(sendBackReason).mockReset();
  });

  it("reads the precheck read-only as JSON and sends back with the reason the helper names", async () => {
    vi.mocked(sendBackReason).mockReturnValue("The precheck failed: ci: fail");
    const { cli, calls } = setup({ code: 1, stdout: JSON.stringify(REPORT) });
    await expect(cli.precheck(9)).resolves.toEqual({
      sendBack: true,
      reason: "The precheck failed: ci: fail",
    });
    expect(calls).toEqual([
      {
        command: "node",
        args: ["skills/bin/harness.mjs", "judge", "precheck", "9", "--json"],
        cwd: "/repo",
      },
    ]);
    expect(vi.mocked(sendBackReason)).toHaveBeenCalledWith(REPORT);
  });

  it("lets the judge run when the helper names no reason", async () => {
    vi.mocked(sendBackReason).mockReturnValue(undefined);
    const { cli } = setup({ code: 1, stdout: JSON.stringify(REPORT) });
    await expect(cli.precheck(9)).resolves.toEqual({ sendBack: false });
  });

  it("fails, and sends nothing back, when the precheck could not run", async () => {
    const { cli } = setup({
      code: 1,
      stdout: "",
      stderr: "bundle behind origin/main",
    });
    await expect(cli.precheck(9)).rejects.toThrow(HarnessCliError);
    expect(vi.mocked(sendBackReason)).not.toHaveBeenCalled();
  });

  it("sends back through `judge send-back`, which keys the event on the PR head", async () => {
    const { cli, calls } = setup({});
    await cli.sendBack(9, "The precheck failed: ci: fail");
    expect(calls).toEqual([
      {
        command: "node",
        args: [
          "skills/bin/harness.mjs",
          "judge",
          "send-back",
          "9",
          "--reason",
          "The precheck failed: ci: fail",
        ],
        cwd: "/repo",
      },
    ]);
  });
});
