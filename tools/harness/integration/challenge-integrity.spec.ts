import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import {
  GH_USER,
  LEDGER,
  ghWrites,
  linked,
  type Harness,
} from "../src/testing/index.js";

const challenge = (extra: string[] = []) => [
  "idea",
  "challenge",
  "--idea",
  "1",
  "--ledger",
  LEDGER,
  ...extra,
];

/** Runs one round with the given objections on stdin, one per line. */
async function round(h: Harness, objections: string[], extra: string[] = []) {
  h.deps.stdin = () => Promise.resolve(`${objections.join("\n")}\n`);
  return await run(challenge(extra), h.deps);
}

const ledgerEvents = (h: Harness) =>
  (h.get(LEDGER.slice("/repo/".length)) ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const marker = (idea: string, n: number) =>
  `<!-- harness-challenge idea=${idea} round=${n} -->\nChallenge round ${n} of 2\n\n- x`;

describe("harness idea challenge integrity", () => {
  it("ignores a round marker posted by anyone but the authenticated gh user", async () => {
    const { h, issue } = await linked({
      comments: [marker("0001", 1), marker("0001", 2)],
      authors: { 0: "mallory", 1: "mallory" },
    });
    expect(await round(h, ["mine"])).toBe(0);
    expect(h.out()).toContain("round 1 of 2");
    expect(issue.comments).toHaveLength(3);
  });

  it("does not let a forged marker use up the rounds", async () => {
    const { h } = await linked({
      comments: [marker("0001", 1), marker("0001", 2)],
      authors: { 1: "mallory" },
    });
    expect(await round(h, ["mine"])).toBe(0);
    expect(h.out()).toContain("round 2 of 2");
  });

  it("still counts rounds by the expected user and refuses a third", async () => {
    const { h } = await linked({
      comments: [marker("0001", 1), marker("0001", 2)],
      authors: { 0: GH_USER, 1: GH_USER },
    });
    expect(await round(h, ["third"])).toBe(1);
    expect(h.err()).toContain("limit of 2 challenge rounds");
  });

  it("reports a duplicate round number after posting, naming both comments and which to keep", async () => {
    const raced = await linked();
    raced.issue.afterComment = (i) => {
      if (i.comments.length === 1) {
        i.comments.unshift(marker("0001", 1));
      }
    };
    expect(await round(raced.h, ["mine"])).toBe(1);
    const error = raced.h.err();
    expect(error).toContain("round 1");
    expect(error).toContain("#issuecomment-1");
    expect(error).toContain("#issuecomment-2");
    expect(error).toMatch(/keep .*#issuecomment-1/i);
  });
});

describe("harness idea challenge duplicates", () => {
  it("records the round in the ledger before reporting a duplicate, so the issue and ledger agree", async () => {
    const raced = await linked();
    raced.issue.afterComment = (i) => {
      if (i.comments.length === 1) {
        i.comments.unshift(marker("0001", 1));
      }
    };
    expect(await round(raced.h, ["mine"])).toBe(1);
    expect(
      ledgerEvents(raced.h).filter((e) => e["kind"] === "challenge.round"),
    ).toMatchObject([{ idea: "0001", stage: "challenge", number: 1 }]);
    expect(
      ghWrites(raced.h).filter((c) => c.args[1] === "comment"),
    ).toHaveLength(1);
  });

  it("says not to rerun when the re-read after posting fails, and posts exactly once", async () => {
    const { h, issue } = await linked();
    const inner = h.runner.run.bind(h.runner);
    let views = 0;
    h.runner.run = (c, a, o) => {
      if (c === "gh" && a[0] === "issue" && a[1] === "view" && ++views === 2) {
        return Promise.resolve({ stdout: "", stderr: "rate limited", code: 1 });
      }
      return inner(c, a, o);
    };
    expect(await round(h, ["a"])).toBe(1);
    const error = h.err();
    expect(error).toContain("Round 1 was posted");
    expect(error).toContain("rate limited");
    expect(error).toContain("Do not rerun");
    expect(error).not.toContain("then rerun");
    expect(issue.comments).toHaveLength(1);
    expect(ghWrites(h).filter((c) => c.args[1] === "comment")).toHaveLength(1);
  });

  it("is not a duplicate when the same round number is from someone else", async () => {
    const { h, issue } = await linked();
    issue.afterComment = (i) => {
      if (i.comments.length === 1) {
        i.comments.unshift(marker("0001", 1));
        i.authors = { 0: "mallory" };
      }
    };
    expect(await round(h, ["mine"])).toBe(0);
  });

  it("refuses to post when the gh user cannot be determined", async () => {
    const { h } = await linked();
    const inner = h.runner.run.bind(h.runner);
    h.runner.run = (c, a, o) =>
      c === "gh" && a[0] === "api"
        ? Promise.resolve({ stdout: "", stderr: "not logged in", code: 1 })
        : inner(c, a, o);
    expect(await round(h, ["a"])).toBe(1);
    expect(h.err()).toContain("could not name the authenticated user");
    expect(h.err()).toContain("gh auth status");
    expect(ghWrites(h)).toHaveLength(0);
  });

  it("counts a leftover duplicate as one round and does not fail a clean later post", async () => {
    const { h, issue } = await linked({
      comments: [marker("0001", 1), marker("0001", 1)],
    });
    expect(await round(h, ["next"])).toBe(0);
    expect(h.out()).toContain("round 2 of 2");
    expect(issue.comments).toHaveLength(3);
  });
});

describe("harness idea challenge bookkeeping", () => {
  it("ignores rounds posted for other ideas", async () => {
    const { h, issue } = await linked({
      comments: [
        "<!-- harness-challenge idea=0002 round=1 -->\nChallenge round 1 of 2\n\n- other",
        "<!-- harness-challenge idea=0002 round=2 -->\nChallenge round 2 of 2\n\n- other",
      ],
    });
    expect(await round(h, ["mine"])).toBe(0);
    expect(issue.comments[2]).toContain("round 1 of 2");
  });

  it("ignores a person's comment that merely mentions a round", async () => {
    const { h } = await linked({
      comments: ["Challenge round 1 of 2 looked fair to me."],
    });
    expect(await round(h, ["mine"])).toBe(0);
    expect(h.out()).toContain("round 1 of 2");
  });

  it("records each round in the ledger against the idea and the challenge stage", async () => {
    const { h } = await linked();
    await round(h, ["a", "b"]);
    await run(challenge(["--approve"]), h.deps);
    const events = ledgerEvents(h).filter(
      (e) => e["kind"] === "challenge.round",
    );
    expect(events).toMatchObject([
      { idea: "0001", stage: "challenge", number: 1, label: "objections:2" },
      { idea: "0001", stage: "challenge", number: 2, label: "objections:0" },
    ]);
  });

  it("needs objections or --approve, and posts nothing without either", async () => {
    const { h } = await linked();
    expect(await round(h, [])).toBe(1);
    expect(h.err()).toContain("--approve");
    expect(ghWrites(h)).toHaveLength(0);
  });

  it("says to sync first when the idea has no issue", async () => {
    const { h } = await linked();
    h.set(
      "docs/ideas/0001-cache-the-probe-results.md",
      (h.get("docs/ideas/0001-cache-the-probe-results.md") ?? "").replace(
        /issue: 300\n/,
        "",
      ),
    );
    expect(await round(h, ["a"])).toBe(1);
    expect(h.err()).toContain("harness idea sync");
    expect(ghWrites(h)).toHaveLength(0);
  });

  it("changes no idea file", async () => {
    const { h } = await linked();
    const before = h.snapshot();
    await round(h, ["a"]);
    const after = h.snapshot();
    delete after[LEDGER.slice("/repo/".length)];
    expect(after).toEqual(before);
  });
});
