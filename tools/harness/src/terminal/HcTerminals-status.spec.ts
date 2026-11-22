import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import type { Terminal, Status } from "./port.js";
import { HcTerminals } from "./HcTerminals.js";
import { HC_0_1_21, RECORDED_CWD } from "./hc-0.1.21.fixtures.js";
import { WRITER_LIVE, ok, scripted } from "./hc-terminals-support.js";

// The unit is the adapter's get, read through its status mapping. Its dependencies are doubles here
// (ADR 0098): the version check, the shape guards, the argv refusals, the error mapping and the port's
// error constructor. Each has its own spec. The guards pass, so this spec checks only the mapping.
vi.mock("./hc-version.js", () => ({
  checkHcVersion: vi.fn(async () => undefined),
}));
vi.mock("./hc-shapes.js", () => ({
  isHcList: vi.fn(() => true),
  isHcRead: vi.fn(() => true),
  isHcRemoved: vi.fn(() => true),
  isHcTerminal: vi.fn(() => true),
  isHcWait: vi.fn(() => true),
  isJsonObject: vi.fn(() => true),
}));
vi.mock("./hc-argv.js", () => ({ refuseRun: vi.fn(() => undefined) }));
vi.mock("./hc-errors.js", () => ({ hcFailure: vi.fn() }));
vi.mock("./port.js", () => ({ terminalError: vi.fn() }));

/** A line stream no test in this file reads, since get never follows events. */
const unused = { lines: vi.fn() };

/** The adapter over a runner, with no environment and the line stream no test here reads. */
function hc(runner: Runner): HcTerminals {
  return new HcTerminals({ runner, env: {}, lines: unused });
}

/**
 * A live terminal as get names it, with the fields the adapter reads. #1874 quotes get's status
 * object from a live run, `{"app":"claude-code","state":"working"}`, where ls gives a bare string.
 */
const LIVE_REPLY = {
  address: "t2",
  cwd: RECORDED_CWD,
  labels: { "kore-session": "s1", role: "writer" },
  name: "s1",
  parent: "t1",
  state: "live",
  turn: 1,
};

/** The Terminal the adapter maps LIVE_REPLY to, with the status it reads, if it reads one. */
function liveTerminal(status?: Status): Terminal {
  return {
    id: "t2",
    name: "s1",
    parent: "t1",
    state: "live",
    labels: { "kore-session": "s1", role: "writer" },
    cwd: RECORDED_CWD,
    turn: 1,
    ...(status === undefined ? {} : { status }),
  };
}

/** get's reply for LIVE_REPLY with the status given, as hc prints it. */
function replyWith(status: unknown): string {
  return JSON.stringify({ ...LIVE_REPLY, status });
}

describe("HcTerminals: get maps a status in either shape hc prints", () => {
  it("maps hc 0.1.21's live get reply, whose status is an object, to the state the object names", async () => {
    const runner = scripted(ok(HC_0_1_21.getObjectStatus));
    expect(await hc(runner).get("t3f")).toStrictEqual({
      id: "t3f",
      state: "live",
      labels: { where: "tools / 1" },
      cwd: "/home/x/kore",
      status: "working",
      turn: 2,
    });
  });

  it.each([["ls's bare string, which is the status as is", "idle", "idle"]])(
    "maps a status given as %s to the status it names",
    async (_name, status, expected) => {
      const runner = scripted(ok(replyWith(status)));
      expect(await hc(runner).get("t2")).toStrictEqual(
        liveTerminal(expected as Status),
      );
    },
  );

  it("maps a real get reply with no status to a terminal with no status", async () => {
    const runner = scripted(ok(HC_0_1_21.get));
    expect(await hc(runner).get("t2")).toStrictEqual(WRITER_LIVE);
  });

  it.each([
    ["an object with no state", { app: "claude-code" }],
    ["an object whose state is null", { app: "claude-code", state: null }],
    ["an object whose state is not text", { app: "claude-code", state: 3 }],
    ["null", null],
  ])(
    "leaves out the status when it is %s, and reads no status from it",
    async (_name, status) => {
      const runner = scripted(ok(replyWith(status)));
      const terminal = await hc(runner).get("t2");
      expect(terminal).toStrictEqual(liveTerminal());
      expect(terminal).not.toHaveProperty("status");
    },
  );
});
