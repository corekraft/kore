import { describe, expect, it } from "vitest";
import { declaredFields, weaker, weakenings } from "./weaken.js";

const DELETION = { type: "deletion" };
const PR = {
  type: "pull_request",
  parameters: {
    required_approving_review_count: 1,
    allowed_merge_methods: ["squash"],
  },
};

describe("weaker names where a value got weaker, and not where it got stricter", () => {
  it("names a list that loses an entry", () => {
    expect(weaker(["a", "b"], ["a"], "p")).toEqual(["p loses an entry"]);
  });

  it("does not name a list that gains an entry", () => {
    expect(weaker(["a"], ["a", "b"], "p")).toEqual([]);
  });

  it("names a merge-method list that gains an entry, since growing it loosens main", () => {
    expect(
      weaker(
        ["squash"],
        ["squash", "merge"],
        "pull_request.allowed_merge_methods",
      ),
    ).toEqual(["pull_request.allowed_merge_methods gains an entry"]);
  });

  it("does not name a merge-method list that loses an entry", () => {
    expect(
      weaker(
        ["squash", "merge"],
        ["squash"],
        "pull_request.allowed_merge_methods",
      ),
    ).toEqual([]);
  });

  it("names a number that is lowered, not one that is raised", () => {
    expect(weaker(2, 1, "p")).toEqual(["p is lowered"]);
    expect(weaker(1, 2, "p")).toEqual([]);
  });

  it("names a boolean or string that changes, since it cannot be told stricter", () => {
    expect(weaker(true, false, "p")).toEqual(["p changes"]);
    expect(weaker("a", "b", "p")).toEqual(["p changes"]);
    expect(weaker(true, true, "p")).toEqual([]);
  });

  it("names a key that the new value dropped, and recurses into the keys it kept", () => {
    expect(weaker({ a: 1, b: { c: 2 } }, { b: { c: 1 } }, "p")).toEqual([
      "p.a is removed",
      "p.b.c is lowered",
    ]);
  });

  it("names every entry of a list that is now missing", () => {
    expect(weaker(["a", "b"], undefined, "p")).toEqual([
      "p loses an entry",
      "p loses an entry",
    ]);
  });
});

describe("declaredFields keeps the fields a repository declares", () => {
  it("drops the fields GitHub adds to a live ruleset", () => {
    const live = {
      id: 7,
      node_id: "RRS_x",
      name: "main",
      target: "branch",
      enforcement: "active",
      conditions: {},
      rules: [DELETION],
      bypass_actors: [],
      created_at: "2026-01-01",
    };
    expect(declaredFields(live)).toEqual({
      name: "main",
      target: "branch",
      enforcement: "active",
      conditions: {},
      rules: [DELETION],
      bypass_actors: [],
    });
  });
});

describe("weakenings compares a ruleset body with the one it replaces", () => {
  it("reports a rule type the new body drops as removed, not as weaker", () => {
    expect(
      weakenings({ rules: [DELETION, PR] }, { rules: [DELETION] }),
    ).toEqual({
      removed: ["pull_request"],
      weaker: [],
    });
  });

  it("names a parameter that got weaker, by rule type and parameter", () => {
    const after = {
      rules: [
        DELETION,
        {
          ...PR,
          parameters: { ...PR.parameters, required_approving_review_count: 0 },
        },
      ],
    };
    expect(weakenings({ rules: [DELETION, PR] }, after).weaker).toEqual([
      "pull_request.required_approving_review_count is lowered",
    ]);
  });

  it("names changed conditions and a changed target", () => {
    const previous = { target: "branch", conditions: { a: 1 }, rules: [] };
    expect(
      weakenings(previous, { target: "tag", conditions: { a: 2 }, rules: [] })
        .weaker,
    ).toEqual(["conditions change", "target changes"]);
  });

  it("reports nothing when the new body is as strict as the old", () => {
    const body = { target: "branch", conditions: {}, rules: [DELETION, PR] };
    expect(weakenings(body, { ...body })).toEqual({ removed: [], weaker: [] });
  });

  it("does not call a tightened rule a weakening", () => {
    const tighter = {
      ...PR,
      parameters: { ...PR.parameters, required_approving_review_count: 2 },
    };
    expect(weakenings({ rules: [PR] }, { rules: [tighter] }).weaker).toEqual(
      [],
    );
  });
});

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
    {
      name: "always to pull_request",
      was: actor("always"),
      now: actor("pull_request"),
      count: 0,
    },
    {
      name: "pull_request to always",
      was: actor("pull_request"),
      now: actor("always"),
      count: 1,
    },
    { name: "unchanged", was: actor("always"), now: actor("always"), count: 0 },
    {
      name: "no mode (always) to always",
      was: actor(),
      now: actor("always"),
      count: 0,
    },
    {
      name: "pull_request to no mode (always)",
      was: actor("pull_request"),
      now: actor(),
      count: 1,
    },
  ])("$name weakens $count times", ({ was, now, count }) => {
    expect(weakenings(body(was), body(now)).weaker).toHaveLength(count);
  });

  it("counts an unknown mode as wider than pull_request", () => {
    expect(
      weakenings(body(actor("pull_request")), body(actor("exempt"))).weaker,
    ).toHaveLength(1);
  });

  it("names a widened mode, not a new actor", () => {
    const { weaker: named } = weakenings(
      body(actor("pull_request")),
      body(actor("always")),
    );
    expect(named.join()).toMatch(/bypass_mode widens/);
    expect(named.join()).not.toMatch(/gains an actor/);
  });

  it("counts a new actor as a weakening", () => {
    const { weaker: named } = weakenings(
      body(actor("always")),
      body(actor("always"), actor("pull_request", 2)),
    );
    expect(named.join()).toMatch(/gains an actor/);
  });

  it("counts an actor of another type with the same id as new", () => {
    const team = { ...actor("always"), actor_type: "Team" };
    expect(weakenings(body(actor("always")), body(team)).weaker.join()).toMatch(
      /gains an actor/,
    );
  });
});
