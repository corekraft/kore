import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import {
  REVIEW_OK,
  passing,
  precheck,
  report,
  scenario,
  type Comment,
  type Harness,
} from "./judge-support.js";

describe("judge precheck check results", () => {
  it("fails and names a failing CI check", async () => {
    const h = scenario({
      rollup: [{ ...passing[0], conclusion: "FAILURE" }, passing[1]],
    });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({
      ok: false,
      checks: { ci: { result: "fail" }, scan: { result: "pass" } },
    });
  });

  it("fails a failing scan", async () => {
    const h = scenario({
      rollup: [passing[0], { ...passing[1], conclusion: "FAILURE" }],
    });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({ checks: { scan: { result: "fail" } } });
  });

  it.each(["Harness tests", "Unit tests"])(
    "fails when the %s step failed even though the other passed",
    async (failed) => {
      const h = scenario({
        steps: ["Unit tests", "Harness tests"].map((name) => ({
          name,
          conclusion: name === failed ? "failure" : "success",
        })),
      });
      expect(await precheck(h)).toBe(1);
      expect(report(h)).toMatchObject({
        checks: { coverage: { result: "fail" } },
      });
    },
  );

  it("does not pass coverage when a step is absent from the run", async () => {
    const h = scenario({
      steps: [{ name: "Harness tests", conclusion: "success" }],
    });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({
      checks: { coverage: { result: "missing" } },
    });
  });

  it("reports a check still running as pending, not passing", async () => {
    const h = scenario({
      rollup: [
        { ...passing[0], status: "IN_PROGRESS", conclusion: "" },
        passing[1],
      ],
    });
    expect(await precheck(h)).toBe(1);
    expect(report(h)).toMatchObject({ checks: { ci: { result: "pending" } } });
  });
});

describe("judge precheck principles-review trust", () => {
  const review = (comments: Comment[]) => scenario({ comments });
  const verdict = (h: Harness) =>
    (
      report(h)["checks"] as Record<string, { result: string; detail?: string }>
    )["principlesReview"];

  it("fails on violations and reports a missing review", async () => {
    const found = review([{ body: "principles-review: 2 violations" }]);
    expect(await precheck(found)).toBe(1);
    expect(verdict(found)?.result).toBe("fail");
    const none = review([{ body: "looks good" }]);
    expect(await precheck(none)).toBe(1);
    expect(verdict(none)?.result).toBe("missing");
  });

  it("does not trust a review posted by anyone but a known reviewer", async () => {
    const h = review([{ ...REVIEW_OK, author: "writer-pane" }]);
    expect(await precheck(h)).toBe(1);
    expect(verdict(h)?.result).toBe("unverified");
  });

  it("does not trust a review older than the head commit", async () => {
    const h = review([{ ...REVIEW_OK, createdAt: "2025-12-30T00:00:00Z" }]);
    expect(await precheck(h)).toBe(1);
    expect(verdict(h)?.result).toBe("unverified");
    expect(verdict(h)?.detail).toContain("head commit");
  });

  it("reports unverified, naming --reviewer, when no reviewer identity is given", async () => {
    const h = scenario();
    expect(await run(["judge", "precheck", "42", "--json"], h.deps)).toBe(1);
    expect(verdict(h)?.result).toBe("unverified");
    expect(verdict(h)?.detail).toContain("--reviewer");
  });

  it("reads the newest qualifying review, ignoring a newer one from a stranger", async () => {
    const h = review([
      {
        body: "principles-review: 1 violation",
        createdAt: "2026-01-02T00:00:00Z",
      },
      { ...REVIEW_OK, createdAt: "2026-01-03T00:00:00Z" },
      {
        body: "principles-review: 9 violations",
        author: "writer-pane",
        createdAt: "2026-01-04T00:00:00Z",
      },
    ]);
    expect(await precheck(h)).toBe(0);
  });
});
