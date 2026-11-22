import { describe, expect, it, vi, type Mock } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { refuseRun } from "./hc-argv.js";
import { hcFailure, unfinishedWait } from "./hc-errors.js";
import { HC_0_1_21, RECORDED_CWD } from "./hc-0.1.21.fixtures.js";
import { HcTerminals } from "./HcTerminals.js";
import {
  KILLED_CHILD,
  KILLED_SIBLING,
  MESSAGE_WAIT,
  RUN_ARGV,
  RUN_CLAUDE,
  SIBLING_FINISHED,
  WRITER_FINISHED,
  WRITER_LIVE,
  failed,
  ok,
  rows,
  SHAPE_CHECKS,
  scripted,
} from "./hc-terminals-support.js";

// Doubles for the units this one composes (ADR 0098). Each has its own spec:
// the version check, the argv refusals and the error mapping. This spec checks
// what the adapter does with them.
vi.mock("./hc-version.js", () => ({
  checkHcVersion: vi.fn(async () => undefined),
}));
// Each shape check passes unless a test makes it refuse (its own spec covers the shapes).
vi.mock("./hc-shapes.js", () => ({
  isHcList: vi.fn(() => true),
  isHcRead: vi.fn(() => true),
  isHcRemoved: vi.fn(() => true),
  isHcTerminal: vi.fn(() => true),
  isHcWait: vi.fn(() => true),
  isJsonObject: vi.fn(() => true),
}));
vi.mock("./hc-argv.js", () => ({ refuseRun: vi.fn(() => undefined) }));
vi.mock("./hc-errors.js", () => ({
  hcFailure: vi.fn((verb: string, result: RunResult) => ({
    error: {
      kind: "unavailable",
      message: "hc " + verb + " exited with code " + result.code,
    },
  })),
  unfinishedWait: vi.fn((reason: string, timeoutMs: number) => ({
    error: {
      kind: reason === "message" ? "woke" : "timeout",
      message: "unfinished " + reason + " after " + timeoutMs + " ms",
    },
  })),
}));
vi.mock("./port.js", () => ({
  terminalError: vi.fn((kind: string, message: string, hint?: string) => ({
    error: { kind, message, hint },
  })),
}));

/** A line stream no test in this file reads, for the calls that never follow events. */
const unused = { lines: vi.fn() };

/** The adapter over a runner, with the environment given and the line stream no test here reads. */
function hc(
  runner: Runner,
  env: Record<string, string | undefined> = {},
): HcTerminals {
  return new HcTerminals({ runner, env, lines: unused });
}

/** The argv of each call the Runner made, without the program name. */
const argvs = (runner: { run: Mock }) =>
  runner.run.mock.calls.map((call) => call[1] as string[]);

describe("HcTerminals: each method builds its argv, parses hc's JSON and maps it", () => {
  it.each(rows)("%s", async (_name, call, argv, stdout, expected) => {
    const runner = scripted(ok(stdout));
    expect(await call(hc(runner))).toEqual(expected);
    expect(argvs(runner)).toEqual([argv]);
  });
});

