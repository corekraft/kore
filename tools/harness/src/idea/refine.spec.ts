// The refiner's exit criterion (plan 11 Step 3): a raw request becomes an idea
// that passes kb-check with a hypothesis, a measurable expected outcome and a
// likely safety pattern. The refiner files it through `idea new`, so this
// fixture runs that same command on what a refiner is told to produce.
import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { cleanTree, messages } from "../testing/index.js";
import { harness } from "../testing/index.js";
import { SAFETY_PATTERNS } from "./index.js";

const RAW_REQUEST = "kore local up feels slow, can we make it faster?";

/** What the refiner's interview settles for the raw request above. */
const REFINED = {
  title: "Cache probe results in kore local up",
  hypothesis:
    "Caching readiness probe results across reruns cuts kore local up time.",
  "expected-outcome":
    "The p50 duration of kore local up on a converged profile falls from 41 seconds to 30 seconds or less.",
  measurement:
    "Compare the p50 kore local up duration in the ledger over 10 runs before and after.",
  "safety-pattern": "feature-flagged",
};

const PATH = "docs/ideas/0001-cache-probe-results-in-kore-local-up.md";

async function refine(fields: Record<string, string>) {
  const h = harness();
  const argv = Object.entries(fields).flatMap(([key, value]) => [
    `--${key}`,
    value,
  ]);
  const code = await run(["idea", "new", ...argv], h.deps);
  return { code, h, text: h.get(PATH) ?? "" };
}

describe("a raw request refined into an idea", () => {
  it("is a raw request that has none of the idea's fields yet", () => {
    expect(RAW_REQUEST).not.toMatch(/hypothesis|expected|measure/i);
  });

  it("is filed by the idea tool and passes kb-check", async () => {
    const { code, text } = await refine(REFINED);
    expect(code).toBe(0);
    const problems = messages(
      cleanTree({ [PATH]: text, "docs/ideas/0001-a.md": null }),
    ).filter((m) => m.startsWith("docs/ideas/"));
    expect(problems).toEqual([]);
  });

  it("carries a hypothesis, a measurable expected outcome and a likely safety pattern", async () => {
    const { text } = await refine(REFINED);
    expect(text).toContain(`hypothesis: ${REFINED.hypothesis}`);
    // Measurable: a number with a unit the measurement can compare.
    expect(REFINED["expected-outcome"]).toMatch(/\d+ (seconds|percent|ms)/);
    expect(text).toContain(`expected-outcome: ${REFINED["expected-outcome"]}`);
    expect(SAFETY_PATTERNS).toContain(REFINED["safety-pattern"]);
  });

  it("is refused without an expected outcome, so a vague request cannot be filed as is", async () => {
    const { "expected-outcome": _dropped, ...vague } = REFINED;
    const { code, h } = await refine(vague);
    expect(code).toBe(1);
    expect(h.err()).toContain("--expected-outcome");
    expect(h.get(PATH)).toBeUndefined();
  });
});
