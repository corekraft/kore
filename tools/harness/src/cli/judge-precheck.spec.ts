import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { testHarness } from "./cli-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

const LEDGER = "/repo/.kore/state/ledger.jsonl";
const RUN_URL = "https://github.com/corekraft/kore/actions/runs/777/job/1";

interface Scenario {
  body?: string;
  rollup?: unknown[];
  comments?: string[];
  steps?: { name: string; conclusion: string }[];
  diff?: string;
  git?: boolean;
}

const passing = [
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

const docsDiff = [
  "diff --git a/docs/index.md b/docs/index.md",
  "--- a/docs/index.md",
  "+++ b/docs/index.md",
  "@@ -1 +1 @@",
  "+more",
].join("\n");

function scenario(s: Scenario = {}) {
  const responses: FakeResponse[] = [
    ...(s.git === false
      ? [{ match: (c: string) => c === "git", result: { code: 128 } }]
      : []),
    {
      match: (c, a) => c === "gh" && a[0] === "pr" && a[1] === "view",
      result: {
        stdout: JSON.stringify({
          body: s.body ?? "Safety pattern: no-behaviour-change\nIdea: #193",
          statusCheckRollup: s.rollup ?? passing,
          comments: (s.comments ?? ["principles-review: No violations."]).map(
            (body) => ({ body }),
          ),
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
                { name: "Harness tests", conclusion: "success" },
              ],
            },
          ],
        }),
      },
    },
  ];
  return testHarness({
    env: s.git === false ? {} : { KORE_ROOT: "/repo" },
    responses,
  });
}

const precheck = (h: ReturnType<typeof scenario>, ...extra: string[]) =>
  run(["judge", "precheck", "42", "--json", ...extra], h.deps);

const verbs = (h: ReturnType<typeof scenario>) =>
  h.runner.calls.map((c) => `${c.command} ${c.args.slice(0, 2).join(" ")}`);

describe("judge precheck", () => {
  it("passes a declared pattern with passing checks and reports the hints", async () => {
    const h = scenario();
    expect(await precheck(h)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      pr: 42,
      ok: true,
      pattern: "no-behaviour-change",
      idea: "#193",
      checks: {
        ci: { result: "pass" },
        scan: { result: "pass" },
        coverage: { result: "pass" },
        principlesReview: { result: "pass" },
      },
      hints: { noBehaviouralDiff: true },
    });
  });

  it.each([
    ["missing", "Closes #1"],
    [
      "duplicate",
      "Safety pattern: feature-flagged\nSafety pattern: dark-launched",
    ],
    ["unknown", "Safety pattern: yolo"],
  ])("fails a %s pattern before any diff is read", async (_, body) => {
    const h = scenario({ body });
    expect(await precheck(h)).toBe(1);
    const report = JSON.parse(h.out()) as Record<string, unknown>;
    expect(report).toMatchObject({ ok: false, declaration: { ok: false } });
    expect(report).not.toHaveProperty("hints");
    expect(verbs(h)).toEqual(["gh pr view"]);
  });

  it("fails and names a failing CI check", async () => {
    const h = scenario({
      rollup: [
        {
          name: "check",
          status: "COMPLETED",
          conclusion: "FAILURE",
          detailsUrl: RUN_URL,
        },
        passing[1],
      ],
    });
    expect(await precheck(h)).toBe(1);
    expect(JSON.parse(h.out())).toMatchObject({
      ok: false,
      checks: { ci: { result: "fail" }, scan: { result: "pass" } },
    });
  });
});

