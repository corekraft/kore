import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import { notify } from "./notify.js";
import { fail } from "./output.js";

vi.mock("./equalize.js", () => ({
  describeFailure: vi.fn(() => "herdr said no"),
}));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });
const failed: Result = { code: 1, stdout: "", stderr: "boom" };

const LINE =
  "[herdr:image-trust-writer] finished: RESULT done; summary in pane w3:p9";
const SESSION = { HERDR_PANE_ID: "w3:p9", KORE_AGENT: "image-trust-writer" };
/** The caller's pane: its transcript, then the input box as the last prompt line. */
const pane = (transcript: readonly string[], input = "") =>
  [...transcript, `❯ ${input}`].join("\n");
const EMPTY = pane(["⏺ Waiting for the writer."]);
const SUBMITTED = pane(["⏺ Waiting for the writer.", `❯ ${LINE}`]);
const TYPED = pane(["⏺ Waiting for the writer."], LINE);

interface Script {
  /** What each `herdr pane read` returns, in order; the last one repeats. */
  reads: readonly Result[];
  sendText?: Result;
  sendKeys?: Result;
  env?: Record<string, string>;
  operand?: string | undefined;
  outcome?: string;
  json?: boolean;
}

function scripted(script: Script) {
  const {
    reads,
    sendText = ok(),
    sendKeys = ok(),
    env = SESSION,
    outcome = "done",
    json = false,
  } = script;
  // An explicit undefined is the missing operand, so a default must not replace it.
  const operand = "operand" in script ? script.operand : "w3:p1";
  let read = 0;
  const calls: string[] = [];
  const out: string[] = [];
  const sleep = vi.fn(() => Promise.resolve());
  const run = (command: string, args: readonly string[]) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (args[1] === "send-text") {
      return Promise.resolve(sendText);
    }
    if (args[1] === "send-keys") {
      return Promise.resolve(sendKeys);
    }
    const result = reads[Math.min(read, reads.length - 1)] ?? ok();
    read += 1;
    return Promise.resolve(result);
  };
  const deps = {
    runner: { run },
    clock: { now: () => new Date(0), sleep },
    env,
    stdout: (text: string) => out.push(text),
    stderr: () => undefined,
  } as unknown as CliDeps;
  const context: CommandContext = {
    json,
    deps,
    operand,
    options: { outcome },
  };
  return { context, calls, out, sleep };
}

const READ = "herdr pane read w3:p1 --source recent-unwrapped";
const SEND = `herdr pane send-text w3:p1 ${LINE}`;
const ENTER = "herdr pane send-keys w3:p1 enter";
const failure = () => vi.mocked(fail).mock.calls[0]?.[3];

beforeEach(() => {
  vi.mocked(fail).mockReset();
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
});

describe("session notify delivers the finish line", () => {
  it("reads the caller pane, sends the line, submits it, then confirms a new submitted line shows there", async () => {
    const s = scripted({ reads: [ok(EMPTY), ok(SUBMITTED)] });
    expect(await notify(s.context)).toBe(0);
    expect(s.calls).toEqual([READ, SEND, ENTER, READ]);
    expect(s.out).toEqual([
      "Notified w3:p1: image-trust-writer finished: RESULT done.\n",
    ]);
    expect(fail).not.toHaveBeenCalled();
  });

  it("prints the delivery as one JSON line with --json", async () => {
    const s = scripted({ reads: [ok(EMPTY), ok(SUBMITTED)], json: true });
    expect(await notify(s.context)).toBe(0);
    expect(s.out).toEqual([
      '{"pane":"w3:p1","name":"image-trust-writer","outcome":"done","delivered":true}\n',
    ]);
  });

  it("sends blocked as the outcome when asked", async () => {
    const blocked = LINE.replace("RESULT done", "RESULT blocked");
    const s = scripted({
      reads: [ok(EMPTY), ok(pane(["⏺ Waiting.", `❯ ${blocked}`]))],
      outcome: "blocked",
    });
    expect(await notify(s.context)).toBe(0);
    expect(s.calls[1]).toBe(`herdr pane send-text w3:p1 ${blocked}`);
  });

  it("keeps reading, one second apart, until the submitted line shows", async () => {
    const s = scripted({ reads: [ok(EMPTY), ok(TYPED), ok(SUBMITTED)] });
    expect(await notify(s.context)).toBe(0);
    expect(s.calls).toEqual([READ, SEND, ENTER, READ, READ]);
    expect(s.sleep.mock.calls).toEqual([[1000]]);
  });

  it("counts a new line beside an identical older one as delivered", async () => {
    const twice = pane(["⏺ Waiting.", `❯ ${LINE}`, "⏺ Noted.", `❯ ${LINE}`]);
    const s = scripted({ reads: [ok(SUBMITTED), ok(twice)] });
    expect(await notify(s.context)).toBe(0);
  });
});

