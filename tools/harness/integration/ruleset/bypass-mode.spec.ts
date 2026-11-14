import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  DELETION,
  declared,
  liveMain,
  mutations,
  rulesetRepo,
  sync,
} from "../../src/testing/index.js";

const actor = (bypass_mode?: string, actor_id = 1) => ({
  actor_id,
  actor_type: "User",
  ...(bypass_mode === undefined ? {} : { bypass_mode }),
});

describe("harness ruleset sync lets a narrowed bypass mode through", () => {
  it("does not refuse always to pull_request, and sends nothing on a dry run", async () => {
    const h = rulesetRepo({
      declared: { ...declared, bypass_actors: [actor("pull_request")] },
      main: liveMain([DELETION], { bypass_actors: [actor("always")] }),
    });
    await run([...sync("--dry-run"), "--json"], h.deps);
    expect(JSON.parse(h.out())).toMatchObject({
      refused: false,
      main: { weakened: [] },
    });
    expect(mutations(h)).toEqual([]);
  });

  it("goes ahead with --confirm on always to pull_request, no --allow-removal needed", async () => {
    const h = rulesetRepo({
      declared: { ...declared, bypass_actors: [actor("pull_request")] },
      main: liveMain([DELETION], { bypass_actors: [actor("always")] }),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(mutations(h)).not.toEqual([]);
  });

  it("refuses pull_request to an unknown mode without --allow-removal", async () => {
    const h = rulesetRepo({
      declared: { ...declared, bypass_actors: [actor("exempt")] },
      main: liveMain([DELETION], { bypass_actors: [actor("pull_request")] }),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/bypass_mode widens/);
    expect(mutations(h)).toEqual([]);
  });

  it("refuses pull_request to always without --allow-removal", async () => {
    const h = rulesetRepo({
      declared: { ...declared, bypass_actors: [actor("always")] },
      main: liveMain([DELETION], { bypass_actors: [actor("pull_request")] }),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/bypass_mode widens/);
    expect(mutations(h)).toEqual([]);
  });
});
