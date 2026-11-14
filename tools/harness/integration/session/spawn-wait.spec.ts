import { describe, expect, it } from "vitest";
import { testHarness } from "../../src/testing/index.js";
import { run } from "../../src/cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  screen,
  sequence,
  spawnArgs,
  splitReturns,
  stateFile,
} from "./spawn-support.js";

const isStart = (_c: string, a: readonly string[]) => a[1] === "start";
const base = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];
const BUSY = { code: 1, stderr: '{"error":{"code":"agent_pane_busy"}}' };

describe("session spawn busy retry", () => {
  it("retries agent_pane_busy and succeeds once the pane becomes ready within the bound", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [sequence(isStart, BUSY, BUSY, {}), ...base],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    expect(herdrCalls(h).filter((c) => c.includes("agent start"))).toHaveLength(
      3,
    );
  });

  it("fails naming the last error, the try count and the pane once every try fails", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [{ match: isStart, result: BUSY }, ...base],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("agent_pane_busy");
    expect(h.err()).toContain("after 7 tries over 60 s of waiting");
    expect(h.err()).toContain("w3:p9");
    expect(herdrCalls(h).some((c) => c.includes("agent prompt"))).toBe(false);
  });

  it("retries a start failure that is not agent_pane_busy, then starts the session", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [sequence(isStart, { code: 1, stderr: "boom" }, {}), ...base],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    expect(herdrCalls(h).filter((c) => c.includes("agent start"))).toHaveLength(
      2,
    );
  });
});

describe("session spawn model check", () => {
  it("reports verified when the pane names the requested model", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [screen("✻ Sonnet 5.5 · Claude Max"), ...base],
    });
    expect(await run([...spawnArgs, "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      modelCheck: { status: "verified" },
    });
  });

  it("fails naming both models when the pane runs another model, before sending the brief", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [screen("Opus 5.5 · Claude Max"), ...base],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("claude-sonnet-5-5");
    expect(h.err()).toContain("Opus 5.5");
    expect(h.err()).toContain("w3:p9");
    expect(herdrCalls(h).some((c) => c.includes("agent prompt"))).toBe(false);
  });

  it("reports unverified with a reason, never a silent pass, when no model name is visible", async () => {
    const h = testHarness({ env: INSIDE, responses: [screen(""), ...base] });
    expect(await run([...spawnArgs, "--json"], h.deps)).toBe(0);
    const out = JSON.parse(h.out()) as {
      modelCheck: { status: string; reason: string };
    };
    expect(out.modelCheck.status).toBe("unverified");
    expect(out.modelCheck.reason).toContain("Sonnet 5.5");
  });

  it("says unverified in the human line too", async () => {
    const h = testHarness({ env: INSIDE, responses: [screen(""), ...base] });
    await run(spawnArgs, h.deps);
    expect(h.out()).toContain("unverified");
  });

  it("reports unverified for a model ID it has no display name for", async () => {
    const h = testHarness({ env: INSIDE, responses: base });
    const argv = spawnArgs.map((a) =>
      a === "claude-sonnet-5-5" ? "claude-future-9" : a,
    );
    expect(await run([...argv, "--json"], h.deps)).toBe(0);
    const out = JSON.parse(h.out()) as { modelCheck: { reason: string } };
    expect(out.modelCheck.reason).toContain("claude-future-9");
  });
});

describe("session spawn records and waits", () => {
  it("records the created pane, its caller and model for later wait and close", async () => {
    const h = testHarness({ env: INSIDE, responses: base });
    await run(spawnArgs, h.deps);
    const record = JSON.parse(
      h.files.get(stateFile("image-trust-writer")) ?? "null",
    ) as unknown;
    expect(record).toMatchObject({
      name: "image-trust-writer",
      paneId: "w3:p9",
      callerPane: "w3:p1",
      model: "claude-sonnet-5-5",
    });
  });

  it("without --no-wait waits for the anchored result and returns it as JSON", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [screen("Done.\nRESULT: done\n"), ...base],
    });
    const argv = spawnArgs.filter((a) => a !== "--no-wait");
    expect(await run([...argv, "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      name: "image-trust-writer",
      paneId: "w3:p9",
      model: "claude-sonnet-5-5",
      outcome: "done",
      summary: "pane w3:p9",
    });
  });

  it("with --no-wait does not read the pane for a result", async () => {
    const h = testHarness({ env: INSIDE, responses: base });
    await run(spawnArgs, h.deps);
    expect(herdrCalls(h).some((c) => c.includes("pane read"))).toBe(false);
  });
});

describe("session spawn record safety", () => {
  const live = {
    name: "image-trust-writer",
    paneId: "w3:p4",
    callerPane: "w3:p1",
    model: "claude-sonnet-5-5",
  };

  it("refuses a name whose record is not closed, before splitting any pane", async () => {
    const h = testHarness({
      env: INSIDE,
      files: { [stateFile("image-trust-writer")]: JSON.stringify(live) },
      responses: base,
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("session close");
    expect(herdrCalls(h).some((c) => c.includes("pane split"))).toBe(false);
  });

  it("reuses the name of a closed session", async () => {
    const closed = { ...live, closedAt: "2026-01-01T00:00:00.000Z" };
    const h = testHarness({
      env: INSIDE,
      files: { [stateFile("image-trust-writer")]: JSON.stringify(closed) },
      responses: base,
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    const stored = JSON.parse(
      h.files.get(stateFile("image-trust-writer")) ?? "null",
    ) as { paneId: string };
    expect(stored.paneId).toBe("w3:p9");
  });

  it("never overwrites a record that appeared after the early check", async () => {
    const h = testHarness({ env: INSIDE, responses: base });
    const create = h.deps.fs.createFile.bind(h.deps.fs);
    h.deps.fs.createFile = async (path, content) => {
      h.files.set(path, JSON.stringify(live));
      return await create(path, content);
    };
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toContain("w3:p9");
    expect(h.err()).toContain("herdr pane close w3:p9");
    const stored = JSON.parse(
      h.files.get(stateFile("image-trust-writer")) ?? "null",
    ) as { paneId: string };
    expect(stored.paneId).toBe("w3:p4");
  });
});

describe("session usage", () => {
  it("documents --no-wait plus a background `session wait` as the way to run sessions in parallel", async () => {
    const h = testHarness();
    await run(["--help"], h.deps);
    expect(h.out()).toMatch(/session spawn .*--no-wait.*session wait/s);
    expect(h.out()).toContain("session close");
  });
});
