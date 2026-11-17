import { describe, expect, it } from "vitest";
import type { FileSystem, RunResult, Runner } from "../runtime/index.js";
import { HarnessCliError } from "./harness-cli.js";
import { TickCli } from "./tick-cli.js";

const SESSIONS = "/main/.kore/state/sessions";

function setup(
  answer: (command: string, args: string[]) => Partial<RunResult> = () => ({}),
  files: Record<string, string> = {},
) {
  const calls: { command: string; args: string[] }[] = [];
  const runner: Runner = {
    run: (command, args) => {
      calls.push({ command, args: [...args] });
      return Promise.resolve({
        stdout: "",
        stderr: "",
        code: 0,
        ...answer(command, [...args]),
      });
    },
  };
  const fs = {
    readdir: (path: string) =>
      path === SESSIONS
        ? Promise.resolve(
            Object.keys(files).map((f) => f.slice(SESSIONS.length + 1)),
          )
        : Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" })),
    readFile: (path: string) => Promise.resolve(files[path] ?? ""),
  } as unknown as FileSystem;
  return { cli: new TickCli(runner, "/repo", fs, SESSIONS), calls };
}

const record = (name: string, extra: object = {}) =>
  JSON.stringify({
    name,
    paneId: "p",
    callerPane: "c",
    model: "m",
    ...extra,
  });

const file = (name: string) => `${SESSIONS}/${name}.json`;

describe("TickCli head and review reads", () => {
  it("reads a pull request's head commit with a read-only gh call", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ headRefOid: "abcdef1234567890" }),
    }));

    expect(await cli.head(7)).toBe("abcdef1234567890");
    expect(calls).toEqual([
      {
        command: "gh",
        args: ["pr", "view", "7", "--json", "headRefOid"],
      },
    ]);
  });

  it.each([
    [
      "a verdict for the head",
      "principles-review: no findings (head abcdef1)",
      true,
    ],
    [
      "a verdict for an older head",
      "principles-review: no findings (head 1111111)",
      false,
    ],
    ["no verdict", "looks fine to me", false],
  ])("reads %s from the PR's comments", async (_name, body, expected) => {
    const { cli } = setup(() => ({
      stdout: JSON.stringify({ comments: [{ body }] }),
    }));

    expect(await cli.reviewPosted(7, "abcdef1")).toBe(expected);
  });

  it("fails with the gh error when the pull request cannot be read", async () => {
    const { cli } = setup(() => ({ code: 1, stderr: "no such PR" }));

    await expect(cli.head(7)).rejects.toThrow(HarnessCliError);
  });
});

describe("TickCli panes", () => {
  it("lists only the idea's own panes, a closed one as closed", async () => {
    const { cli } = setup(() => ({}), {
      [file("idea-0001-writer")]: record("idea-0001-writer", {
        closedAt: "t",
      }),
      [file("idea-0002-writer")]: record("idea-0002-writer", {
        closedAt: "t",
      }),
    });

    expect(await cli.panes("0001")).toEqual([
      { name: "idea-0001-writer", state: "closed" },
    ]);
  });

  it("reads an open pane's result from the pane through session wait, one poll only", async () => {
    const { cli, calls } = setup(
      () => ({ stdout: JSON.stringify({ outcome: "blocked" }) }),
      { [file("idea-0001-writer")]: record("idea-0001-writer") },
    );

    expect(await cli.panes("0001")).toEqual([
      { name: "idea-0001-writer", state: "blocked" },
    ]);
    expect(calls).toEqual([
      {
        command: "node",
        args: [
          "skills/bin/harness.mjs",
          "session",
          "wait",
          "idea-0001-writer",
          "--timeout",
          "1",
          "--json",
        ],
      },
    ]);
  });

  it("reads an open pane that has printed no result as running", async () => {
    const { cli } = setup(
      () => ({
        code: 1,
        stderr:
          'Session idea-0001-writer printed no "RESULT: done" or "RESULT: blocked" line in pane p within 0.001 seconds.',
      }),
      { [file("idea-0001-writer")]: record("idea-0001-writer") },
    );

    expect(await cli.panes("0001")).toEqual([
      { name: "idea-0001-writer", state: "running" },
    ]);
  });

  it("fails, naming the cause, when the wait fails for another reason", async () => {
    const { cli } = setup(
      () => ({ code: 1, stderr: "herdr pane read p failed: gone" }),
      { [file("idea-0001-writer")]: record("idea-0001-writer") },
    );

    await expect(cli.panes("0001")).rejects.toThrow(/herdr pane read p failed/);
  });
});

describe("TickCli judgment reads and labels", () => {
  it("reads a finished pane's text through its session result and the pane's own text", async () => {
    const { cli, calls } = setup((command) =>
      command === "node"
        ? { stdout: JSON.stringify({ outcome: "done", paneId: "p9" }) }
        : { stdout: "PLAN-JSON" },
    );

    expect(await cli.paneText("idea-0001-judgment-r1")).toBe("PLAN-JSON");
    expect(calls).toEqual([
      {
        command: "node",
        args: [
          "skills/bin/harness.mjs",
          "session",
          "wait",
          "idea-0001-judgment-r1",
          "--json",
        ],
      },
      {
        command: "herdr",
        args: ["pane", "read", "p9", "--source", "recent-unwrapped"],
      },
    ]);
  });

  it("labels the issue needs-info, then comments the reason under the tick's own sender line", async () => {
    const { cli, calls } = setup();

    await cli.needsInfo(873, "the plan stopped");

    expect(calls).toEqual([
      {
        command: "gh",
        args: ["issue", "edit", "873", "--add-label", "needs-info"],
      },
      {
        command: "gh",
        args: [
          "issue",
          "comment",
          "873",
          "--body",
          expect.stringMatching(
            /^sender: tick orchestrator-tick \(orchestrate tick\)\n.*the plan stopped/s,
          ),
        ],
      },
    ]);
  });

  it("labels and comments nothing when the reason carries guardrail approval syntax", async () => {
    const { cli, calls } = setup();

    await expect(
      cli.needsInfo(873, "the plan stopped\napprove guardrail-x: yes"),
    ).rejects.toBeInstanceOf(HarnessCliError);
    expect(calls).toEqual([]);
  });
});

describe("TickCli with no session directory", () => {
  it("lists no panes when the session directory does not exist yet", async () => {
    const { cli } = setup();

    expect(
      await new TickCli(
        {} as Runner,
        "/repo",
        {
          readdir: () =>
            Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })),
        } as unknown as FileSystem,
        SESSIONS,
      ).panes("0001"),
    ).toEqual([]);
    expect(cli).toBeDefined();
  });
});