describe("judge precheck check results", () => {
  it("fails a failing scan", async () => {
    const h = scenario({
      rollup: [
        passing[0],
        {
          name: "scan",
          status: "COMPLETED",
          conclusion: "FAILURE",
          detailsUrl: RUN_URL,
        },
      ],
    });
    expect(await precheck(h)).toBe(1);
    expect(JSON.parse(h.out())).toMatchObject({
      checks: { scan: { result: "fail" } },
    });
  });

  it("fails when the coverage step failed even though other steps passed", async () => {
    const h = scenario({
      steps: [{ name: "Harness tests", conclusion: "failure" }],
    });
    expect(await precheck(h)).toBe(1);
    expect(JSON.parse(h.out())).toMatchObject({
      checks: { coverage: { result: "fail" } },
    });
  });

  it("reports a check still running as pending, not passing", async () => {
    const h = scenario({
      rollup: [
        {
          name: "check",
          status: "IN_PROGRESS",
          conclusion: "",
          detailsUrl: RUN_URL,
        },
        passing[1],
      ],
    });
    expect(await precheck(h)).toBe(1);
    expect(JSON.parse(h.out())).toMatchObject({
      checks: { ci: { result: "pending" } },
    });
  });

  it("fails on principles-review violations and on a missing review", async () => {
    const found = scenario({ comments: ["principles-review: 2 violations"] });
    expect(await precheck(found)).toBe(1);
    expect(JSON.parse(found.out())).toMatchObject({
      checks: { principlesReview: { result: "fail" } },
    });
    const none = scenario({ comments: ["looks good"] });
    expect(await precheck(none)).toBe(1);
    expect(JSON.parse(none.out())).toMatchObject({
      checks: { principlesReview: { result: "missing" } },
    });
  });

  it("reads the newest principles-review comment", async () => {
    const h = scenario({
      comments: [
        "principles-review: 1 violation",
        "principles-review: No violations.",
      ],
    });
    expect(await precheck(h)).toBe(0);
  });
});

describe("judge precheck recording and usage", () => {
  it("never mutates: only read-only gh commands run", async () => {
    const h = scenario();
    await precheck(h);
    expect(verbs(h)).toEqual(["gh pr view", "gh pr diff", "gh run view"]);
  });

  it("records a precheck ledger event with the pattern and verdict", async () => {
    const h = scenario();
    await precheck(h);
    const event = JSON.parse(h.files.get(LEDGER)?.trim() ?? "{}") as object;
    expect(event).toMatchObject({
      kind: "precheck",
      source: "github",
      number: 42,
      label: "no-behaviour-change:pass",
      idea: "#193",
    });
  });

  it("records a failed precheck for an undeclared pattern", async () => {
    const h = scenario({ body: "nothing" });
    await precheck(h);
    expect(h.files.get(LEDGER)).toContain('"label":"none:fail"');
  });

  it("prints a readable summary without --json", async () => {
    const h = scenario();
    expect(await run(["judge", "precheck", "42"], h.deps)).toBe(0);
    expect(h.out()).toContain("no-behaviour-change");
    expect(h.out()).toContain("ci: pass");
  });

  it("asks for a PR number when none is given", async () => {
    const h = scenario();
    expect(await run(["judge", "precheck"], h.deps)).toBe(1);
    expect(h.err()).toContain("harness judge precheck <pr>");
    expect(h.runner.calls).toHaveLength(0);
  });

  it("names the gh failure when the PR cannot be read", async () => {
    const h = testHarness({
      env: { KORE_ROOT: "/repo" },
      responses: [{ match: () => true, result: { code: 1, stderr: "no PR" } }],
    });
    expect(await run(["judge", "precheck", "42"], h.deps)).toBe(1);
    expect(h.err()).toContain("gh auth status");
    expect(h.files.has(LEDGER)).toBe(false);
  });
});

describe("judge precheck reruns and ledger failures", () => {
  it("adds no second ledger event for the same verdict on the same PR", async () => {
    const h = scenario();
    await precheck(h);
    await precheck(h);
    expect(h.files.get(LEDGER)?.trim().split("\n")).toHaveLength(1);
  });

  it("still prints the report when no ledger can be opened", async () => {
    const h = scenario({ git: false });
    const code = await precheck(h);
    expect(JSON.parse(h.out().split("\n")[0] ?? "")).toMatchObject({ pr: 42 });
    expect(code).toBe(1);
  });
});
