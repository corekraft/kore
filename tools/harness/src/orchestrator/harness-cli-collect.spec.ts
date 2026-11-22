import { describe, expect, it, vi } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { HarnessCli, HarnessCliError } from "./harness-cli.js";

/** An hc HarnessCli over a runner that answers each call; the calls are recorded in order. */
function setup(answer: (args: string[]) => Partial<RunResult>) {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const runner: Runner = {
    run: vi.fn(
      (command: string, args: string[], options?: { cwd?: string }) => {
        calls.push({
          command,
          args: [...args],
          ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        });
        return Promise.resolve({
          stdout: "",
          stderr: "",
          code: 0,
          ...answer([...args]),
        });
      },
    ),
  };
  return { cli: new HarnessCli(runner, "/repo", "hc"), calls };
}

const harness = (...args: string[]) => ({
  command: "node",
  args: ["skills/bin/harness.mjs", ...args],
  cwd: "/repo",
});

describe("HarnessCli collects an hc retro from its report, never a pane", () => {
  it("takes the summary its wait printed, and reads no pane", async () => {
    const { cli, calls } = setup((args) =>
      args.includes("wait")
        ? {
            stdout: JSON.stringify({
              outcome: "done",
              summary: "PROPOSALS",
              seq: 1,
            }),
          }
        : { stdout: "" },
    );

    expect(await cli.collect("retro-1")).toEqual({
      outcome: "done",
      text: "PROPOSALS",
    });
    expect(calls).toEqual([harness("session", "wait", "retro-1", "--json")]);
  });

  it("names the fix when an hc retro settled without a report", async () => {
    const { cli } = setup(() => ({
      stdout: JSON.stringify({ outcome: "done" }),
    }));

    await expect(cli.collect("retro-1")).rejects.toThrow(
      new HarnessCliError(
        "The retro session retro-1 settled without a report, so its proposals are not read. Rerun the retro; its last action must be `harness session report`.",
      ),
    );
  });
});
