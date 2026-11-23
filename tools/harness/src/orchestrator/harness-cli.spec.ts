import { describe, expect, it } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { HarnessCli, HarnessCliError } from "./harness-cli.js";

const OUTCOME = {
  kind: "verification",
  source: "comparison",
  result: "confirmed",
  evidence: "PR #50",
  summary: "Merged.",
} as const;

function setup(answer: (args: string[]) => Partial<RunResult> = () => ({})) {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const runner: Runner = {
    run: (command, args, options) => {
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
  };
  return { cli: new HarnessCli(runner, "/repo"), calls };
}

const harness = (...args: string[]) => ({
  command: "node",
  args: ["skills/bin/harness.mjs", ...args],
  cwd: "/repo",
});

describe("HarnessCli", () => {
  it("reads the queue with the read-only queue command", async () => {
    const item = { kind: "idea", idea: "0042", issue: 197, since: "t" };
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ queue: [item] }),
    }));
    expect(await cli.queue()).toEqual([item]);
    expect(calls).toEqual([harness("queue", "next", "--json")]);
  });

  it("spawns a writer in a worktree without waiting, on the escalation model when given", async () => {
    const { cli, calls } = setup();
    await cli.spawn({
      role: "writer",
      name: "idea-0042-writer",
      brief: "b",
      issue: 197,
      worktree: true,
      model: "claude-sonnet-5-5",
    });
    expect(calls).toEqual([
      harness(
        "session",
        "spawn",
        "--role",
        "writer",
        "--name",
        "idea-0042-writer",
        "--brief",
        "b",
        "--idea",
        "197",
        "--no-wait",
        "--worktree",
        "--model",
        "claude-sonnet-5-5",
      ),
    ]);
  });

  it("omits --model and --worktree when the launch has neither", async () => {
    const { cli, calls } = setup();
    await cli.spawn({ role: "judge", name: "j-judge", brief: "b", issue: 1 });
    expect(calls[0]?.args).not.toContain("--model");
    expect(calls[0]?.args).not.toContain("--worktree");
  });
});

describe("HarnessCli panes and delivery", () => {
  it("waits through session wait and returns the recorded outcome", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ outcome: "blocked" }),
    }));
    expect(await cli.wait("idea-0042-writer")).toBe("blocked");
    expect(calls).toEqual([
      harness("session", "wait", "idea-0042-writer", "--json"),
    ]);
  });

  it("closes a pane through session close", async () => {
    const { cli, calls } = setup();
    await cli.close("idea-0042-writer");
    expect(calls).toEqual([harness("session", "close", "idea-0042-writer")]);
  });

  it("reads the delivery from the newest pull request that refs the issue", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify([
        { number: 50, mergedAt: null },
        { number: 52, mergedAt: "2026-01-02T00:00:00Z" },
      ]),
    }));
    expect(await cli.delivery(197)).toEqual({ pr: 52, merged: true });
    expect(calls).toEqual([
      {
        command: "gh",
        args: [
          "pr",
          "list",
          "--state",
          "all",
          "--search",
          "Refs #197 in:body",
          "--json",
          "number,mergedAt",
        ],
        cwd: "/repo",
      },
    ]);
  });

  it("reports no pull request when none refs the issue", async () => {
    const { cli } = setup(() => ({ stdout: "[]" }));
    expect(await cli.delivery(197)).toEqual({ merged: false });
  });
});

describe("HarnessCli escalation, outcome and failure", () => {
  it("counts send-backs and escalates through the queue commands", async () => {
    const tier = {
      pr: 50,
      count: 2,
      model: "claude-sonnet-5-5",
      escalate: true,
    };
    const { cli, calls } = setup(() => ({ stdout: JSON.stringify(tier) }));
    expect(await cli.sendBacks(50)).toEqual({
      count: 2,
      model: "claude-sonnet-5-5",
      escalate: true,
    });
    await cli.escalate(50);
    expect(calls).toEqual([
      harness("queue", "escalate", "50", "--check", "--json"),
      harness("queue", "escalate", "50"),
    ]);
  });

  it("records the outcome through outcome record, which writes the ledger and closes the issue", async () => {
    const { cli, calls } = setup();
    await cli.recordOutcome("0042", OUTCOME);
    expect(calls).toEqual([
      harness(
        "outcome",
        "record",
        "--idea",
        "0042",
        "--kind",
        "verification",
        "--source",
        "comparison",
        "--result",
        "confirmed",
        "--evidence",
        "PR #50",
        "--summary",
        "Merged.",
      ),
    ]);
  });

  it("names the command and its stderr when a tool fails, instead of carrying on", async () => {
    const { cli } = setup(() => ({ code: 1, stderr: "no ledger\n" }));
    await expect(cli.close("x-writer")).rejects.toThrow(
      new HarnessCliError(
        "`harness session close x-writer` failed: no ledger. Fix that, then rerun.",
      ),
    );
  });

  it("refuses unreadable output rather than guessing", async () => {
    const { cli } = setup(() => ({ stdout: "not json" }));
    await expect(cli.queue()).rejects.toThrow(HarnessCliError);
  });
});

describe("HarnessCli retro tools", () => {
  it("reads retro due as read-only json, reduced to what the launch needs", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({
        due: true,
        reason: "metric",
        metric: "tokensPerIdea",
        closedIdeas: 6,
        threshold: 5,
        lastRetrospective: null,
      }),
    }));
    expect(await cli.retroDue()).toEqual({
      due: true,
      reason: "metric",
      metric: "tokensPerIdea",
    });
    expect(calls).toEqual([harness("retro", "due", "--json")]);
  });

  it("records the retro trigger through the owning retro record command", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({
        reason: "count",
        recordedAt: "2026-11-15T09:30:12Z",
        appended: true,
      }),
    }));
    expect(await cli.retroRecord("count")).toEqual({
      recordedAt: "2026-11-15T09:30:12Z",
      appended: true,
    });
    expect(calls).toEqual([
      harness("retro", "record", "--reason", "count", "--json"),
    ]);
  });
});

describe("HarnessCli retro", () => {
  it("spawns the retro pane on its model and effort with the reason, without waiting and without a worktree", async () => {
    const { cli, calls } = setup();
    await cli.spawnRetro({
      role: "reader",
      name: "retro-20261115-0930",
      model: "claude-sonnet-5-5",
      effort: "high",
      reason: "why",
      brief: "b",
    });
    expect(calls).toEqual([
      harness(
        "session",
        "spawn",
        "--role",
        "reader",
        "--name",
        "retro-20261115-0930",
        "--brief",
        "b",
        "--model",
        "claude-sonnet-5-5",
        "--effort",
        "high",
        "--reason",
        "why",
        "--no-wait",
      ),
    ]);
  });

  it("collects a session by waiting for it and reading the summary its report carries", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ outcome: "done", summary: "the proposals" }),
    }));

    expect(await cli.collect("retro-1")).toEqual({
      outcome: "done",
      text: "the proposals",
    });
    expect(calls).toEqual([harness("session", "wait", "retro-1", "--json")]);
  });

  it("refuses a session that settled without a report, and names the fix", async () => {
    const { cli } = setup(() => ({
      stdout: JSON.stringify({ outcome: "done" }),
    }));

    await expect(cli.collect("retro-1")).rejects.toThrow(
      /settled without a report, so its proposals are not read/,
    );
  });
});
