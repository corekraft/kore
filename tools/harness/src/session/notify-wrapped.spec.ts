// The shared delivery step with signed-main-sends on: a line wider than the pane is
// confirmed once its wrapped rows are rejoined, and the input box never counts (ADR 0123).
// The flag reader is its own unit (ADR 0098), so each test sets it here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import { notify } from "./notify.js";
import { fail } from "./output.js";
import { signedMainSendsOn } from "./signed-sends.js";

vi.mock("./signed-sends.js", () => ({ signedMainSendsOn: vi.fn() }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });

const LINE =
  "sender: writer image-trust-writer (session notify): finished: RESULT done; summary in pane w3:p9";
const SESSION = {
  HERDR_PANE_ID: "w3:p9",
  KORE_AGENT: "image-trust-writer",
  KORE_ROLE: "writer",
};
const READ = "herdr pane read w3:p1 --source recent-unwrapped --ansi";
const SEND = `herdr pane send-text w3:p1 ${LINE}`;
const ENTER = "herdr pane send-keys w3:p1 enter";
const NO_RESEND =
  "Do not send it again: `session wait` records your result from your RESULT line, so end your turn.";

/** The caller's pane: its transcript, then the input box as the last prompt line. */
const pane = (transcript: readonly string[], input = "") =>
  [...transcript, `❯ ${input}`].join("\n");
const EMPTY = pane(["⏺ Waiting for the writer."]);
/** A narrow pane draws the line on two rows: the first after the prompt, the rest indented beneath. */
const WRAPPED_ROWS = [`❯ ${LINE.slice(0, 40)}`, `  ${LINE.slice(40)}`];
const TRANSCRIPT = ["⏺ Waiting for the writer.", ...WRAPPED_ROWS];
const SUBMITTED_WRAPPED = pane(TRANSCRIPT);

/** Records the herdr calls; each `pane read` returns the next of `reads`, the last one repeating. */
function scripted(reads: readonly Result[]) {
  let read = 0;
  const calls: string[] = [];
  const out: string[] = [];
  const sleep = vi.fn<CliDeps["clock"]["sleep"]>(() => Promise.resolve());
  const run: CliDeps["runner"]["run"] = (command, args) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (args[1] === "send-text" || args[1] === "send-keys") {
      return Promise.resolve(ok());
    }
    const result = reads[Math.min(read, reads.length - 1)] ?? ok();
    read += 1;
    return Promise.resolve(result);
  };
  // Only what notify touches; the rest of CliDeps is never read.
  const deps: Pick<CliDeps, "runner" | "clock" | "env" | "stdout" | "stderr"> =
    {
      runner: { run },
      clock: { now: () => new Date(0), sleep },
      env: SESSION,
      stdout: (text) => {
        out.push(text);
      },
      stderr: () => undefined,
    };
  const context: CommandContext = {
    json: false,
    deps: deps as CliDeps,
    operand: "w3:p1",
    options: { outcome: "done" },
  };
  return { context, calls, out, sleep };
}

const failure = () => vi.mocked(fail).mock.calls[0]?.[3];

beforeEach(() => {
  vi.mocked(fail).mockReset();
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  vi.mocked(signedMainSendsOn).mockResolvedValue(false);
});

describe("session notify confirms a wrapped line with signed-main-sends on", () => {
  beforeEach(() => {
    vi.mocked(signedMainSendsOn).mockResolvedValue(true);
  });

  it("confirms a line wider than the pane once its wrapped rows are rejoined", async () => {
    const s = scripted([ok(EMPTY), ok(SUBMITTED_WRAPPED)]);
    expect(await notify(s.context)).toBe(0);
    expect(s.calls).toEqual([READ, SEND, ENTER, READ]);
    expect(s.out).toEqual([
      "Notified w3:p1: image-trust-writer finished: RESULT done.\n",
    ]);
    expect(fail).not.toHaveBeenCalled();
  });

  it("counts a wrapped line beside an identical older one as delivered", async () => {
    const twice = pane([...TRANSCRIPT, ...WRAPPED_ROWS]);
    const s = scripted([ok(SUBMITTED_WRAPPED), ok(twice)]);
    expect(await notify(s.context)).toBe(0);
  });

  it("does not confirm a wrapped line that never arrives", async () => {
    const s = scripted([ok(EMPTY), ok(EMPTY)]);
    expect(await notify(s.context)).toBe(1);
    expect(s.sleep.mock.calls).toEqual([[1000], [1000]]);
    expect(failure()).toBe(
      `Delivery to w3:p1 not confirmed: no new submitted line showed there in 3 reads. ${NO_RESEND}`,
    );
    expect(s.out).toEqual([]);
  });

  it("does not count a wrapped line typed in the input box beside an identical submitted copy", async () => {
    // The same wrapped line again, typed into the input box as its last prompt, never submitted.
    const typed = [...TRANSCRIPT, ...WRAPPED_ROWS].join("\n");
    const s = scripted([ok(SUBMITTED_WRAPPED), ok(typed)]);
    expect(await notify(s.context)).toBe(1);
    expect(failure()).toContain("Delivery to w3:p1 not confirmed");
    expect(s.out).toEqual([]);
  });
});

describe("session notify keeps the line-by-line result with signed-main-sends off", () => {
  it("does not confirm a wrapped line, as before", async () => {
    const s = scripted([ok(EMPTY), ok(SUBMITTED_WRAPPED)]);
    expect(await notify(s.context)).toBe(1);
    expect(s.sleep.mock.calls).toEqual([[1000], [1000]]);
    expect(failure()).toBe(
      `Delivery to w3:p1 not confirmed: no new submitted line showed there in 3 reads. ${NO_RESEND}`,
    );
  });
});
