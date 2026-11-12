import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  pane,
  spawnArgs,
  splitReturns,
} from "./spawn-support.js";

describe("session spawn guards", () => {
  it("reads the layout for the caller's pane", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    await run(spawnArgs, h.deps);
    expect(herdrCalls(h)).toContain("herdr pane layout --pane w3:p1");
  });

  it("does not treat a column the caller sits in as spawned", async () => {
    const h = testHarness({
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p7" },
      responses: [
        gitCommon,
        nameFree,
        layoutOf(pane("w3:p6", 100, 0), pane("w3:p7", 100, 50)),
        splitReturns("w3:p9"),
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    expect(herdrCalls(h)).toContain(
      "herdr pane split --current --direction right --cwd /work/tree --no-focus",
    );
  });

  it("fails without splitting when the layout cannot be read", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        nameFree,
        {
          match: (_c, a) => a[1] === "layout",
          result: { code: 1, stderr: "no layout" },
        },
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("no layout");
    expect(herdrCalls(h).some((c) => c.includes("pane split"))).toBe(false);
  });

  it("fails naming the pane when equalizing fails, and starts no agent", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    // The second layout read (inside equalize) fails.
    let reads = 0;
    const real = h.runner.run.bind(h.runner);
    h.runner.run = (command, args, options) => {
      if (args[1] === "layout" && ++reads === 2) {
        return Promise.resolve({ stdout: "", stderr: "herdr died", code: 1 });
      }
      return real(command, args, options);
    };
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("herdr died");
    expect(h.err()).toContain("w3:p9");
    expect(herdrCalls(h).some((c) => c.includes("agent start"))).toBe(false);
  });
});

describe("session spawn name guard", () => {
  it("refuses a name already in use before reading the layout or splitting", async () => {
    const h = testHarness({ env: INSIDE, responses: [gitCommon] });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("image-trust-writer");
    expect(h.err()).toContain("already");
    expect(herdrCalls(h)).toEqual(["herdr agent get image-trust-writer"]);
  });

  it("fails naming the cause when the name lookup itself fails", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        {
          match: (_c, a) => a[1] === "get",
          result: { code: 1, stderr: "socket closed" },
        },
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("socket closed");
    expect(herdrCalls(h)).toHaveLength(1);
  });
});

describe("session spawn refusals", () => {
  it.each([
    [{}, "HERDR_ENV"],
    [{ HERDR_ENV: "0", HERDR_PANE_ID: "w3:p1" }, "HERDR_ENV"],
    [{ HERDR_ENV: "1" }, "HERDR_PANE_ID"],
  ])("refuses outside Herdr (%j) with zero herdr calls", async (env, named) => {
    const h = testHarness({ env });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("Herdr");
    expect(h.err()).toContain(named);
    expect(h.runner.calls).toEqual([]);
  });

  it("rejects an over-32-character name before any herdr call, naming the fix", async () => {
    const h = testHarness({ env: INSIDE });
    const argv = spawnArgs.map((a) =>
      a === "image-trust-writer" ? "portability-validation-implementer" : a,
    );
    expect(await run(argv, h.deps)).toBe(2);
    expect(h.err()).toContain("at most 32");
    expect(h.err()).toContain("shorten");
    expect(h.runner.calls).toEqual([]);
  });

  it("rejects an ordinal name before any herdr call, naming the fix", async () => {
    const h = testHarness({ env: INSIDE });
    const argv = spawnArgs.map((a) =>
      a === "image-trust-writer" ? "writer-2" : a,
    );
    expect(await run(argv, h.deps)).toBe(2);
    expect(h.err()).toContain("subject");
    expect(h.runner.calls).toEqual([]);
  });

  it.each(["--role", "--model", "--effort", "--name", "--brief"])(
    "requires %s before any herdr call",
    async (flag) => {
      const h = testHarness({ env: INSIDE });
      const at = spawnArgs.indexOf(flag);
      const argv = spawnArgs.filter((_, i) => i !== at && i !== at + 1);
      expect(await run(argv, h.deps)).toBe(2);
      expect(h.err()).toContain(`Missing ${flag}`);
      expect(h.runner.calls).toEqual([]);
    },
  );

  it("names the missing value when a value flag ends the command line", async () => {
    const h = testHarness({ env: INSIDE });
    expect(await run(["session", "spawn", "--role"], h.deps)).toBe(2);
    expect(h.err()).toContain('Flag "--role" needs a value');
    expect(h.runner.calls).toEqual([]);
  });
});

describe("session spawn brief guard", () => {
  it.each(["RESULT: done", "  RESULT: blocked  ", "● RESULT: done"])(
    "rejects a brief with a line that would match the result marker (%j), telling the caller to describe it in words",
    async (line) => {
      const h = testHarness({ env: INSIDE });
      const argv = spawnArgs.map((a) =>
        a === "Do the thing." ? `Do the thing.\n${line}\nThanks.` : a,
      );
      expect(await run(argv, h.deps)).toBe(2);
      expect(h.err()).toContain("in words");
      expect(h.runner.calls).toEqual([]);
    },
  );

  it("accepts a brief that mentions the marker inside a sentence", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    const argv = spawnArgs.map((a) =>
      a === "Do the thing." ? "End with RESULT: done when finished." : a,
    );
    expect(await run(argv, h.deps)).toBe(0);
  });

  it("accepts a brief that starts with a dash", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    const argv = spawnArgs.map((a) => (a === "Do the thing." ? "--fix it" : a));
    expect(await run(argv, h.deps)).toBe(0);
  });
});

describe("session spawn failures", () => {
  it("reports a failed split with herdr's message and starts no agent", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        nameFree,
        layoutOf(),
        {
          match: (_c, a) => a[1] === "split",
          result: { code: 1, stderr: "no such pane" },
        },
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("no such pane");
    expect(herdrCalls(h).some((c) => c.includes("agent start"))).toBe(false);
  });

  it("reports an unreadable split answer", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        nameFree,
        layoutOf(),
        { match: (_c, a) => a[1] === "split", result: { stdout: "oops" } },
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("pane id");
  });

  it("names the pane left behind when the agent fails to start", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        nameFree,
        layoutOf(),
        splitReturns("w3:p9"),
        {
          match: (_c, a) => a[1] === "start",
          result: { code: 1, stderr: "agent_pane_busy" },
        },
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("agent_pane_busy");
    expect(h.err()).toContain("w3:p9");
  });
});

describe("session equalize", () => {
  it("reads the layout and reports, so closing a pane can rebalance the column", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf()],
    });
    expect(await run(["session", "equalize", "--json"], h.deps)).toBe(0);
    expect(herdrCalls(h)).toEqual(["herdr pane layout --pane w3:p1"]);
    expect(JSON.parse(h.out())).toEqual({
      status: "skipped",
      reason: expect.any(String) as unknown,
    });
  });

  it("prints a human line without --json", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf()],
    });
    await run(["session", "equalize"], h.deps);
    expect(h.out()).toContain("Skipped");
  });

  it("exits 1 naming herdr's error when equalizing fails", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        {
          match: (_c, a) => a[1] === "layout",
          result: { code: 1, stderr: "pane gone" },
        },
      ],
    });
    expect(await run(["session", "equalize"], h.deps)).toBe(1);
    expect(h.err()).toContain("pane gone");
  });

  it("refuses outside Herdr with zero herdr calls", async () => {
    const h = testHarness();
    expect(await run(["session", "equalize"], h.deps)).toBe(1);
    expect(h.err()).toContain("HERDR_ENV");
    expect(h.runner.calls).toEqual([]);
  });
});
