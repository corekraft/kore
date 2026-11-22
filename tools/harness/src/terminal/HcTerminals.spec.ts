import { describe, expect, it, vi, type Mock } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { refuseRun } from "./hc-argv.js";
import { hcFailure } from "./hc-errors.js";
import { HC_0_1_21 } from "./hc-0.1.21.fixtures.js";
import {
  isHcList,
  isHcRead,
  isHcRemoved,
  isHcTerminal,
  isHcWait,
  isJsonObject,
} from "./hc-shapes.js";
import { HcTerminals } from "./HcTerminals.js";
import {
  rows,
  SIBLING_FINISHED,
  WRITER_FINISHED,
  WRITER_LIVE,
  failed,
  ok,
  scripted,
} from "./hc-terminals-support.js";
import type { Terminals } from "./port.js";

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
}));
vi.mock("./port.js", () => ({
  terminalError: vi.fn((kind: string, message: string, hint?: string) => ({
    error: { kind, message, hint },
  })),
}));

describe("HcTerminals: each method builds its argv, parses hc's JSON and maps it", () => {
  it.each(rows)("%s", async (_name, call, argv, stdout, expected) => {
    const runner = scripted(ok(stdout));
    expect(await call(new HcTerminals({ runner, env: {} }))).toEqual(expected);
    expect(runner.run.mock.calls).toEqual([["hc", argv]]);
  });
});

