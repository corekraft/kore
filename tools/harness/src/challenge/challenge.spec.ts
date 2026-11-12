import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  GH_USER,
  LEDGER,
  ghWrites,
  linked,
  type Harness,
} from "../outcome/outcome-support.js";
import { MAX_ROUNDS } from "./index.js";

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

describe("harness idea challenge", () => {
  it("limits an idea to two challenge rounds", () => {
    expect(MAX_ROUNDS).toBe(2);
  });

  it("posts a round's objections on the issue and counts it as round 1", async () => {
    const { h, issue } = await linked();
    expect(
      await round(h, ["The hypothesis has no baseline.", "No rollback."]),
    ).toBe(0);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0]).toContain("Challenge round 1 of 2");
    expect(issue.comments[0]).toContain("- The hypothesis has no baseline.");
    expect(issue.comments[0]).toContain("- No rollback.");
    expect(h.out()).toContain("round 1 of 2");
  });

  it("counts the second round from the first round's comment on the issue", async () => {
    const { h, issue } = await linked();
    await round(h, ["No baseline."]);
    await round(h, ["Safety pattern should be dark-launched."]);
    expect(issue.comments).toHaveLength(2);
    expect(issue.comments[1]).toContain("Challenge round 2 of 2");
  });

  it("counts rounds from the issue, not from this machine", async () => {
    const first = await linked();
    await round(first.h, ["No baseline."]);
    await round(first.h, ["Still no baseline."]);
    // A fresh checkout and ledger, the same issue: the two rounds are still two.
    const { h } = await linked({ comments: first.issue.comments });
    expect(await round(h, ["Third."])).toBe(1);
    expect(h.err()).toContain("2 challenge rounds");
  });

  it("refuses a third round, lists the open objections, and writes nothing", async () => {
    const { h, issue } = await linked();
    await round(h, ["No baseline."]);
    await round(h, ["Outcome is not measurable.", "Wrong safety pattern."]);
    const writes = ghWrites(h).length;
    const events = ledgerEvents(h).length;

    expect(await round(h, ["One more thing."])).toBe(1);
    const error = h.err();
    expect(error).toContain("limit of 2 challenge rounds");
    expect(error).toContain("a person");
    expect(error).toContain("- Outcome is not measurable.");
    expect(error).toContain("- Wrong safety pattern.");
    expect(error).not.toContain("No baseline.");
    expect(error).not.toContain("One more thing.");
    expect(issue.comments).toHaveLength(2);
    expect(ghWrites(h)).toHaveLength(writes);
    expect(ledgerEvents(h)).toHaveLength(events);
  });

  it("reports the refusal as JSON with the open objections", async () => {
    const { h } = await linked();
    await round(h, ["a"]);
    await round(h, ["b"]);
    h.deps.stdin = () => Promise.resolve("c\n");
    expect(await run([...challenge(), "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err().trim().split("\n")[0] ?? "")).toMatchObject({
      rounds: 2,
      openObjections: ["b"],
    });
  });
});

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

  it("reports a duplicate round number after posting, naming both comments", async () => {
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

describe("harness idea challenge approvals", () => {
  it("records a round with no objections as an approval, and still counts it", async () => {
    const { h, issue } = await linked();
    expect(await run(challenge(["--approve"]), h.deps)).toBe(0);
    expect(issue.comments[0]).toContain("Challenge round 1 of 2");
    expect(issue.comments[0]).toContain("No open objections.");
    await round(h, ["Late objection."]);
    expect(await round(h, ["Too late."])).toBe(1);
  });

  it("lists no objections when the last round approved", async () => {
    const { h } = await linked();
    await round(h, ["a"]);
    await run(challenge(["--approve"]), h.deps);
    expect(await round(h, ["again"])).toBe(1);
    expect(h.err()).toContain("No open objections");
    expect(h.err()).not.toContain("- a");
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
