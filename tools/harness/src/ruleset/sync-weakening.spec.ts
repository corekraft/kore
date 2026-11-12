import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  DELETION,
  checksRule,
  declared,
  liveMain,
  mutations,
  prRule,
  rulesetRepo,
  sent,
  sync,
} from "../testing/ruleset-support.js";

const PR = {
  required_approving_review_count: 1,
  require_code_owner_review: true,
  allowed_merge_methods: ["squash"],
};
const ACTOR = { actor_id: 1, actor_type: "User", bypass_mode: "always" };
const rules = (pr: object, checks = checksRule("check", "scan")) => [
  DELETION,
  prRule(pr),
  checks,
];
const file = (change: object) => ({
  ...declared,
  bypass_actors: [ACTOR],
  ...change,
});

/** Live main is the strong version; the declared file is weaker in one way. */
const WEAKER: [string, object, object, RegExp][] = [
  [
    "a dropped required check",
    file({ rules: rules(PR, checksRule("check")) }),
    liveMain(rules(PR), { bypass_actors: [ACTOR] }),
    /required_status_checks.*loses an entry/,
  ],
  [
    "a lower review count",
    file({ rules: rules({ ...PR, required_approving_review_count: 0 }) }),
    liveMain(rules(PR), { bypass_actors: [ACTOR] }),
    /required_approving_review_count is lowered/,
  ],
  [
    "code-owner review turned off",
    file({ rules: rules({ ...PR, require_code_owner_review: false }) }),
    liveMain(rules(PR), { bypass_actors: [ACTOR] }),
    /require_code_owner_review changes/,
  ],
  [
    "more merge methods",
    file({
      rules: rules({ ...PR, allowed_merge_methods: ["squash", "merge"] }),
    }),
    liveMain(rules(PR), { bypass_actors: [ACTOR] }),
    /allowed_merge_methods gains an entry/,
  ],
  [
    "a new bypass actor",
    file({
      rules: rules(PR),
      bypass_actors: [
        ACTOR,
        { actor_id: 2, actor_type: "Team", bypass_mode: "always" },
      ],
    }),
    liveMain(rules(PR), { bypass_actors: [ACTOR] }),
    /bypass_actors gains an actor/,
  ],
  [
    "changed conditions",
    file({
      rules: rules(PR),
      conditions: { ref_name: { exclude: [], include: ["refs/heads/other"] } },
    }),
    liveMain(rules(PR), { bypass_actors: [ACTOR] }),
    /conditions change/,
  ],
];

describe("harness ruleset sync never loosens a live rule on --confirm alone", () => {
  it.each(WEAKER)(
    "refuses %s, names it and sends nothing",
    async (_n, want, live, named) => {
      const h = rulesetRepo({ declared: want, main: live });
      expect(await run(sync("--confirm"), h.deps)).toBe(1);
      expect(h.err()).toMatch(named);
      expect(h.err()).toMatch(/--allow-removal/);
      expect(mutations(h)).toEqual([]);
    },
  );

  it.each(WEAKER)(
    "lists %s in the dry run and the json",
    async (_n, want, live, named) => {
      const text = rulesetRepo({ declared: want, main: live });
      expect(await run(sync("--dry-run"), text.deps)).toBe(0);
      expect(text.out()).toMatch(named);
      expect(text.out()).toMatch(/--allow-removal/);
      const j = rulesetRepo({ declared: want, main: live });
      await run([...sync("--dry-run"), "--json"], j.deps);
      const report = JSON.parse(j.out());
      expect(report.refused).toBe(true);
      expect(report.main.weakened.join("\n")).toMatch(named);
      expect(mutations(text).concat(mutations(j))).toEqual([]);
    },
  );

  it("goes ahead with --allow-removal, still staging the weaker rule in the candidate first", async () => {
    for (const [, want, live] of WEAKER.slice(0, 1)) {
      const h = rulesetRepo({ declared: want, main: live });
      expect(await run(sync("--confirm", "--allow-removal"), h.deps)).toBe(0);
      expect(sent(h).map(([method, id]) => `${method} ${id}`)).toEqual([
        "POST new",
      ]);
    }
  });

  it("does not call a tightened rule a weakening", async () => {
    const live = liveMain(rules(PR, checksRule("check")), {
      bypass_actors: [ACTOR],
    });
    const h = rulesetRepo({ declared: file({ rules: rules(PR) }), main: live });
    await run([...sync("--dry-run"), "--json"], h.deps);
    expect(JSON.parse(h.out())).toMatchObject({
      refused: false,
      main: { weakened: [] },
    });
  });

  it("refuses a file that drops a parameter live has, though no plan would change", async () => {
    const live = liveMain(
      rules({ ...PR, dismiss_stale_reviews_on_push: true }),
      {
        bypass_actors: [ACTOR],
      },
    );
    const h = rulesetRepo({ declared: file({ rules: rules(PR) }), main: live });
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/dismiss_stale_reviews_on_push is removed/);
    expect(mutations(h)).toEqual([]);
  });
});
