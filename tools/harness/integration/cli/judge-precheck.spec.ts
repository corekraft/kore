import { describe, expect, it } from "vitest";
import {
  apiCalls,
  BASE_SHA,
  HEAD_SHA,
  kore,
  manifestDiff,
  manifestSides,
  precheck,
  report,
  scenario,
  verbs,
} from "./judge-support.js";

describe("judge precheck", () => {
  it("passes a declared pattern with passing checks and reports the hints", async () => {
    const h = scenario();
    expect(await precheck(h)).toBe(0);
    expect(report(h)).toMatchObject({
      pr: 42,
      ok: true,
      pattern: "no-behaviour-change",
      idea: "#193",
      patternMatches: true,
      clusterFacing: false,
      checks: {
        ci: { result: "pass" },
        scan: { result: "pass" },
        coverage: { result: "pass" },
        principlesReview: { result: "pass" },
      },
      hints: { noBehaviouralDiff: true },
    });
    expect(report(h)["unverified"]).toBeInstanceOf(Array);
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
    expect(report(h)).toMatchObject({ ok: false, declaration: { ok: false } });
    expect(report(h)).not.toHaveProperty("hints");
    expect(verbs(h)).toEqual(["gh pr view"]);
  });

  it("fails a declared pattern the diff contradicts, even with every check passing", async () => {
    const h = scenario({ diff: kore });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({
      ok: false,
      patternMatches: false,
      hints: { noBehaviouralDiff: false },
    });
    expect(String(report(h)["patternMismatch"])).toContain(
      "tools/kore/src/a.ts",
    );
  });

  it("reports a cluster-facing diff and what still needs a live run", async () => {
    const h = scenario({
      diff: kore.replaceAll("tools/kore/src/a.ts", "apps/web/values.yaml"),
    });
    await precheck(h);
    expect(report(h)).toMatchObject({ clusterFacing: true });
    expect(report(h)["unverified"]).toContain(
      "cluster-facing: live run required before merge",
    );
  });
});

describe("judge precheck hints and options", () => {
  it.each([
    [
      "no-behaviour-change",
      ["behaviouralPaths", "noBehaviouralDiff", "toolingPaths"],
    ],
    ["feature-flagged", ["flagPresentAndOff", "flags"]],
    ["dark-launched", ["flagOnlyInLocal", "flags"]],
    ["branch-by-abstraction", ["deletedFiles", "oldPathRetained"]],
    [
      "expand-contract",
      ["additiveOnly", "deletedFiles", "netRemovedLines", "removedLines"],
    ],
  ])("emits the %s hint keys in the JSON", async (pattern, keys) => {
    const h = scenario({ body: `Safety pattern: ${pattern}` });
    await precheck(h);
    expect(Object.keys(report(h)["hints"] as object).sort()).toEqual(keys);
  });

  it("does not accept a --ledger path, so the judge cannot choose where it writes", async () => {
    const h = scenario();
    expect(await precheck(h, "--ledger", "AGENTS.md")).not.toBe(0);
    expect(h.files.has("AGENTS.md")).toBe(false);
    expect(h.runner.calls).toHaveLength(0);
  });
});

describe("judge precheck reads a manifest diff through the runner", () => {
  const compare = `repos/corekraft/kore/compare/${BASE_SHA}...${HEAD_SHA}`;
  const at = (sha: string) =>
    `repos/corekraft/kore/contents/tools/kore/package.json?ref=${sha}`;
  const raw = ["api", "-H", "Accept: application/vnd.github.raw"];

  it("passes a scripts-only manifest change and reads both sides at the PR's own SHAs", async () => {
    const h = scenario({
      diff: manifestDiff,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      manifest: manifestSides,
    });
    expect(await precheck(h)).toBe(0);
    expect(report(h)).toMatchObject({
      ok: true,
      patternMatches: true,
      hints: { behaviouralPaths: [], noBehaviouralDiff: true },
    });
    expect(apiCalls(h)).toEqual([
      ["api", compare, "--jq", ".merge_base_commit.sha"],
      [...raw, at(manifestSides.mergeBase)],
      [...raw, at(HEAD_SHA)],
    ]);
  });

  it("asks GitHub for the base and head commits the PR reports, in its view", async () => {
    const h = scenario({
      diff: manifestDiff,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      manifest: manifestSides,
    });
    await precheck(h);
    const view = h.runner.calls.find((c) => c.args[1] === "view");
    expect(view?.args.join(" ")).toContain("baseRefOid");
    expect(view?.args.join(" ")).toContain("headRefOid");
  });

  it("fails closed when a gh api read exits non-zero, naming the cause and printing no pass", async () => {
    const h = scenario({
      diff: manifestDiff,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      manifest: manifestSides,
      first: [
        {
          match: (c, a) =>
            c === "gh" &&
            a[0] === "api" &&
            a.some((x) => x.includes("/compare/")),
          result: { code: 1, stderr: "HTTP 404: Not Found" },
        },
      ],
    });
    expect(await precheck(h)).not.toBe(0);
    expect(h.err()).toContain("failed for PR #42: HTTP 404: Not Found");
    expect(h.out()).toBe("");
    expect(apiCalls(h)).toHaveLength(1);
  });
});
