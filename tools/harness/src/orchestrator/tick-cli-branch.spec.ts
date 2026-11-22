import { describe, expect, it } from "vitest";
import type { FileSystem, RunResult, Runner } from "../runtime/index.js";
import { HarnessCliError } from "./harness-cli.js";
import { TickCli } from "./tick-cli.js";

const SESSIONS = "/main/.kore/state/sessions";
const PLANS = "/main/.kore/state/tick-plans";
const TICK_ENV = { KORE_ROLE: "tick", KORE_AGENT: "orchestrator-tick" };
const WRITER = "idea-0034-writer-abc1234";

interface Call {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

function setup(
  answer: (command: string, args: string[]) => Partial<RunResult> = () => ({}),
) {
  const calls: Call[] = [];
  const runner: Runner = {
    run: (command, args, options) => {
      calls.push({
        command,
        args: [...args],
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options?.env === undefined ? {} : { env: options.env }),
      });
      return Promise.resolve({
        stdout: "",
        stderr: "",
        code: 0,
        ...answer(command, [...args]),
      });
    },
  };
  const fs = {
    readdir: () => Promise.resolve([]),
    readFile: () => Promise.resolve(""),
    exists: () => Promise.resolve(false),
  } as unknown as FileSystem;
  const cli = new TickCli(runner, "/repo", fs, {
    sessions: SESSIONS,
    plans: PLANS,
    checkout: "/repo",
  });
  return { cli, calls };
}

describe("TickCli.mergeState", () => {
  it("reads the PR's merge state through gh", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ mergeStateStatus: "BEHIND" }),
    }));

    expect(await cli.mergeState(1234)).toBe("BEHIND");
    expect(calls).toEqual([
      {
        command: "gh",
        args: ["pr", "view", "1234", "--json", "mergeStateStatus"],
        cwd: "/repo",
      },
    ]);
  });

  it("refuses an unreadable merge state, so the notice reports it instead of reading it as clean", async () => {
    const { cli } = setup(() => ({ code: 1, stderr: "no auth" }));

    await expect(cli.mergeState(1234)).rejects.toBeInstanceOf(HarnessCliError);
  });
});

describe("TickCli.ciGreen", () => {
  const report = (state: string) =>
    JSON.stringify({ state, checks: [], failed: [], pending: [] });

  it("is true when harness pr checks reports the PR green", async () => {
    const { cli, calls } = setup(() => ({ stdout: report("green") }));

    expect(await cli.ciGreen(1234)).toBe(true);
    expect(calls[0]).toEqual({
      command: "node",
      args: ["skills/bin/harness.mjs", "pr", "checks", "1234", "--json"],
      cwd: "/repo",
    });
  });

  it("is false while checks are pending, so a pending PR gets no notice", async () => {
    const { cli } = setup(() => ({ code: 2, stdout: report("pending") }));

    expect(await cli.ciGreen(1234)).toBe(false);
  });

  it("is false on red, which exits 1 and still prints its state", async () => {
    const { cli } = setup(() => ({ code: 1, stdout: report("red") }));

    expect(await cli.ciGreen(1234)).toBe(false);
  });

  it("refuses output that carries no state, so an unreadable CI is never read as green", async () => {
    const { cli } = setup(() => ({ code: 1, stderr: "no auth" }));

    await expect(cli.ciGreen(1234)).rejects.toBeInstanceOf(HarnessCliError);
  });
});

describe("TickCli.mainHead", () => {
  it("reads origin/main's head commit through the GitHub API, trimmed", async () => {
    const { cli, calls } = setup(() => ({ stdout: "9988776655aabb\n" }));

    expect(await cli.mainHead()).toBe("9988776655aabb");
    expect(calls[0]).toEqual({
      command: "gh",
      args: ["api", "repos/{owner}/{repo}/commits/main", "--jq", ".sha"],
      cwd: "/repo",
    });
  });
});

describe("TickCli.sendToWriter", () => {
  it("sends the notice through session send to the writer by name, with the tick's sender variables", async () => {
    const { cli, calls } = setup();

    expect(await cli.sendToWriter(WRITER, "Branch update notice")).toBe(
      undefined,
    );
    expect(calls).toEqual([
      {
        command: "node",
        args: [
          "skills/bin/harness.mjs",
          "session",
          "send",
          WRITER,
          "--message",
          "Branch update notice",
        ],
        cwd: "/repo",
        env: TICK_ENV,
      },
    ]);
  });

  it("returns the refusal naming the writer when session send fails, and does not throw", async () => {
    const { cli } = setup(() => ({
      code: 1,
      stderr: "Session idea-0034-writer-abc1234 is closed",
    }));

    const error = await cli.sendToWriter(WRITER, "Branch update notice");

    expect(error).toContain(WRITER);
    expect(error).toContain("is closed");
    expect(error).toContain("Nothing was recorded");
  });
});

describe("TickCli branch notice reads and sends", () => {
  it("never calls a branch-updating or merging endpoint", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({
        mergeStateStatus: "BEHIND",
        state: "green",
      }),
    }));

    await cli.mergeState(1234);
    await cli.ciGreen(1234);
    await cli.mainHead();
    await cli.sendToWriter(WRITER, "Branch update notice");

    const everything = calls.map((c) => c.args.join(" ")).join("\n");
    // `gh pr merge` and `pulls/.../merge` are merges; `update-branch` and `pulls` update a branch.
    expect(everything).not.toMatch(
      / merge(\s|$)|\/merge|update-branch|pulls|rebase|\bpush\b/,
    );
  });
});