describe("HcTerminals: run builds the argv", () => {
  it("passes the argv as separate elements after --, with every option as its own flag", async () => {
    const runner = scripted(ok(HC_0_1_21.getParentLive), ok(HC_0_1_21.run));
    await hc(runner).run({
      argv: RUN_CLAUDE,
      name: "s1",
      cwd: RECORDED_CWD,
      labels: { role: "writer", "kore-session": "s1" },
      parent: "t1",
      outliveParent: true,
      notify: false,
    });
    expect(argvs(runner)).toEqual([["get", "--json", "t1"], RUN_ARGV]);
  });

  it("returns what the argv check refuses, and runs hc not at all", async () => {
    vi.mocked(refuseRun).mockReturnValueOnce({
      error: { kind: "invalid-spec", message: "refused" },
    });
    const runner = scripted();
    expect(
      await hc(runner).run({
        argv: ["claude"],
        cwd: "/w",
      }),
    ).toEqual({ error: { kind: "invalid-spec", message: "refused" } });
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("HcTerminals: run and its parent", () => {
  it("refuses a parent that has finished, since hc would start the child live under it, and starts nothing", async () => {
    const runner = scripted(ok(HC_0_1_21.getParentFinished));
    expect(
      await hc(runner).run({
        argv: ["sh"],
        cwd: RECORDED_CWD,
        parent: "t1",
      }),
    ).toEqual({
      error: {
        kind: "not-live",
        message: "t1 has finished",
        hint: "a finished terminal takes no children; start the child under a live parent",
      },
    });
    expect(argvs(runner)).toEqual([["get", "--json", "t1"]]);
  });

  it("returns an unknown parent's error from the lookup, and starts nothing", async () => {
    const runner = scripted(failed(3, HC_0_1_21.errors.notFound));
    expect(
      await hc(runner).run({
        argv: ["sh"],
        cwd: RECORDED_CWD,
        parent: "nope",
      }),
    ).toEqual({
      error: { kind: "unavailable", message: "hc get exited with code 3" },
    });
    expect(argvs(runner)).toEqual([["get", "--json", "nope"]]);
  });
});

describe("HcTerminals: get and list", () => {
  it("maps a live terminal, and leaves out a name, parent or exit code it does not have", async () => {
    const runner = scripted(ok(HC_0_1_21.get));
    expect(await hc(runner).get("t2")).toEqual(WRITER_LIVE);
  });

  it("hands a failed command to the error mapping with its verb, and returns what it gives", async () => {
    const result = { stdout: HC_0_1_21.errors.notFound, stderr: "", code: 3 };
    const runner = scripted(result);
    expect(await hc(runner).get("nope")).toEqual({
      error: { kind: "unavailable", message: "hc get exited with code 3" },
    });
    expect(hcFailure).toHaveBeenCalledWith("get", result);
  });

  it("lists by label, and reads each terminal for its labels, which the listing does not carry", async () => {
    const runner = scripted(
      ok(HC_0_1_21.listLabel),
      ok(HC_0_1_21.get),
      ok(HC_0_1_21.getSibling),
    );
    expect(
      await hc(runner).list({
        labels: { role: "writer" },
      }),
    ).toEqual([WRITER_LIVE, SIBLING_FINISHED]);
    expect(argvs(runner)).toEqual([
      ["ls", "--json", "--all", "--label", "role=writer"],
      ["get", "--json", "t2"],
      ["get", "--json", "t3"],
    ]);
  });

  it("keeps only the children of the parent asked for", async () => {
    const runner = scripted(
      ok(HC_0_1_21.list),
      ok(HC_0_1_21.get),
      ok(HC_0_1_21.getSibling),
      ok(HC_0_1_21.kill),
    );
    expect(
      await hc(runner).list({
        childrenOf: "t1",
      }),
    ).toEqual([WRITER_LIVE, SIBLING_FINISHED, KILLED_SIBLING]);
    expect(argvs(runner).map((argv) => argv[0] + " " + argv.at(-1))).toEqual([
      "ls --all",
      "get t2",
      "get t3",
      "get t4",
    ]);
  });

  it("lists every terminal, finished ones included, when given no filter", async () => {
    const runner = scripted(
      ok(HC_0_1_21.list),
      ok(HC_0_1_21.getParentLive),
      ok(HC_0_1_21.get),
      ok(HC_0_1_21.getSibling),
      ok(HC_0_1_21.kill),
    );
    expect(await hc(runner).list()).toHaveLength(4);
    expect(argvs(runner)[0]).toEqual(["ls", "--json", "--all"]);
  });

  it("sends only when the status is exactly ifStatus", async () => {
    const runner = scripted(ok(HC_0_1_21.send));
    await hc(runner).send("t2", "hello", {
      ifStatus: "idle",
    });
    expect(argvs(runner)).toEqual([
      ["send", "--json", "--if", "idle", "--", "t2", "hello"],
    ]);
  });
});

describe("HcTerminals: wait", () => {
  it("waits on one terminal in hc's seconds, then returns it as finished", async () => {
    const runner = scripted(
      ok(HC_0_1_21.waitTerminal),
      ok(HC_0_1_21.getFinished),
    );
    expect(await hc(runner).wait({ terminal: "t2" }, 5000)).toEqual({
      finished: [WRITER_FINISHED],
    });
    expect(argvs(runner)).toEqual([
      ["wait", "--json", "--timeout", "5", "t2"],
      ["get", "--json", "t2"],
    ]);
  });

  it("waits on a parent's children, then returns every child that has stopped, read from the listing", async () => {
    const runner = scripted(
      ok(HC_0_1_21.waitChildrenAny),
      ok(HC_0_1_21.listLate),
      ok(HC_0_1_21.getFinished),
      ok(HC_0_1_21.getSibling),
      ok(HC_0_1_21.getKilledChild),
    );
    expect(await hc(runner).wait({ children: "any", of: "t1" }, 5000)).toEqual({
      finished: [WRITER_FINISHED, SIBLING_FINISHED, KILLED_CHILD],
    });
    expect(argvs(runner).slice(0, 2)).toEqual([
      ["wait", "--json", "--children", "any", "--timeout", "5", "t1"],
      ["ls", "--json", "--all"],
    ]);
  });

  it("maps a timeout reply through the unfinished-wait mapping, with hc's reason and the bound", async () => {
    const runner = scripted(ok(HC_0_1_21.waitTimeout));
    expect(await hc(runner).wait({ terminal: "t2" }, 5000)).toEqual({
      error: { kind: "timeout", message: "unfinished timeout after 5000 ms" },
    });
    expect(unfinishedWait).toHaveBeenCalledWith("timeout", 5000);
  });

  it("maps a message-ended wait through the unfinished-wait mapping, as woke and never a failure", async () => {
    const runner = scripted(ok(MESSAGE_WAIT));
    expect(await hc(runner).wait({ terminal: "t1" }, 5000)).toEqual({
      error: { kind: "woke", message: "unfinished message after 5000 ms" },
    });
    expect(unfinishedWait).toHaveBeenCalledWith("message", 5000);
  });
});

describe("HcTerminals: output and events", () => {
  it("reports output that is not JSON as unavailable, and does not throw", async () => {
    const runner = scripted(ok("not json"));
    expect(await hc(runner).read("t2", 1)).toEqual({
      error: {
        kind: "unavailable",
        message: "hc read printed output that is not JSON",
      },
    });
  });
});

describe("HcTerminals: each method checks the shape it reads", () => {
  it.each(SHAPE_CHECKS)(
    "reports a %s reply its shape check refuses as unavailable, naming the shape",
    async (verb, call, predicate) => {
      (predicate as Mock).mockReturnValueOnce(false);
      const runner = scripted(ok("{}"));
      expect(await call(hc(runner))).toEqual({
        error: {
          kind: "unavailable",
          message: "hc " + verb + " printed JSON of an unexpected shape",
          hint: "check hc --version against the pin in docs/operations/hc-pin.md",
        },
      });
    },
  );
});

describe("HcTerminals: self and secrets", () => {
  it("reads HC_TERMINAL_ID from the environment, is undefined outside a terminal, and runs nothing", () => {
    const runner = scripted();
    expect(hc(runner, { HC_TERMINAL_ID: "t3" }).self()).toBe("t3");
    expect(hc(runner).self()).toBeUndefined();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("never gives the Runner an env or any other option, so hc's argv and environment carry no secret", async () => {
    const runner: { run: Runner["run"] & ReturnType<typeof scripted>["run"] } =
      scripted(ok(HC_0_1_21.run), ok(HC_0_1_21.send), ok(HC_0_1_21.label));
    const terminals = hc(runner, { GH_TOKEN: "ghs_secret" });
    await terminals.run({ argv: ["claude"], cwd: "/w" });
    await terminals.send("t2", "hello");
    await terminals.label("t2", { model: "sonnet" });
    expect(runner.run.mock.calls.every((call) => call.length === 2)).toBe(true);
    expect(JSON.stringify(runner.run.mock.calls)).not.toContain("ghs_secret");
  });
});
