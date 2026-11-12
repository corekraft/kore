import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import {
  LEDGER,
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
const sendBack = (h: Harness, ...extra: string[]) =>
  run(["judge", "send-back", "42", ...extra], h.deps);

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

const withMerge = (s: Scenario = {}): Harness => scenario(s);

describe("judge merge squash-merges only when the precheck passes", () => {
  it("squash-merges the verified head commit when every check passes", async () => {
    const h = withMerge();
    expect(await merge(h)).toBe(0);
    expect(merges(h)).toEqual([
      `pr merge 42 --squash --match-head-commit ${HEAD}`,
    ]);
    expect(JSON.parse(h.out())).toMatchObject({ pr: 42, merged: true });
  });

  it("re-runs the precheck before it merges", async () => {
    const h = withMerge();
    await merge(h);
    const verbs = ghCalls(h).map((c) => c.split(" ").slice(0, 2).join(" "));
    expect(verbs.indexOf("pr view")).toBeLessThan(verbs.indexOf("pr merge"));
    expect(events(h)).toMatchObject([
      { kind: "precheck", label: "no-behaviour-change:pass" },
    ]);
  });

  it("never merges a PR with no declared pattern", async () => {
    const h = withMerge({ body: "no pattern here" });
    expect(await merge(h)).toBe(1);
    expect(merges(h)).toEqual([]);
    expect(h.err()).toContain("not merged");
  });

  it("never merges a PR whose diff does not match its declared pattern", async () => {
    const h = withMerge({ diff: kore });
    expect(await merge(h)).toBe(1);
    expect(merges(h)).toEqual([]);
    expect(JSON.parse(h.out())).toMatchObject({ merged: false });
  });

  it("never merges when a check is failing", async () => {
    const h = withMerge({
      rollup: [{ ...passing[0], conclusion: "FAILURE" }, passing[1]],
    });
    expect(await merge(h)).toBe(1);
    expect(merges(h)).toEqual([]);
  });

  it("never merges with any other strategy or flag", async () => {
    const h = withMerge();
    await merge(h, "--auto");
    for (const call of merges(h)) {
      expect(call).toContain("--squash");
      expect(call).not.toMatch(/--(merge|rebase|auto|admin)\b/);
    }
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
    const h = withMerge();
    expect(await run(["judge", "merge"], h.deps)).toBe(1);
    expect(h.err()).toContain("harness judge merge <pr>");
    expect(h.runner.calls).toHaveLength(0);
  });
});

describe("judge send-back posts the reason on the queue and the ledger", () => {
  it("comments the reason on the PR and records it in the ledger", async () => {
    const h = withMerge();
    expect(await sendBack(h, "--reason", "diff touches a chart")).toBe(0);
    const comment = ghCalls(h).find((c) => c.startsWith("pr comment 42"));
    expect(comment).toContain("diff touches a chart");
    expect(events(h)).toMatchObject([
      {
        kind: "send-back",
        source: "github",
        number: 42,
        label: "diff touches a chart",
      },
    ]);
  });

  it("never merges or reads anything else", async () => {
    const h = withMerge();
    await sendBack(h, "--reason", "no pattern declared");
    expect(merges(h)).toEqual([]);
    expect(ghCalls(h)).toHaveLength(1);
  });

  it("keeps the full reason in the comment and a trimmed one in the ledger", async () => {
    const h = withMerge();
    const reason = `${"long reason ".repeat(20)}\nsecond line`;
    await sendBack(h, "--reason", reason);
    expect(ghCalls(h)[0]).toContain("second line");
    const label = String(events(h)[0]?.["label"]);
    expect(label.length).toBeLessThanOrEqual(100);
    expect(label.split("").every((ch) => ch.charCodeAt(0) >= 0x20)).toBe(true);
  });

  it("requires a reason and posts nothing without one", async () => {
    const h = withMerge();
    expect(await sendBack(h)).toBe(1);
    expect(await sendBack(h, "--reason", "  ")).toBe(1);
    expect(h.err()).toContain("--reason");
    expect(h.runner.calls).toHaveLength(0);
    expect(h.files.has(LEDGER)).toBe(false);
  });

  it("records nothing when the comment cannot be posted", async () => {
    const h = scenario({
      first: [
        {
          match: (c, a) => c === "gh" && a[1] === "comment",
          result: { code: 1, stderr: "not found" },
        },
      ],
    });
    expect(await sendBack(h, "--reason", "no pattern")).toBe(1);
    expect(h.err()).toContain("not found");
    expect(h.files.has(LEDGER)).toBe(false);
  });
});
