import { harness } from "./records-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

export const REPO = "corekraft/kore";
export const DECLARED = ".github/rulesets/main.json";

/** The `main` ruleset's declared body: everything but its enforcement, which the inventory mode decides. */
export const declared = {
  name: "main",
  target: "branch",
  conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  rules: [
    { type: "deletion" },
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [{ context: "check", integration_id: 15368 }],
      },
    },
  ],
  bypass_actors: [],
};

export function inventory(mode: "audit" | "enforce"): string {
  return JSON.stringify({
    guardrails: [
      {
        rule: "main-ruleset",
        kind: "file",
        mode,
        owner: "tools/harness/src/ruleset/index.ts",
      },
    ],
  });
}

/** What GitHub returns for the live ruleset: the declared body plus fields it adds. */
export const live = (enforcement: string, change: object = {}) => ({
  id: 7,
  node_id: "RRS_x",
  source_type: "Repository",
  enforcement,
  ...declared,
  ...change,
});

const json = (value: unknown): Partial<{ stdout: string }> => ({
  stdout: JSON.stringify(value),
});

/** A repository with the declared ruleset and an inventory mode, and a runner that answers as GitHub would. */
export function rulesetRepo(
  mode: "audit" | "enforce",
  liveRuleset: object | undefined,
  extra: FakeResponse[] = [],
) {
  const h = harness({
    "docs/index.md": "# Knowledge Index\n",
    [DECLARED]: `${JSON.stringify(declared, null, 2)}\n`,
    ".claude/guardrails.yaml": inventory(mode),
  });
  const responses: FakeResponse[] = [
    ...extra,
    {
      match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets`,
      result: json(liveRuleset === undefined ? [] : [{ id: 7, name: "main" }]),
    },
    {
      match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets/7`,
      result: json(liveRuleset ?? {}),
    },
  ];
  // Rebind the runner's responses by wrapping the recording runner.
  const recorded = h.runner;
  const original = recorded.run.bind(recorded);
  recorded.run = (command, args, options) => {
    const hit = responses.find((r) => r.match(command, args));
    return original(command, args, options).then((r) => ({
      ...r,
      ...hit?.result,
    }));
  };
  return h;
}

export const sync = (...flags: string[]) => [
  "ruleset",
  "sync",
  "--repo",
  REPO,
  "--target",
  "main",
  ...flags,
];

/** The mutating gh calls: anything but a GET on the ruleset API. */
export const mutations = (h: ReturnType<typeof harness>) =>
  h.runner.calls.filter(
    (c) =>
      c.command === "gh" &&
      (c.args.includes("-X") || c.args.includes("--method")),
  );
