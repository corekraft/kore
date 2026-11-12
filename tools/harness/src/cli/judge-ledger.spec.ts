import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { testHarness } from "./cli-support.js";
import {
  LEDGER,
  REVIEWER,
  passing,
  precheck,
  scenario,
  verbs,
  type Harness,
  type Scenario,
} from "./judge-support.js";

describe("judge precheck recording and usage", () => {
  it("never mutates: only read-only gh commands run", async () => {
    const h = scenario();
    await precheck(h);
    expect(verbs(h)).toEqual(["gh pr view", "gh pr diff", "gh run view"]);
    const git = h.runner.calls.filter((c) => c.command === "git");
    expect(git.map((c) => c.args.slice(0, 1).join(" "))).toEqual(["rev-parse"]);
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
    expect(
      await run(["judge", "precheck", "42", "--reviewer", REVIEWER], h.deps),
    ).toBe(0);
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
  const failing = {
    rollup: [{ ...passing[0], conclusion: "FAILURE" }, passing[1]],
  };
  const labels = (h: Harness) =>
    (h.files.get(LEDGER) ?? "")
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { label: string }).label);

  async function sequence(...runs: Scenario[]): Promise<string[]> {
    let ledger = "";
    let last: Harness | undefined;
    for (const s of runs) {
      last = scenario(s);
      if (ledger !== "") {
        last.files.set(LEDGER, ledger);
      }
      await precheck(last);
      ledger = last.files.get(LEDGER) ?? "";
    }
    return last === undefined ? [] : labels(last);
  }

  it("adds no second event for the same verdict twice in a row", async () => {
    expect(await sequence({}, {})).toEqual(["no-behaviour-change:pass"]);
  });

  it("records the last pass after pass, fail, pass", async () => {
    expect(await sequence({}, failing, {})).toEqual([
      "no-behaviour-change:pass",
      "no-behaviour-change:fail",
      "no-behaviour-change:pass",
    ]);
  });

  it("still prints the report when no ledger can be opened", async () => {
    const h = scenario({ git: false });
    const code = await precheck(h);
    expect(JSON.parse(h.out().split("\n")[0] ?? "")).toMatchObject({ pr: 42 });
    expect(code).toBe(1);
  });
});

describe("judge precheck writes only the real main ledger", () => {
  const written = (h: Harness) => [...h.files.keys()].sort();

  it("ignores KORE_ROOT and CLAUDE_PROJECT_DIR: the write lands in the main root", async () => {
    const h = scenario({
      env: { KORE_ROOT: "/x", CLAUDE_PROJECT_DIR: "/x" },
    });
    await precheck(h);
    expect(written(h)).toEqual([LEDGER]);
  });

  it("finds the main root from the bundle's checkout with a git environment stripped of GIT_*", async () => {
    const h = scenario({
      env: { GIT_DIR: "/evil", GIT_WORK_TREE: "/evil", HOME: "/home/judge" },
    });
    await precheck(h);
    const git = h.runner.calls.find((c) => c.command === "git");
    expect(git?.options?.cwd).toBe("/repo");
    expect(git?.options?.env).toMatchObject({ HOME: "/home/judge" });
    expect(Object.keys(git?.options?.env ?? {})).not.toContain("GIT_DIR");
    expect(Object.keys(git?.options?.env ?? {})).not.toContain("GIT_WORK_TREE");
  });

  it("refuses to guess a ledger when it cannot tell where its bundle is", async () => {
    const h = scenario();
    delete h.deps.bundleUrl;
    expect(await precheck(h)).toBe(1);
    expect(h.err()).toContain("bundle");
    expect(written(h)).toEqual([]);
  });
});
