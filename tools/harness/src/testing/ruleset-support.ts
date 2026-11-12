import { harness } from "./records-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

export const REPO = "corekraft/kore";
export const DECLARED = ".github/rulesets/main.json";
export const CANDIDATE = "main-candidate";
export const LOCK = ".kore/state/locks/ruleset-corekraft-kore.lock";

/** A required_status_checks rule that requires each named check. */
export const checksRule = (...contexts: string[]) => ({
  type: "required_status_checks",
  parameters: {
    required_status_checks: contexts.map((context) => ({
      context,
      integration_id: 15368,
    })),
  },
});

export const prRule = (parameters: object) => ({
  type: "pull_request",
  parameters,
});

const CHECKS = checksRule("check", "scan");
const DELETION = { type: "deletion" };

/** The declared ruleset: every rule main should have, whatever its mode. */
export const declared = {
  name: "main",
  target: "branch",
  conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  rules: [DELETION, CHECKS],
  bypass_actors: [],
};

export type Mode = "audit" | "enforce";
export interface Modes {
  deletion?: Mode;
  checks?: Mode;
  pullRequest?: Mode;
}

/** An inventory with one entry per declared rule; every rule enforces unless told otherwise. */
export function inventory({
  deletion = "enforce",
  checks = "enforce",
  pullRequest = "enforce",
}: Modes) {
  const entry = (rule: string, mode: Mode) => ({
    rule,
    kind: "ruleset",
    mode,
    owner: "tools/harness/src/ruleset/index.ts",
  });
  return JSON.stringify({
    guardrails: [
      entry("main-ruleset-deletion", deletion),
      entry("main-ruleset-pull-request", pullRequest),
      entry("main-ruleset-required-status-checks", checks),
    ],
  });
}

/** What GitHub returns for live main: the declared body plus fields it adds. */
export const liveMain = (rules: object[] = declared.rules, change = {}) => ({
  id: 7,
  node_id: "RRS_x",
  source_type: "Repository",
  ...declared,
  enforcement: "active",
  rules,
  ...change,
});

export const liveCandidate = (rules: object[]) => ({
  id: 8,
  ...declared,
  name: CANDIDATE,
  enforcement: "evaluate",
  rules,
});

/** The body `sync` should send for a ruleset of the given name. */
export const body = (name: string, enforcement: string, rules: object[]) => ({
  ...declared,
  name,
  enforcement,
  rules,
});

export { CHECKS, DELETION };

const stdout = (value: unknown) => ({ stdout: JSON.stringify(value) });
const is = (args: readonly string[], path: string) =>
  args.join(" ") === `api ${path}`;

export interface Scene {
  /** Replaces the declared ruleset file. */
  declared?: object;
  modes?: Modes;
  main?: object | undefined;
  candidate?: object | undefined;
  extra?: FakeResponse[];
}

/** A repository with the declared ruleset, plus a runner that answers as GitHub would. */
export function rulesetRepo({
  declared: file = declared,
  modes = {},
  main,
  candidate,
  extra = [],
}: Scene) {
  const h = harness({
    "docs/index.md": "# Knowledge Index\n",
    [DECLARED]: `${JSON.stringify(file, null, 2)}\n`,
    ".claude/guardrails.yaml": inventory(modes),
  });
  const listing = [
    ...(main === undefined ? [] : [{ id: 7, name: "main" }]),
    ...(candidate === undefined ? [] : [{ id: 8, name: CANDIDATE }]),
  ];
  const responses: FakeResponse[] = [
    ...extra,
    {
      match: (_c, a) => is(a, `repos/${REPO}/rulesets`),
      result: stdout(listing),
    },
    {
      match: (_c, a) => is(a, `repos/${REPO}/rulesets/7`),
      result: stdout(main ?? {}),
    },
    {
      match: (_c, a) => is(a, `repos/${REPO}/rulesets/8`),
      result: stdout(candidate ?? {}),
    },
  ];
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

const WRITE_FLAGS = [
  "-X",
  "--method",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "--input",
];

/** The mutating gh calls: any that names a method, a field or an input body. */
export const mutations = (h: ReturnType<typeof harness>) =>
  h.runner.calls.filter(
    (c) => c.command === "gh" && c.args.some((a) => WRITE_FLAGS.includes(a)),
  );

/** One mutation as [method, ruleset id or "new", parsed body]. */
export const sent = (h: ReturnType<typeof harness>) =>
  mutations(h).map((c): [string, string, Record<string, unknown>] => [
    c.args[c.args.indexOf("-X") + 1] ?? "",
    c.args.at(-3)?.split("/").at(-1) === "rulesets"
      ? "new"
      : (c.args.at(-3)?.split("/").at(-1) ?? ""),
    JSON.parse(c.options?.input ?? "{}") as Record<string, unknown>,
  ]);