describe("HcTerminals: run", () => {
  it("passes the argv as separate elements after --, with every option as its own flag", async () => {
    const runner = scripted(ok(HC_0_1_21.run));
    await new HcTerminals({ runner, env: {} }).run({
      argv: ["claude", "--agent", "writer", "--model", "sonnet", "brief text"],
      name: "s1",
      cwd: "/work/kore",
      labels: { role: "writer", "kore-session": "s1" },
      parent: "t3",
      outliveParent: true,
    });
    expect(runner.run.mock.calls).toEqual([
      [
        "hc",
        [
          "run",
          "--json",
          "--bg",
          "--name",
          "s1",
          "--cwd",
          "/work/kore",
          "--label",
          "role=writer",
          "--label",
          "kore-session=s1",
          "--parent",
          "t3",
          "--outlive-parent",
          "--",
          "claude",
          "--agent",
          "writer",
          "--model",
          "sonnet",
          "brief text",
        ],
      ],
    ]);
  });

  it("returns what the argv check refuses, and runs hc not at all", async () => {
    vi.mocked(refuseRun).mockReturnValueOnce({
      error: { kind: "invalid-spec", message: "refused" },
    });
    const runner = scripted();
    expect(
      await new HcTerminals({ runner, env: {} }).run({
        argv: ["claude"],
        cwd: "/w",
      }),
    ).toEqual({
      error: { kind: "invalid-spec", message: "refused" },
    });
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("HcTerminals: get, list and status", () => {
  it("maps a live terminal's reported status, and leaves out an exit code it does not have", async () => {
    const runner = scripted(ok(HC_0_1_21.run));
    expect(await new HcTerminals({ runner, env: {} }).get("t7")).toEqual(
      WRITER_LIVE,
    );
  });

  it("hands a failed command to the error mapping with its verb, and returns what it gives", async () => {
    const result = failed(3, HC_0_1_21.errors.notFound);
    const runner = scripted(result);
    expect(await new HcTerminals({ runner, env: {} }).get("t9")).toEqual({
      error: { kind: "unavailable", message: "hc get exited with code 3" },
    });
    expect(hcFailure).toHaveBeenCalledWith("get", result);
  });

  it("passes the labels to hc, and keeps only the children of the parent asked for", async () => {
    const runner = scripted(ok(HC_0_1_21.list));
    const listed = await new HcTerminals({ runner, env: {} }).list({
      labels: { role: "writer" },
      childrenOf: "t3",
    });
    expect(runner.run.mock.calls).toEqual([
      ["hc", ["ls", "--json", "--all", "--label", "role=writer"]],
    ]);
    expect(listed).toEqual([WRITER_LIVE, SIBLING_FINISHED]);
  });

  it("lists every terminal, finished ones included, when given no filter", async () => {
    const runner = scripted(ok(HC_0_1_21.list));
    expect(await new HcTerminals({ runner, env: {} }).list()).toHaveLength(3);
    expect(runner.run.mock.calls).toEqual([["hc", ["ls", "--json", "--all"]]]);
  });

  it("sends only when the status is exactly ifStatus", async () => {
    const runner = scripted(ok(HC_0_1_21.send));
    await new HcTerminals({ runner, env: {} }).send("t7", "hello", {
      ifStatus: "idle",
    });
    expect(runner.run.mock.calls).toEqual([
      ["hc", ["send", "--json", "--if", "idle", "--", "t7", "hello"]],
    ]);
  });
});

describe("HcTerminals: wait", () => {
  it("waits on one terminal in hc's seconds, then returns it as finished", async () => {
    const runner = scripted(ok(HC_0_1_21.waitTerminal), ok(HC_0_1_21.get));
    expect(
      await new HcTerminals({ runner, env: {} }).wait({ terminal: "t7" }, 5000),
    ).toEqual({ finished: [WRITER_FINISHED] });
    expect(runner.run.mock.calls).toEqual([
      ["hc", ["wait", "--json", "--timeout", "5", "t7"]],
      ["hc", ["get", "--json", "t7"]],
    ]);
  });

  it("waits on a parent's children, and returns only the children that have stopped", async () => {
    const runner = scripted(ok(HC_0_1_21.waitChildren), ok(HC_0_1_21.get));
    expect(
      await new HcTerminals({ runner, env: {} }).wait(
        { children: "any", of: "t3" },
        5000,
      ),
    ).toEqual({ finished: [WRITER_FINISHED] });
    expect(runner.run.mock.calls).toEqual([
      ["hc", ["wait", "--json", "--children", "any", "--timeout", "5", "t3"]],
      ["hc", ["get", "--json", "t7"]],
    ]);
  });

  it("reports a timeout as the port's timeout error, with the port's message and hint", async () => {
    const runner = scripted(ok(HC_0_1_21.waitTimeout));
    expect(
      await new HcTerminals({ runner, env: {} }).wait({ terminal: "t7" }, 5000),
    ).toEqual({
      error: {
        kind: "timeout",
        message: "nothing has finished within 5000 ms",
        hint: "wait longer, or check the terminal with get()",
      },
    });
  });

  it("does not report a wait that a message ended as a timeout", async () => {
    const runner = scripted(ok(HC_0_1_21.waitMessage));
    expect(
      await new HcTerminals({ runner, env: {} }).wait(
        { children: "any", of: "t3" },
        5000,
      ),
    ).toEqual({
      error: {
        kind: "unavailable",
        message: "wait stopped without a finished terminal (reason message)",
      },
    });
  });
});

describe("HcTerminals: output and events", () => {
  it("reports output that is not JSON as unavailable, and does not throw", async () => {
    const runner = scripted(ok("not json"));
    expect(await new HcTerminals({ runner, env: {} }).read("t7", 1)).toEqual({
      error: {
        kind: "unavailable",
        message: "hc read printed output that is not JSON",
      },
    });
  });

  it("refuses to follow events, since a Runner returns only when its command ends, and runs nothing", () => {
    const runner = scripted();
    expect(() => new HcTerminals({ runner, env: {} }).events()).toThrow(
      "HcTerminals cannot follow events: a Runner returns only when its command ends, and hc events never ends. The ledger watch terminal reads them (plan 16, Step 4)",
    );
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("HcTerminals: each method checks the shape it reads", () => {
  const checks: [
    verb: string,
    call: (t: Terminals) => Promise<unknown>,
    predicate: unknown,
  ][] = [
    ["run", (t) => t.run({ argv: ["bash"], cwd: "/w" }), isHcTerminal],
    ["get", (t) => t.get("t7"), isHcTerminal],
    ["ls", (t) => t.list(), isHcList],
    ["read", (t) => t.read("t7", 1), isHcRead],
    ["wait", (t) => t.wait({ terminal: "t7" }, 1000), isHcWait],
    ["rm", (t) => t.remove("t7"), isHcRemoved],
    ["kill", (t) => t.kill("t7"), isJsonObject],
  ];

  it.each(checks)(
    "reports a %s reply its shape check refuses as unavailable, naming the shape",
    async (verb, call, predicate) => {
      (predicate as Mock).mockReturnValueOnce(false);
      const runner = scripted(ok("{}"));
      expect(await call(new HcTerminals({ runner, env: {} }))).toEqual({
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
    expect(
      new HcTerminals({ runner, env: { HC_TERMINAL_ID: "t3" } }).self(),
    ).toBe("t3");
    expect(new HcTerminals({ runner, env: {} }).self()).toBeUndefined();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("never gives the Runner an env or any other option, so hc's argv and environment carry no secret", async () => {
    const runner: { run: Runner["run"] & ReturnType<typeof scripted>["run"] } =
      scripted(ok(HC_0_1_21.run), ok(HC_0_1_21.send), ok(HC_0_1_21.label));
    const terminals = new HcTerminals({
      runner,
      env: { GH_TOKEN: "ghs_secret" },
    });
    await terminals.run({ argv: ["claude"], cwd: "/w" });
    await terminals.send("t7", "hello");
    await terminals.label("t7", { model: "sonnet" });
    expect(runner.run.mock.calls.every((call) => call.length === 2)).toBe(true);
    expect(JSON.stringify(runner.run.mock.calls)).not.toContain("ghs_secret");
  });
});
