import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import {
  LEDGER,
  ghWrites,
  linked,
  type Harness,
} from "../src/testing/index.js";
import { MAX_ROUNDS } from "../src/challenge/index.js";

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
