import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  LEDGER,
  REPO,
  REVIEWER,
  kore,
  passing,
  scenario,
  type Harness,
  type Scenario,
} from "./judge-support.js";

const merge = (h: Harness, ...extra: string[]) =>
  run(
    ["judge", "merge", "42", "--json", "--reviewer", REVIEWER, ...extra],
    h.deps,
  );

const ghCalls = (h: Harness) =>
  h.runner.calls.filter((c) => c.command === "gh").map((c) => c.args.join(" "));
const merges = (h: Harness) =>
  ghCalls(h).filter((c) => c.startsWith("pr merge"));
const events = (h: Harness) =>
  (h.files.get(LEDGER) ?? "")
    .trim()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

const HEAD = "abc1234def5678abc1234def5678abc1234def56";

describe("judge merge squash-merges only when the precheck passes", () => {
  it("squash-merges the verified head commit of the named repository when every check passes", async () => {
    const h = scenario();
    expect(await merge(h)).toBe(0);
    expect(merges(h)).toEqual([
      `pr merge 42 --repo ${REPO} --squash --match-head-commit ${HEAD}`,
    ]);
    expect(JSON.parse(h.out())).toMatchObject({ pr: 42, merged: true });
  });

  it("uses no other strategy: the one merge call is squash alone, and a strategy flag is refused", async () => {
    const h = scenario();
    expect(await merge(h)).toBe(0);
    const [call] = merges(h);
    expect(merges(h)).toHaveLength(1);
    expect(call).toContain("--squash");
    expect(call).not.toMatch(/--(merge|rebase|auto|admin|delete-branch)\b/);
    const refused = scenario();
    expect(await merge(refused, "--auto")).toBe(2);
    expect(merges(refused)).toEqual([]);
  });

  it("names the repository on every gh call, never GH_REPO or the working directory", async () => {
    const h = scenario({ env: { GH_REPO: "evil/repo" } });
    await merge(h);
    const calls = ghCalls(h);
    expect(calls.length).toBeGreaterThan(3);
    for (const call of calls) {
      expect(call).toContain(`--repo ${REPO}`);
      expect(call).not.toContain("evil/repo");
    }
  });

  it("re-runs the precheck before it merges", async () => {
    const h = scenario();
    await merge(h);
    const verbs = ghCalls(h).map((c) => c.split(" ").slice(0, 2).join(" "));
    expect(verbs.indexOf("pr view")).toBeLessThan(verbs.indexOf("pr merge"));
    expect(events(h)).toMatchObject([
      { kind: "precheck", label: "no-behaviour-change:pass" },
    ]);
  });

  it("names the gh failure when the merge is refused", async () => {
    const h = scenario({
      first: [
        {
          match: (c, a) => c === "gh" && a[1] === "merge",
          result: { code: 1, stderr: "head changed" },
        },
      ],
    });
    expect(await merge(h)).toBe(1);
    expect(h.err()).toContain("head changed");
  });

  it("asks for a PR number when none is given", async () => {
    const h = scenario();
    expect(await run(["judge", "merge"], h.deps)).toBe(1);
    expect(h.err()).toContain("harness judge merge <pr>");
    expect(h.runner.calls).toHaveLength(0);
  });
});

const FAILING_CI = [{ ...passing[0], conclusion: "FAILURE" }, passing[1]];
const PENDING_CI = [
  { ...passing[0], status: "IN_PROGRESS", conclusion: "" },
  passing[1],
];
const CLUSTER_DIFF = [
  "diff --git a/infra/charts/app/values.yaml b/infra/charts/app/values.yaml",
  "--- a/infra/charts/app/values.yaml",
  "+++ b/infra/charts/app/values.yaml",
  "@@ -1 +1 @@",
  "+replicas: 3",
].join("\n");

/** Each way a PR is not safe to merge: the tool exits 1, says so, and issues no merge command. */
const UNSAFE: [string, Scenario][] = [
  ["no declared pattern", { body: "no pattern here" }],
  ["a diff that does not match its pattern", { diff: kore }],
  [
    "a cluster-facing diff declared no-behaviour-change",
    { diff: CLUSTER_DIFF },
  ],
  ["a failing check", { rollup: FAILING_CI }],
  ["pending CI", { rollup: PENDING_CI }],
  ["a missing principles-review", { comments: [] }],
  [
    "an unverified principles-review from someone else",
    { comments: [{ body: "principles-review: No violations.", author: "x" }] },
  ],
  [
    "a principles-review made before the head commit",
    {
      comments: [
        {
          body: "principles-review: No violations.",
          createdAt: "2025-06-01T00:00:00Z",
        },
      ],
    },
  ],
  [
    "a principles-review that found violations",
    { comments: [{ body: "principles-review: 2 violations." }] },
  ],
];

describe("judge merge never merges what the precheck does not pass", () => {
  it.each(UNSAFE)("issues no merge command for %s", async (_name, s) => {
    const h = scenario(s);
    expect(await merge(h)).toBe(1);
    expect(merges(h)).toEqual([]);
    expect(h.err()).toContain("not merged");
    expect(JSON.parse(h.out())).toMatchObject({ merged: false });
  });
});