describe("session notify does not count what was not delivered", () => {
  it("fails when the line is typed in the input box but never submitted", async () => {
    const s = scripted({ reads: [ok(EMPTY), ok(TYPED)] });
    expect(await notify(s.context)).toBe(1);
    expect(s.calls).toEqual([READ, SEND, ENTER, READ, READ, READ]);
    expect(s.sleep.mock.calls).toEqual([[1000], [1000]]);
    expect(failure()).toBe(
      "Delivery to w3:p1 not confirmed: no new submitted finish line showed there in 3 reads. It was sent, so read pane w3:p1 before sending it again; if it sits in the input box, submit it with enter.",
    );
    expect(s.out).toEqual([]);
  });

  it("fails when only an identical line from before the send is in the pane", async () => {
    const s = scripted({ reads: [ok(SUBMITTED), ok(SUBMITTED)] });
    expect(await notify(s.context)).toBe(1);
    expect(failure()).toContain("Delivery to w3:p1 not confirmed");
  });

  it("fails when the pane cannot be read back after the send", async () => {
    const s = scripted({ reads: [ok(EMPTY), failed] });
    expect(await notify(s.context)).toBe(1);
    expect(failure()).toContain("Delivery to w3:p1 not confirmed");
  });
});

describe("session notify stops at the step that failed", () => {
  it("sends nothing when the caller pane cannot be read first", async () => {
    const s = scripted({ reads: [failed] });
    expect(await notify(s.context)).toBe(1);
    expect(s.calls).toEqual([READ]);
    expect(failure()).toBe(
      "herdr pane read w3:p1 failed: herdr said no. Nothing was sent, because delivery could not be confirmed afterwards.",
    );
  });

  it("does not press enter when the line cannot be typed", async () => {
    const s = scripted({ reads: [ok(EMPTY)], sendText: failed });
    expect(await notify(s.context)).toBe(1);
    expect(s.calls).toEqual([READ, SEND]);
    expect(failure()).toBe(
      "herdr pane send-text to w3:p1 failed: herdr said no",
    );
  });

  it("names the typed but unsubmitted line when enter cannot be sent", async () => {
    const s = scripted({ reads: [ok(EMPTY)], sendKeys: failed });
    expect(await notify(s.context)).toBe(1);
    expect(s.calls).toEqual([READ, SEND, ENTER]);
    expect(failure()).toBe(
      "herdr pane send-keys to w3:p1 failed: herdr said no. The line is typed but not submitted in pane w3:p1.",
    );
  });
});

describe("session notify refuses before running anything", () => {
  it.each([
    ["an outcome other than done or blocked", { outcome: "merged" }, 2],
    ["a pane that is not a pane id", { operand: "w3:p1;rm" }, 2],
    ["a missing pane", { operand: undefined }, 2],
    ["a pane with no session name", { env: { HERDR_PANE_ID: "w3:p9" } }, 1],
    ["a session outside Herdr", { env: { KORE_AGENT: "x" } }, 1],
  ])("refuses %s", async (_what, given, code) => {
    const s = scripted({ reads: [ok(EMPTY)], ...given });
    expect(await notify(s.context)).toBe(code);
    expect(s.calls).toEqual([]);
    expect(s.out).toEqual([]);
  });
});
