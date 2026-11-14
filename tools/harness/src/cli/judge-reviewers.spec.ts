import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { REVIEWER, report, scenario, type Comment } from "./judge-support.js";

const CONFIG = "/repo/.claude/harness.json";
const OWNER = "corekraft";

/** A scenario whose only principles-review comment is by `author`, under the given harness config. */
function reviewedBy(author: string, config?: unknown, flag?: string) {
  const comment: Comment = {
    body: "principles-review: No violations.",
    author,
  };
  const raw = typeof config === "string" ? config : JSON.stringify(config);
  const h = scenario({
    comments: [comment],
    files: config === undefined ? {} : { [CONFIG]: raw },
  });
  const args = ["judge", "precheck", "42", "--json"];
  if (flag !== undefined) {
    args.push("--reviewer", flag);
  }
  return { h, args };
}

const verdict = (h: ReturnType<typeof scenario>) =>
  (report(h)["checks"] as Record<string, { result: string; detail?: string }>)[
    "principlesReview"
  ];

describe("judge precheck reviewers with no flag and no list", () => {
  it("counts a verdict from the repository owner when no owner login is configured", async () => {
    const { h, args } = reviewedBy(OWNER);
    expect(await run(args, h.deps)).toBe(0);
    expect(verdict(h)?.result).toBe("pass");
  });

  it("counts a verdict from the configured owner login", async () => {
    const { h, args } = reviewedBy("junners", { ownerLogin: "junners" });
    expect(await run(args, h.deps)).toBe(0);
    expect(verdict(h)?.result).toBe("pass");
  });

  it("treats a verdict from any other login as unverified", async () => {
    const { h, args } = reviewedBy("writer-pane", { ownerLogin: "junners" });
    expect(await run(args, h.deps)).toBe(1);
    expect(verdict(h)?.result).toBe("unverified");
    expect(verdict(h)?.detail).toContain("junners");
  });
});

describe("judge precheck reviewers from reviewerLogins", () => {
  it("counts only the logins in the configured list", async () => {
    const { h, args } = reviewedBy("bot-a", {
      ownerLogin: "junners",
      reviewerLogins: ["bot-a", "bot-b"],
    });
    expect(await run(args, h.deps)).toBe(0);
    expect(verdict(h)?.result).toBe("pass");
  });

  it("does not count the owner login once a list is configured", async () => {
    const { h, args } = reviewedBy("junners", {
      ownerLogin: "junners",
      reviewerLogins: ["bot-a"],
    });
    expect(await run(args, h.deps)).toBe(1);
    expect(verdict(h)?.result).toBe("unverified");
  });
});

describe("judge precheck reviewers with --reviewer", () => {
  it("overrides the configured list, so a flagged login counts", async () => {
    const { h, args } = reviewedBy(
      REVIEWER,
      { ownerLogin: "junners", reviewerLogins: ["bot-a"] },
      REVIEWER,
    );
    expect(await run(args, h.deps)).toBe(0);
    expect(verdict(h)?.result).toBe("pass");
  });

  it("does not read the harness config when the flag names the reviewers", async () => {
    const { h, args } = reviewedBy(REVIEWER, "not json", REVIEWER);
    expect(await run(args, h.deps)).toBe(0);
    expect(report(h)["reviewers"]).toEqual([REVIEWER]);
  });
});

describe("judge precheck output names the reviewers it trusted", () => {
  it("lists them in the JSON report", async () => {
    const { h, args } = reviewedBy("junners", { ownerLogin: "junners" });
    await run(args, h.deps);
    expect(report(h)["reviewers"]).toEqual(["junners"]);
  });

  it("lists them in the readable summary", async () => {
    const { h } = reviewedBy("junners", { ownerLogin: "junners" });
    await run(["judge", "precheck", "42"], h.deps);
    expect(h.out()).toContain("reviewers: junners\n");
  });
});

describe("judge precheck refuses a harness config it cannot read", () => {
  it("names the file and the key, and nothing is trusted", async () => {
    const { h, args } = reviewedBy(OWNER, { reviewerLogins: [] });
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toContain(".claude/harness.json");
    expect(h.err()).toContain("reviewerLogins");
  });
});
