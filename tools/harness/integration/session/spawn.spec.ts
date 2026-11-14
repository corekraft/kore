import { describe, expect, it } from "vitest";
import { testHarness } from "../../src/testing/index.js";
import { run } from "../../src/cli/index.js";
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

describe("session spawn placement", () => {
  it("splits the caller right for the first spawned pane, without stealing focus", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    const split = herdrCalls(h).find((c) => c.includes("pane split"));
    expect(split).toBe(
      "herdr pane split --current --direction right --cwd /work/tree --no-focus --env KORE_AGENT=image-trust-writer",
    );
  });

  it("splits the bottom-most spawned pane down for later panes", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        nameFree,
        layoutOf(pane("w3:p6", 100, 0), pane("w3:p7", 100, 50)),
        splitReturns("w3:p9"),
      ],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    const split = herdrCalls(h).find((c) => c.includes("pane split"));
    expect(split).toBe(
      "herdr pane split w3:p7 --direction down --cwd /work/tree --no-focus --env KORE_AGENT=image-trust-writer",
    );
  });

  it("equalizes the column after the split, before launching the agent", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    await run(spawnArgs, h.deps);
    const kinds = herdrCalls(h).map((c) => c.split(" ").slice(1, 3).join(" "));
    const split = kinds.indexOf("pane split");
    expect(kinds[split + 1]).toBe("pane layout");
    expect(kinds.indexOf("agent start")).toBeGreaterThan(split + 1);
  });
});

describe("session spawn launch", () => {
  it("starts claude with the role, model and effort in the new pane under the given name", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    await run(spawnArgs, h.deps);
    expect(herdrCalls(h)).toContain(
      "herdr agent start image-trust-writer --kind claude --pane w3:p9 -- --agent reader --model claude-sonnet-5-5 --effort high",
    );
  });

  it("prompts with a brief carrying the fresh caller pane id, the name and the exact broadcast", async () => {
    const h = testHarness({
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p42" },
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    await run(spawnArgs, h.deps);
    const prompt = h.runner.calls.find((c) => c.args[1] === "prompt");
    expect(prompt?.args.slice(0, 3)).toEqual([
      "agent",
      "prompt",
      "image-trust-writer",
    ]);
    const brief = prompt?.args[3] ?? "";
    expect(brief).toContain("Do the thing.");
    expect(brief).toContain("broadcast to pane `w3:p42`");
    expect(brief).toContain("image-trust-writer");
    expect(brief).toContain(
      "node skills/bin/harness.mjs session notify w3:p42 --outcome <done|blocked>",
    );
    expect(prompt?.args.slice(4)).toEqual([
      "--wait",
      "--until",
      "working",
      "--timeout",
      "5000",
    ]);
  });

  it("reports the session name, pane id and model as JSON", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    expect(await run([...spawnArgs, "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      name: "image-trust-writer",
      paneId: "w3:p9",
      model: "claude-sonnet-5-5",
      role: "reader",
      effort: "high",
      modelCheck: {
        status: "unverified",
        reason: expect.stringContaining("Sonnet 5.5") as unknown,
      },
    });
  });

  it("prints a human line without --json", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    await run(spawnArgs, h.deps);
    expect(h.out()).toContain("image-trust-writer");
    expect(h.out()).toContain("w3:p9");
  });
});

describe("session spawn ledger", () => {
  const LEDGER = "/main/.kore/state/ledger.jsonl";

  it("records a session.launch event with the role and the model tier, from the spawn itself", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    await run(spawnArgs, h.deps);
    const [line] = (h.files.get(LEDGER) ?? "").split("\n").filter(Boolean);
    expect(JSON.parse(line ?? "{}")).toMatchObject({
      source: "herdr",
      kind: "session.launch",
      pane: "w3:p9",
      agent: "image-trust-writer",
      role: "reader",
      tier: "claude-sonnet-5-5",
    });
  });

  it("does not record a launch when the spawn fails before the agent starts", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        gitCommon,
        nameFree,
        layoutOf(),
        {
          match: (_c, a) => a[1] === "split",
          result: { code: 1, stderr: "no" },
        },
      ],
    });
    expect(await run(spawnArgs, h.deps)).not.toBe(0);
    expect(h.files.get(LEDGER)).toBeUndefined();
  });
});
