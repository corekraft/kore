// The replay core: which recorded calls the old rule refused and the new one allows.
// Both evaluators, the context and the transcripts are plain values here.

import { describe, expect, it } from "vitest";
import {
  callsInWindow,
  replayRule,
  type Evaluate,
  type WindowCall,
} from "./guard-replay.js";
import type { Transcript, TranscriptEvent } from "./retro-transcript.js";
import type { GuardContext, Verdict } from "./guard-verdict.js";

const ROOT = "/repo";
const at = (time: string) => `2026-11-15T${time}.000Z`;

const context = (cwd: string): GuardContext =>
  ({ root: ROOT, cwd }) as unknown as GuardContext;

const block = (rule: string): Verdict => ({
  action: "block",
  rule,
  message: `[guard:${rule}]`,
});
const warn = (rule: string): Verdict => ({
  action: "warn",
  rule,
  message: `[guard:${rule}]`,
});
const allow: Verdict = { action: "allow" };

/** An evaluator that answers from a table keyed by the command or path of the call. */
function answering(table: Record<string, Verdict>): Evaluate {
  return async (payload) => {
    const input = (payload as { tool_input: Record<string, string> })
      .tool_input;
    const key = input["command"] ?? input["file_path"] ?? "";
    return table[key] ?? allow;
  };
}

function call(
  overrides: Partial<WindowCall> & Pick<WindowCall, "tool" | "input">,
): WindowCall {
  return {
    session: "s1",
    line: 1,
    at: at("10:00:00"),
    cwd: ROOT,
    ...overrides,
  };
}

const bash = (command: string, line: number): WindowCall =>
  call({ tool: "Bash", input: { command }, line });

describe("replayRule lists the calls that changed from refused to allowed", () => {
  it("lists exactly the calls the old rule refused and the new one allows", async () => {
    const report = await replayRule({
      rule: "unquoted-glob",
      calls: [
        bash("ls *.ts", 1), // refused by unquoted-glob, then allowed
        bash("ls -la", 2), // allowed by both
        bash("echo $(x)", 3), // refused by unquoted-glob, still refused
        bash("rm -rf dist", 4), // refused by another rule, allowed by both
      ],
      before: answering({
        "ls *.ts": block("unquoted-glob"),
        "echo $(x)": block("unquoted-glob"),
        "rm -rf dist": block("destructive"),
      }),
      after: answering({ "echo $(x)": block("unquoted-glob") }),
      contextOf: context,
    });

    expect(report).toEqual({
      rule: "unquoted-glob",
      examined: 4,
      empty: false,
      changed: [
        {
          session: "s1",
          line: 1,
          at: at("10:00:00"),
          tool: "Bash",
          command: "ls *.ts",
        },
      ],
    });
  });

  it("counts a warning under the new rule as allowed", async () => {
    const report = await replayRule({
      rule: "bare-glob",
      calls: [bash("ls *.md", 1)],
      before: answering({ "ls *.md": block("bare-glob") }),
      after: answering({ "ls *.md": warn("bare-glob") }),
      contextOf: context,
    });

    expect(report.changed.map((c) => c.command)).toEqual(["ls *.md"]);
  });

  it("names the path of a file call that the old rule refused and the new one allows", async () => {
    const report = await replayRule({
      rule: "secret-path",
      calls: [
        call({
          tool: "Write",
          input: { file_path: "/repo/infra/secret.yaml" },
          line: 7,
        }),
      ],
      before: answering({ "/repo/infra/secret.yaml": block("secret-path") }),
      after: answering({}),
      contextOf: context,
    });

    expect(report.changed).toEqual([
      {
        session: "s1",
        line: 7,
        at: at("10:00:00"),
        tool: "Write",
        path: "/repo/infra/secret.yaml",
      },
    ]);
  });
});

