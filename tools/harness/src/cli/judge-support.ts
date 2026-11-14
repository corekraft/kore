import { run } from "./cli.js";
import { testHarness } from "../testing/index.js";
import type { FakeResponse } from "../testing/index.js";

/** Where the harness bundle sits in the fake checkout; the judge finds the ledger from here. */
export const REPO = "corekraft/kore";
export const BUNDLE = "file:///repo/skills/bin/harness.mjs";
export const LEDGER = "/repo/.kore/state/ledger.jsonl";
export const RUN_URL =
  "https://github.com/corekraft/kore/actions/runs/777/job/1";

export const BASE_SHA = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const HEAD_SHA = "abc1234def5678abc1234def5678abc1234def56";

export interface ManifestSides {
  mergeBase: string;
  before: string;
  after: string;
}

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
  baseSha?: string;
  /** The manifest at the merge base and at the head, for a diff that touches tools/kore/package.json. */
  manifest?: ManifestSides;
  env?: Record<string, string>;
  steps?: { name: string; conclusion: string }[];
  diff?: string;
  git?: boolean;
  /** The origin remote of the main checkout. */
  remote?: string;
  /** Answers that win over the defaults, for example a refused merge. */
  first?: FakeResponse[];
  /** Files the fake filesystem starts with, by absolute path, for example the harness config. */
  files?: Record<string, string>;
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

/** Answers the three `gh api` reads the precheck makes for a manifest diff. */
function manifestResponses(
  manifest: ManifestSides | undefined,
  headSha: string,
): FakeResponse[] {
  if (manifest === undefined) {
    return [];
  }
  const api = (args: readonly string[]) => args[0] === "api";
  return [
    {
      match: (c, a) =>
        c === "gh" && api(a) && a.some((x) => x.includes("/compare/")),
      result: { stdout: `${manifest.mergeBase}\n` },
    },
    {
      match: (c, a) =>
        c === "gh" &&
        api(a) &&
        a.at(-1) ===
          `repos/${REPO}/contents/tools/kore/package.json?ref=${manifest.mergeBase}`,
      result: { stdout: manifest.before },
    },
    {
      match: (c, a) =>
        c === "gh" &&
        api(a) &&
        a.at(-1) ===
          `repos/${REPO}/contents/tools/kore/package.json?ref=${headSha}`,
      result: { stdout: manifest.after },
    },
  ];
}

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
      match: (c, a) => c === "git" && a[0] === "remote",
      result: {
        stdout: `${s.remote ?? "https://github.com/corekraft/kore.git"}\n`,
      },
    },
    {
      match: (c, a) => c === "gh" && a[0] === "pr" && a[1] === "view",
      result: {
        stdout: JSON.stringify({
          body: s.body ?? "Safety pattern: no-behaviour-change\nIdea: #193",
          statusCheckRollup: s.rollup ?? passing,
          baseRefOid: s.baseSha ?? BASE_SHA,
          headRefOid: s.headSha ?? HEAD_SHA,
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
    ...manifestResponses(s.manifest, s.headSha ?? HEAD_SHA),
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
  const h = testHarness({
    env: s.env ?? {},
    responses,
    files: s.files ?? {},
  });
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

/** A scripts-only change to tools/kore/package.json, with the section header out of view as in PR 437. */
export const manifestDiff = [
  "diff --git a/tools/kore/package.json b/tools/kore/package.json",
  "--- a/tools/kore/package.json",
  "+++ b/tools/kore/package.json",
  "@@ -14,4 +14,4 @@",
  '     "format:check": "prettier --check src",',
  '-    "test": "vitest run --coverage",',
  '+    "test": "vitest run --coverage && npm run test:budget",',
  '     "test:coverage": "vitest run --coverage",',
].join("\n");

const manifestText = (test: string) =>
  JSON.stringify(
    {
      name: "kore",
      scripts: {
        "format:check": "prettier --check src",
        test,
        "test:coverage": "vitest run --coverage",
      },
      dependencies: { yaml: "2.0.0" },
      devDependencies: { vitest: "4.0.0" },
    },
    null,
    2,
  );

export const manifestSides: ManifestSides = {
  mergeBase: "9999999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  before: manifestText("vitest run --coverage"),
  after: manifestText("vitest run --coverage && npm run test:budget"),
};

/** The `gh api` calls the fake runner received, as argument lists. */
export const apiCalls = (h: Harness) =>
  h.runner.calls
    .filter((c) => c.command === "gh" && c.args[0] === "api")
    .map((c) => [...c.args]);
