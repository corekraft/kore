import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  spawnArgs,
  splitReturns,
} from "./spawn-support.js";

const spawned = () =>
  testHarness({
    env: INSIDE,
    responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
  });

const splitOf = (h: ReturnType<typeof spawned>) =>
  herdrCalls(h).find((c) => c.includes("pane split"));

describe("session spawn stamps what the ledger attributes by", () => {
  it("puts the idea and the session name into the pane's environment", async () => {
    const h = spawned();
    expect(await run([...spawnArgs, "--idea", "338"], h.deps)).toBe(0);
    expect(splitOf(h)).toMatch(/ --env KORE_IDEA=#338( |$)/);
    expect(splitOf(h)).toMatch(/ --env KORE_AGENT=image-trust-writer( |$)/);
  });

  it("accepts the idea as #n too", async () => {
    const h = spawned();
    await run([...spawnArgs, "--idea", "#338"], h.deps);
    expect(splitOf(h)).toMatch(/ --env KORE_IDEA=#338( |$)/);
  });

  it("stamps no idea when none is given, but still the session name", async () => {
    const h = spawned();
    await run(spawnArgs, h.deps);
    expect(splitOf(h)).not.toMatch(/KORE_IDEA/);
    expect(splitOf(h)).toMatch(/KORE_AGENT=image-trust-writer/);
  });

  it("refuses an idea that is not an issue number before any pane is split", async () => {
    const h = spawned();
    const code = await run([...spawnArgs, "--idea", "soon"], h.deps);
    expect(code).not.toBe(0);
    expect(h.err()).toMatch(/--idea "soon".*issue number/);
    expect(splitOf(h)).toBeUndefined();
  });
});