describe("replayRule reports nothing it should not", () => {
  it("states an empty result as empty, with the count it examined", async () => {
    const report = await replayRule({
      rule: "unquoted-glob",
      calls: [bash("ls -la", 1), bash("echo hi", 2)],
      before: answering({}),
      after: answering({}),
      contextOf: context,
    });

    expect(report).toEqual({
      rule: "unquoted-glob",
      examined: 2,
      empty: true,
      changed: [],
    });
  });

  it("never lists a call the old rule allowed, even when the new rule blocks it", async () => {
    const report = await replayRule({
      rule: "unquoted-glob",
      calls: [bash("ls *.ts", 1)],
      before: answering({}),
      after: answering({ "ls *.ts": block("unquoted-glob") }),
      contextOf: context,
    });

    expect(report.empty).toBe(true);
    expect(report.changed).toEqual([]);
  });
});

describe("replayRule reads each call where it ran", () => {
  it("evaluates each call in the directory the call ran in, with both versions", async () => {
    const seen: string[] = [];
    const recording =
      (label: string): Evaluate =>
      async (_payload, ctx) => {
        seen.push(`${label}:${ctx.cwd}`);
        return allow;
      };
    await replayRule({
      rule: "unquoted-glob",
      calls: [call({ tool: "Bash", input: { command: "ls" }, cwd: "/repo/a" })],
      before: recording("before"),
      after: recording("after"),
      contextOf: context,
    });

    expect(seen).toEqual(["before:/repo/a", "after:/repo/a"]);
  });
});

const transcript = (id: string, events: TranscriptEvent[]): Transcript => ({
  id,
  events,
  skipped: 0,
});

const use = (
  line: number,
  timestamp: string | undefined,
  name: string,
  input: Record<string, unknown>,
  extra: Partial<TranscriptEvent> = {},
): TranscriptEvent => ({
  line,
  type: "assistant",
  ...(timestamp === undefined ? {} : { timestamp }),
  message: { content: [{ type: "tool_use", id: `t${line}`, name, input }] },
  ...extra,
});

const WINDOW = {
  since: Date.parse(at("09:00:00")),
  until: Date.parse(at("11:00:00")),
};

/** Session sess-a: four calls the replay reads, one Grep it does not, and two outside the window or untimed. */
const SESS_A_EVENTS: TranscriptEvent[] = [
  use(1, at("10:00:00"), "Bash", { command: "ls" }, { cwd: "/repo/x" }),
  use(2, at("10:01:00"), "Grep", { pattern: "x" }),
  use(3, at("10:02:00"), "Edit", { file_path: "/repo/a.ts" }),
  use(4, at("12:00:00"), "Bash", { command: "outside" }),
  use(5, undefined, "Bash", { command: "untimed" }),
  {
    line: 6,
    type: "user",
    timestamp: at("10:03:00"),
    message: { content: "typed" },
  },
];

describe("callsInWindow keeps the calls the replay evaluates", () => {
  it("keeps Bash, Read, Write and Edit calls that start inside the window", () => {
    const calls = callsInWindow(
      [transcript("sess-a", SESS_A_EVENTS)],
      WINDOW,
      ROOT,
    );

    expect(calls).toEqual([
      {
        session: "sess-a",
        line: 1,
        at: at("10:00:00"),
        cwd: "/repo/x",
        tool: "Bash",
        input: { command: "ls" },
      },
      {
        session: "sess-a",
        line: 3,
        at: at("10:02:00"),
        cwd: ROOT,
        tool: "Edit",
        input: { file_path: "/repo/a.ts" },
      },
    ]);
  });

  it("includes a subagent's calls", () => {
    const calls = callsInWindow(
      [
        transcript("sess-b", [
          use(
            1,
            at("10:00:00"),
            "Read",
            { file_path: "/repo/b" },
            {
              isSidechain: true,
            },
          ),
        ]),
      ],
      WINDOW,
      ROOT,
    );

    expect(calls.map((c) => c.line)).toEqual([1]);
  });

  it("excludes a call stamped exactly at the window's end", () => {
    const calls = callsInWindow(
      [
        transcript("sess-c", [
          use(2, at("11:00:00"), "Bash", { command: "at-end" }),
        ]),
      ],
      WINDOW,
      ROOT,
    );

    expect(calls).toEqual([]);
  });
});
