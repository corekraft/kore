import { run } from "./cli.js";
import { testHarness } from "./cli-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

/** Where the harness bundle sits in the fake checkout; the judge finds the ledger from here. */
export const BUNDLE = "file:///repo/skills/bin/harness.mjs";
export const LEDGER = "/repo/.kore/state/ledger.jsonl";
export const RUN_URL =
  "https://github.com/corekraft/kore/actions/runs/777/job/1";

export interface Comment {
  author?: string;
  createdAt?: string;
  body: string;
}

export interface Scenario {
  body?: string;
  rollup?: unknown[];
  comments?: Comment[];
  committedAt?: string;
  headSha?: string;
  env?: Record<string, string>;
  steps?: { name: string; conclusion: string }[];
  diff?: string;
  git?: boolean;
  /** Answers that win over the defaults, for example a refused merge. */
  first?: FakeResponse[];
}

export const passing = [
  {
    name: "check",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: RUN_URL,
  },
  {
    name: "scan",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: RUN_URL,
  },
];

export const docsDiff = [
  "diff --git a/docs/index.md b/docs/index.md",
  "--- a/docs/index.md",
  "+++ b/docs/index.md",
  "@@ -1 +1 @@",
  "+more",
].join("\n");

export const REVIEWER = "reviewer-bot";
export const REVIEW_OK: Comment = { body: "principles-review: No violations." };

export function scenario(s: Scenario = {}) {
  const responses: FakeResponse[] = [
    ...(s.first ?? []),
    {
      match: (c: string, a: readonly string[]) =>
        c === "git" && a.includes("--git-common-dir"),
      result:
        s.git === false
          ? { code: 128, stderr: "fatal: not a git repository" }
          : { stdout: "/repo/.git\n" },
    },
    {
      match: (c, a) => c === "gh" && a[0] === "pr" && a[1] === "view",
      result: {
        stdout: JSON.stringify({
          body: s.body ?? "Safety pattern: no-behaviour-change\nIdea: #193",
          statusCheckRollup: s.rollup ?? passing,
          headRefOid: s.headSha ?? "abc1234def5678abc1234def5678abc1234def56",
          commits: [
            { committedDate: "2025-12-31T00:00:00Z" },
            { committedDate: s.committedAt ?? "2026-01-01T00:00:00Z" },
          ],
          comments: (s.comments ?? [REVIEW_OK]).map((c) => ({
            body: c.body,
            author: { login: c.author ?? REVIEWER },
            createdAt: c.createdAt ?? "2026-01-02T00:00:00Z",
          })),
        }),
      },
    },
    {
      match: (c, a) => c === "gh" && a[0] === "pr" && a[1] === "diff",
      result: { stdout: s.diff ?? docsDiff },
    },
    {
      match: (c, a) => c === "gh" && a[0] === "run" && a[1] === "view",
      result: {
        stdout: JSON.stringify({
          jobs: [
            {
              name: "check",
              steps: s.steps ?? [
                { name: "Unit tests", conclusion: "success" },
                { name: "Harness tests", conclusion: "success" },
              ],
            },
          ],
        }),
      },
    },
  ];
  const h = testHarness({ env: s.env ?? {}, responses });
  h.deps.bundleUrl = BUNDLE;
  return h;
}

export type Harness = ReturnType<typeof scenario>;

export const precheck = (h: Harness, ...extra: string[]) =>
  run(
    ["judge", "precheck", "42", "--json", "--reviewer", REVIEWER, ...extra],
    h.deps,
  );

export const verbs = (h: Harness) =>
  h.runner.calls
    .filter((c) => c.command === "gh")
    .map((c) => `${c.command} ${c.args.slice(0, 2).join(" ")}`);

export const report = (h: Harness) =>
  JSON.parse(h.out()) as Record<string, unknown>;

export const kore = [
  "diff --git a/tools/kore/src/a.ts b/tools/kore/src/a.ts",
  "--- a/tools/kore/src/a.ts",
  "+++ b/tools/kore/src/a.ts",
  "@@ -1 +1 @@",
  "+x",
].join("\n");
