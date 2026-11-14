import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  DELETION,
  declared,
  liveMain,
  mutations,
  rulesetRepo,
  sync,
} from "../testing/index.js";
import { weakenings } from "./weaken.js";

const actor = (bypass_mode?: string, actor_id = 1) => ({
  actor_id,
  actor_type: "User",
  ...(bypass_mode === undefined ? {} : { bypass_mode }),
});
const body = (...bypass_actors: object[]) => ({
  rules: [DELETION],
  bypass_actors,
});

describe("a bypass actor is matched by type and id, and only a wider mode weakens it", () => {
  it.each([
    ["always to pull_request", actor("always"), actor("pull_request"), 0],
    ["pull_request to always", actor("pull_request"), actor("always"), 1],
    ["unchanged", actor("always"), actor("always"), 0],
    ["no mode (always) to always", actor(), actor("always"), 0],
    ["pull_request to no mode (always)", actor("pull_request"), actor(), 1],
  ])("%s weakens %i times", (_n, was, now, count) => {
    expect(weakenings(body(was), body(now)).weaker).toHaveLength(count);
  });

  it("counts an unknown mode as wider than pull_request", () => {
    expect(
      weakenings(body(actor("pull_request")), body(actor("exempt"))).weaker,
    ).toHaveLength(1);
  });

  it("names a widened mode, not a new actor", () => {
    const { weaker } = weakenings(
      body(actor("pull_request")),
      body(actor("always")),
    );
    expect(weaker.join()).toMatch(/bypass_mode widens/);
    expect(weaker.join()).not.toMatch(/gains an actor/);
  });

  it("counts a new actor as a weakening", () => {
    const { weaker } = weakenings(
      body(actor("always")),
      body(actor("always"), actor("pull_request", 2)),
    );
    expect(weaker.join()).toMatch(/gains an actor/);
  });

  it("counts an actor of another type with the same id as new", () => {
    const team = { ...actor("always"), actor_type: "Team" };
    expect(weakenings(body(actor("always")), body(team)).weaker.join()).toMatch(
      /gains an actor/,
    );
  });
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
